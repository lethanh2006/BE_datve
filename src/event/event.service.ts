import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PgError, pgErrorCode } from '../common/db/pg-error';
import { containsPattern, matches } from '../common/db/search';
import { ApiException } from '../common/exception/api.exception';
import { PageResponse } from '../common/response/page-response';
import { EventListQuery } from './dto/event-list.query';
import { EventResponse } from './dto/event.response';
import { UpsertEventRequest } from './dto/upsert-event.request';

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  venue: string;
  imageUrl: string | null;
  category: string | null;
  nextShowtime: Date | null;
  minPrice: string | null;
}

const SELECT_EVENT = `
  SELECT e.id, e.name, e.description, e.venue,
         e.image_url AS "imageUrl", e.category,
         (SELECT min(s.start_time) FROM showtimes s
           WHERE s.event_id = e.id AND s.start_time > now() AND s.cancelled_at IS NULL) AS "nextShowtime",
         (SELECT min(se.face_value) FROM seats se
            JOIN showtimes s ON s.id = se.showtime_id
           WHERE s.event_id = e.id AND s.start_time > now() AND s.cancelled_at IS NULL) AS "minPrice"
  FROM events e`;

const toResponse = (r: EventRow): EventResponse => ({
  id: Number(r.id),
  name: r.name,
  description: r.description,
  venue: r.venue,
  imageUrl: r.imageUrl,
  category: r.category,
  nextShowtime: r.nextShowtime,
  minPrice: r.minPrice === null ? null : Number(r.minPrice),
});

@Injectable()
export class EventService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Sự kiện có suất diễn sắp tới gần nhất đứng trước, sự kiện chưa có suất xuống cuối. */
  async findAll(query: EventListQuery): Promise<PageResponse<EventResponse>> {
    const { page, size, q, category } = query;
    const params = [containsPattern(q), category ?? null];
    const where = `WHERE ($1::text IS NULL OR ${matches('e.name', '$1')} OR ${matches('e.venue', '$1')})
                     AND ($2::text IS NULL OR e.category = $2)`;

    const [rows, counted] = await Promise.all([
      this.dataSource.query<EventRow[]>(
        `${SELECT_EVENT} ${where}
         ORDER BY "nextShowtime" ASC NULLS LAST, e.id
         LIMIT $3 OFFSET $4`,
        [...params, size, page * size],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM events e ${where}`,
        params,
      ),
    ]);
    return PageResponse.of(rows.map(toResponse), page, size, counted[0].count);
  }

  async findById(id: number): Promise<EventResponse> {
    const rows = await this.dataSource.query<EventRow[]>(
      `${SELECT_EVENT} WHERE e.id = $1`,
      [id],
    );
    if (!rows.length) throw this.notFound(id);
    return toResponse(rows[0]);
  }

  async listCategories(): Promise<string[]> {
    const rows = await this.dataSource.query<{ category: string }[]>(
      `SELECT DISTINCT category FROM events WHERE category IS NOT NULL ORDER BY category`,
    );
    return rows.map((r) => r.category);
  }

  async exists(id: number): Promise<boolean> {
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM events WHERE id = $1`,
      [id],
    );
    return rows.length > 0;
  }

  // ---- quản trị ----

  async create(dto: UpsertEventRequest): Promise<EventResponse> {
    const [{ id }] = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO events (name, description, venue, image_url, category)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        dto.name,
        dto.description ?? null,
        dto.venue,
        dto.imageUrl ?? null,
        dto.category ?? null,
      ],
    );
    return this.findById(Number(id));
  }

  async update(id: number, dto: UpsertEventRequest): Promise<EventResponse> {
    const [updated] = await this.dataSource.query<[unknown[], number]>(
      `UPDATE events SET name = $2, description = $3, venue = $4, image_url = $5, category = $6
       WHERE id = $1 RETURNING id`,
      [
        id,
        dto.name,
        dto.description ?? null,
        dto.venue,
        dto.imageUrl ?? null,
        dto.category ?? null,
      ],
    );
    // UPDATE ... RETURNING của TypeORM trả về [rows, rowCount]
    if (!updated.length) throw this.notFound(id);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    try {
      const [, deleted] = await this.dataSource.query<[unknown[], number]>(
        `DELETE FROM events WHERE id = $1`,
        [id],
      );
      // DELETE của TypeORM trả về [rows, rowCount]
      if (!deleted) throw this.notFound(id);
    } catch (e) {
      if (pgErrorCode(e) === PgError.FOREIGN_KEY_VIOLATION) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'EVENT_HAS_SHOWTIMES',
          'Không thể xoá sự kiện đã có suất diễn, hãy xoá các suất diễn trước',
        );
      }
      throw e;
    }
  }

  private notFound(id: number) {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      'EVENT_NOT_FOUND',
      `Không tìm thấy sự kiện có id ${id}`,
    );
  }
}
