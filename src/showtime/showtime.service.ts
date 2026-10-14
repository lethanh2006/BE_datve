import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PgError, pgErrorCode } from '../common/db/pg-error';
import { ApiException } from '../common/exception/api.exception';
import { EventService } from '../event/event.service';
import { seatTakenSql } from '../seat/seat-availability.sql';
import { AddSeatsRequest } from './dto/add-seats.request';
import { CreateShowtimeRequest } from './dto/create-showtime.request';
import { ShowtimeResponse } from './dto/showtime.response';
import {
  buildSeats,
  MAX_SEATS_PER_SHOWTIME,
  SeatSpec,
  tooManySeats,
} from './seat-layout';

interface ShowtimeRow {
  id: string;
  eventId: string;
  startTime: Date;
  endTime: Date;
  totalSeats: number;
  availableSeats: number;
  minPrice: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

const SELECT_SHOWTIME = `
  SELECT s.id, s.event_id AS "eventId", s.start_time AS "startTime", s.end_time AS "endTime",
         (SELECT count(*)::int FROM seats se WHERE se.showtime_id = s.id) AS "totalSeats",
         CASE WHEN s.cancelled_at IS NOT NULL THEN 0
              ELSE (SELECT count(*)::int FROM seats se
                     WHERE se.showtime_id = s.id AND NOT ${seatTakenSql('se')}) END AS "availableSeats",
         (SELECT min(se.face_value) FROM seats se WHERE se.showtime_id = s.id) AS "minPrice",
         s.cancelled_at AS "cancelledAt", s.cancel_reason AS "cancelReason"
  FROM showtimes s`;

const toResponse = (r: ShowtimeRow): ShowtimeResponse => ({
  id: Number(r.id),
  eventId: Number(r.eventId),
  startTime: r.startTime,
  endTime: r.endTime,
  totalSeats: r.totalSeats,
  availableSeats: r.availableSeats,
  minPrice: r.minPrice === null ? null : Number(r.minPrice),
  cancelledAt: r.cancelledAt,
  cancelReason: r.cancelReason,
});

@Injectable()
export class ShowtimeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventService: EventService,
  ) {}

  async findByEventId(eventId: number): Promise<ShowtimeResponse[]> {
    if (!(await this.eventService.exists(eventId))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'EVENT_NOT_FOUND',
        `Không tìm thấy sự kiện có id ${eventId}`,
      );
    }
    const rows = await this.dataSource.query<ShowtimeRow[]>(
      `${SELECT_SHOWTIME} WHERE s.event_id = $1 ORDER BY s.start_time`,
      [eventId],
    );
    return rows.map(toResponse);
  }

  async findOne(id: number): Promise<ShowtimeResponse> {
    const rows = await this.dataSource.query<ShowtimeRow[]>(
      `${SELECT_SHOWTIME} WHERE s.id = $1`,
      [id],
    );
    if (!rows.length) throw this.notFound(id);
    return toResponse(rows[0]);
  }

  async exists(id: number): Promise<boolean> {
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM showtimes WHERE id = $1`,
      [id],
    );
    return rows.length > 0;
  }

  // ---- quản trị ----

  async create(
    eventId: number,
    dto: CreateShowtimeRequest,
  ): Promise<ShowtimeResponse> {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (!(end > start)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TIME_RANGE',
        'Giờ kết thúc phải sau giờ bắt đầu',
      );
    }
    const seats = buildSeats(dto.sections ?? []);
    if (!(await this.eventService.exists(eventId))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'EVENT_NOT_FOUND',
        `Không tìm thấy sự kiện có id ${eventId}`,
      );
    }

    try {
      const id = await this.dataSource.transaction(async (em) => {
        const [{ id }] = await em.query<{ id: string }[]>(
          `INSERT INTO showtimes (event_id, start_time, end_time) VALUES ($1, $2, $3) RETURNING id`,
          [eventId, start, end],
        );
        await this.insertSeats(em, Number(id), seats);
        return Number(id);
      });
      return this.findOne(id);
    } catch (e) {
      if (pgErrorCode(e) === PgError.EXCLUSION_VIOLATION) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'SHOWTIME_OVERLAP',
          'Suất diễn bị trùng giờ với một suất khác của sự kiện này',
        );
      }
      throw e;
    }
  }

  async addSeats(
    showtimeId: number,
    dto: AddSeatsRequest,
  ): Promise<ShowtimeResponse> {
    const seats = buildSeats(dto.sections);
    try {
      await this.dataSource.transaction(async (em) => {
        const locked = await em.query<unknown[]>(
          `SELECT id FROM showtimes WHERE id = $1 FOR NO KEY UPDATE`,
          [showtimeId],
        );
        if (!locked.length) throw this.notFound(showtimeId);

        const [{ count }] = await em.query<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM seats WHERE showtime_id = $1`,
          [showtimeId],
        );
        if (count + seats.length > MAX_SEATS_PER_SHOWTIME) throw tooManySeats();

        await this.insertSeats(em, showtimeId, seats);
      });
    } catch (e) {
      if (pgErrorCode(e) === PgError.UNIQUE_VIOLATION) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'SEAT_CODE_EXISTS',
          'Một hoặc nhiều mã ghế đã tồn tại trong suất diễn này',
        );
      }
      throw e;
    }
    return this.findOne(showtimeId);
  }

  async remove(id: number): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        const locked = await em.query<unknown[]>(
          `SELECT id FROM showtimes WHERE id = $1 FOR NO KEY UPDATE`,
          [id],
        );
        if (!locked.length) throw this.notFound(id);

        const bookings = await em.query<unknown[]>(
          `SELECT 1 FROM bookings WHERE showtime_id = $1 LIMIT 1`,
          [id],
        );
        if (bookings.length) throw this.hasBookings();

        await em.query(`DELETE FROM seats WHERE showtime_id = $1`, [id]);
        await em.query(`DELETE FROM showtimes WHERE id = $1`, [id]);
      });
    } catch (e) {
      // Có người vừa đặt vé giữa lúc kiểm tra và lúc xoá
      if (pgErrorCode(e) === PgError.FOREIGN_KEY_VIOLATION)
        throw this.hasBookings();
      throw e;
    }
  }

  private async insertSeats(
    em: EntityManager,
    showtimeId: number,
    seats: SeatSpec[],
  ) {
    if (!seats.length) return;
    await em.query(
      `INSERT INTO seats (showtime_id, seat_code, category, face_value)
       SELECT $1, t.code, t.category, t.price
       FROM unnest($2::text[], $3::text[], $4::numeric[]) AS t(code, category, price)`,
      [
        showtimeId,
        seats.map((s) => s.seatCode),
        seats.map((s) => s.category),
        seats.map((s) => s.faceValue),
      ],
    );
  }

  private notFound(id: number) {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      'SHOWTIME_NOT_FOUND',
      `Không tìm thấy suất diễn có id ${id}`,
    );
  }

  private hasBookings() {
    return new ApiException(
      HttpStatus.CONFLICT,
      'SHOWTIME_HAS_BOOKINGS',
      'Không thể xoá suất diễn đã có người đặt vé',
    );
  }
}
