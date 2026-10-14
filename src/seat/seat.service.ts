import { HttpStatus, Injectable, MessageEvent } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';
import { ShowtimeService } from '../showtime/showtime.service';
import { SeatEventsService } from './seat-events.service';
import { SeatResponse } from './dto/seat.response';
import { seatBookedSql, seatHeldSql } from './seat-availability.sql';
import { SeatStatus } from './seat-status.enum';

interface SeatStatusRow {
  id: string;
  seatCode: string;
  category: string;
  faceValue: string;
  status: SeatStatus;
}

@Injectable()
export class SeatService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly showtimeService: ShowtimeService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  private async assertShowtimeExists(showtimeId: number) {
    if (!(await this.showtimeService.exists(showtimeId))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SHOWTIME_NOT_FOUND',
        `Không tìm thấy suất diễn có id ${showtimeId}`,
      );
    }
  }

  /** Luồng SSE báo khi ghế của suất diễn thay đổi (client nhận được thì tải lại danh sách ghế). */
  async streamChanges(showtimeId: number): Promise<Observable<MessageEvent>> {
    await this.assertShowtimeExists(showtimeId);
    return this.seatEvents.subscribe(showtimeId);
  }

  // danh sách ghế + trạng thái của 1 suất diễn
  async findByShowtimeId(showtimeId: number): Promise<SeatResponse[]> {
    await this.assertShowtimeExists(showtimeId);
    const rows = await this.dataSource.query<SeatStatusRow[]>(
      `SELECT s.id          AS "id",
              s.seat_code   AS "seatCode",
              s.category    AS "category",
              s.face_value  AS "faceValue",
              CASE
                  WHEN ${seatBookedSql('s')} THEN 'BOOKED'
                  WHEN ${seatHeldSql('s')} THEN 'HELD'
                  ELSE 'AVAILABLE'
              END           AS "status"
       FROM seats s
       WHERE s.showtime_id = $1
       ORDER BY s.id`,
      [showtimeId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      seatCode: r.seatCode,
      category: r.category,
      faceValue: Number(r.faceValue),
      status: r.status,
    }));
  }
}
