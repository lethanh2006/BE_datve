import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';
import { ShowtimeService } from '../showtime/showtime.service';
import { BookingSeat } from './booking-seat.entity';
import { BookingSeatStatus, BookingStatus } from './booking-status.enum';
import { Booking } from './booking.entity';
import { CreateBookingRequest } from './dto/create-booking.request';
import { BookingResponse } from './dto/booking.response';

const HOLD_MINUTES = 5;

interface LockedSeat {
  id: string;
  seatCode: string;
  faceValue: string;
}

@Injectable()
export class BookingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly showtimeService: ShowtimeService,
  ) {}

  async createBooking(
    userId: number,
    showtimeId: number,
    request: CreateBookingRequest,
  ): Promise<BookingResponse> {
    const seatIds = request.seatIds;

    // 1. Kiểm tra seat ID bị trùng
    if (new Set(seatIds).size !== seatIds.length) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'DUPLICATE_SEAT_ID',
        'Danh sách ghế không được chứa seat ID trùng nhau',
      );
    }

    // 2. Kiểm tra showtime tồn tại
    if (!(await this.showtimeService.exists(showtimeId))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SHOWTIME_NOT_FOUND',
        `Không tìm thấy suất diễn có id ${showtimeId}`,
      );
    }

    return this.dataSource.transaction((em) =>
      this.holdSeats(em, userId, showtimeId, seatIds),
    );
  }

  private async holdSeats(
    em: EntityManager,
    userId: number,
    showtimeId: number,
    seatIds: number[],
  ): Promise<BookingResponse> {
    // 3. Lock những ghế user muốn giữ (ORDER BY id để tránh deadlock)
    const seats: LockedSeat[] = await em.query(
      `SELECT id, seat_code AS "seatCode", face_value AS "faceValue"
       FROM seats
       WHERE showtime_id = $1 AND id = ANY($2::bigint[])
       ORDER BY id
       FOR UPDATE`,
      [showtimeId, seatIds],
    );

    // 4. Phải tìm thấy đầy đủ tất cả ghế
    if (seats.length !== seatIds.length) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SEAT_NOT_FOUND',
        'Một hoặc nhiều ghế không tồn tại trong suất diễn này',
      );
    }

    const now = new Date();

    // 5. Giải phóng các booking PENDING đã hết hạn đang giữ những ghế này
    const expired: { id: string }[] = await em.query(
      `SELECT DISTINCT b.id
       FROM bookings b
       JOIN booking_seats bs ON bs.booking_id = b.id
       WHERE bs.seat_id = ANY($1::bigint[])
         AND bs.reservation_status = 'HELD'
         AND b.status = 'PENDING'
         AND b.expires_at <= $2`,
      [seatIds, now],
    );
    if (expired.length > 0) {
      const expiredIds = expired.map((r) => r.id);
      await em.query(
        `UPDATE bookings SET status = 'EXPIRED', updated_at = now()
         WHERE id = ANY($1::bigint[])`,
        [expiredIds],
      );
      await em.query(
        `UPDATE booking_seats SET reservation_status = 'RELEASED'
         WHERE booking_id = ANY($1::bigint[]) AND reservation_status = 'HELD'`,
        [expiredIds],
      );
    }

    // 6. Kiểm tra có ghế đang HELD hoặc BOOKED không
    const [{ unavailable }]: { unavailable: boolean }[] = await em.query(
      `SELECT EXISTS (
         SELECT 1 FROM booking_seats
         WHERE seat_id = ANY($1::bigint[])
           AND reservation_status IN ('HELD', 'BOOKED')
       ) AS unavailable`,
      [seatIds],
    );
    if (unavailable) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SEAT_UNAVAILABLE',
        'Một hoặc nhiều ghế không còn trống',
      );
    }

    // 7. Tính tổng tiền từ database (tính theo cent để tránh sai số số thực)
    const totalCents = seats.reduce(
      (sum, s) => sum + Math.round(Number(s.faceValue) * 100),
      0,
    );
    const totalAmount = totalCents / 100;

    // 8. Giữ ghế 5 phút
    const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    // 9. Tạo booking
    const booking = await em.save(
      em.create(Booking, {
        userId: String(userId),
        showtimeId: String(showtimeId),
        status: BookingStatus.PENDING,
        totalAmount: totalAmount.toFixed(2),
        expiresAt,
      }),
    );

    // 10. Tạo các booking_seats HELD
    await em.save(
      seats.map((s) =>
        em.create(BookingSeat, {
          bookingId: booking.id,
          showtimeId: String(showtimeId),
          seatId: s.id,
          reservationStatus: BookingSeatStatus.HELD,
          unitPrice: s.faceValue,
        }),
      ),
    );

    // 11. Tạo response
    return {
      id: Number(booking.id),
      showtimeId,
      status: BookingStatus.PENDING,
      seats: seats.map((s) => ({
        seatId: Number(s.id),
        seatCode: s.seatCode,
        unitPrice: Number(s.faceValue),
      })),
      totalAmount,
      expiresAt,
    };
  }
}
