import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';
import { ShowtimeService } from '../showtime/showtime.service';
import { SeatResponse } from './dto/seat.response';
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
    const rows: SeatStatusRow[] = await this.dataSource.query(
      `SELECT s.id          AS "id",
              s.seat_code   AS "seatCode",
              s.category    AS "category",
              s.face_value  AS "faceValue",
              CASE
                  WHEN EXISTS (
                      SELECT 1 FROM booking_seats bs
                      WHERE bs.seat_id = s.id
                        AND bs.reservation_status = 'BOOKED'
                  ) THEN 'BOOKED'
                  WHEN EXISTS (
                      SELECT 1 FROM booking_seats bs
                      JOIN bookings b ON b.id = bs.booking_id
                      WHERE bs.seat_id = s.id
                        AND bs.reservation_status = 'HELD'
                        AND b.expires_at > now()
                  ) THEN 'HELD'
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
