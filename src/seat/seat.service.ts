import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';
import { ShowtimeService } from '../showtime/showtime.service';
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
  ) {}

  // danh sách ghế + trạng thái của 1 suất diễn
  async findByShowtimeId(showtimeId: number): Promise<SeatResponse[]> {
    if (!(await this.showtimeService.exists(showtimeId))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SHOWTIME_NOT_FOUND',
        `Không tìm thấy suất diễn có id ${showtimeId}`,
      );
    }
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
