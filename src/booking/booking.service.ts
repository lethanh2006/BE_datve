import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/role.enum';
import { PgError, pgConstraint, pgErrorCode } from '../common/db/pg-error';
import { ApiException } from '../common/exception/api.exception';
import { PageResponse } from '../common/response/page-response';
import { ShowtimeService } from '../showtime/showtime.service';
import { effectiveStatusSql, fetchBookings } from './booking-queries';
import { HOLD_MINUTES } from './booking-status.enum';
import {
  AdminBookingListQuery,
  BookingListQuery,
} from './dto/booking-list.query';
import { BookingResponse } from './dto/booking.response';
import { CheckInResponse, CheckInResult } from './dto/check-in.dto';
import { CreateBookingRequest } from './dto/create-booking.request';

/** Số đơn chưa thanh toán (còn hạn) tối đa của mỗi người, chống giữ ghế hàng loạt. */
export const MAX_ACTIVE_HOLDS_PER_USER = 5;

const ACTIVE_RESERVATION_INDEX =
  'booking_seats_one_active_reservation_per_seat';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class BookingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly showtimeService: ShowtimeService,
  ) {}

  async createBooking(
    user: AuthUser,
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

    // 2. Suất diễn phải tồn tại và chưa bắt đầu
    const showtime = await this.showtimeService.findOne(showtimeId);
    if (showtime.startTime.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SHOWTIME_CLOSED',
        'Suất diễn đã bắt đầu hoặc đã kết thúc, không thể đặt vé',
      );
    }

    try {
      const bookingId = await this.dataSource.transaction((em) =>
        this.holdSeats(em, user.id, showtimeId, seatIds),
      );
      return (await this.getOne(bookingId))!;
    } catch (e) {
      // Chốt chặn cuối cùng của DB: mỗi ghế chỉ có 1 reservation đang hoạt động
      if (
        pgErrorCode(e) === PgError.UNIQUE_VIOLATION &&
        pgConstraint(e) === ACTIVE_RESERVATION_INDEX
      ) {
        throw this.seatUnavailable();
      }
      throw e;
    }
  }

  private async holdSeats(
    em: EntityManager,
    userId: number,
    showtimeId: number,
    seatIds: number[],
  ): Promise<number> {
    // 3. Khoá dòng user để các lần đặt vé của cùng một người chạy tuần tự (kiểm tra giới hạn đơn đang giữ)
    const owners = await em.query<{ id: string }[]>(
      `SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE`,
      [userId],
    );
    if (!owners.length) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_TOKEN',
        'Tài khoản không còn tồn tại',
      );
    }

    // 4. Khoá những ghế user muốn giữ (ORDER BY id để các giao dịch khoá cùng thứ tự, tránh deadlock)
    const seats: { id: string; seatCode: string; faceValue: string }[] =
      await em.query(
        `SELECT id, seat_code AS "seatCode", face_value AS "faceValue"
       FROM seats
       WHERE showtime_id = $1 AND id = ANY($2::bigint[])
       ORDER BY id
       FOR UPDATE`,
        [showtimeId, seatIds],
      );

    // 5. Phải tìm thấy đầy đủ tất cả ghế
    if (seats.length !== seatIds.length) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SEAT_NOT_FOUND',
        'Một hoặc nhiều ghế không tồn tại trong suất diễn này',
      );
    }

    // 6. Giải phóng các đơn PENDING đã hết hạn đang giữ những ghế này
    await expireBookings(
      em,
      `SELECT DISTINCT b.id
       FROM bookings b
       JOIN booking_seats bs ON bs.booking_id = b.id
       WHERE bs.seat_id = ANY($1::bigint[])
         AND bs.reservation_status = 'HELD'
         AND b.status = 'PENDING'
         AND b.expires_at <= now()`,
      [seatIds],
    );

    // 7. Còn ghế nào đang HELD hoặc BOOKED không
    const [{ taken }] = await em.query<{ taken: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM booking_seats
         WHERE seat_id = ANY($1::bigint[]) AND reservation_status IN ('HELD', 'BOOKED')
       ) AS taken`,
      [seatIds],
    );
    if (taken) throw this.seatUnavailable();

    // 8. Giới hạn số đơn đang giữ ghế của mỗi người
    const [{ active }] = await em.query<{ active: number }[]>(
      `SELECT count(*)::int AS active FROM bookings
       WHERE user_id = $1 AND status = 'PENDING' AND expires_at > now()`,
      [userId],
    );
    if (active >= MAX_ACTIVE_HOLDS_PER_USER) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TOO_MANY_PENDING_BOOKINGS',
        `Bạn đang giữ ${active} đơn chưa thanh toán, hãy thanh toán hoặc huỷ bớt trước khi đặt thêm`,
      );
    }

    // 9. Tổng tiền tính từ giá trong DB (theo cent để tránh sai số số thực), giữ ghế theo giờ của DB
    const totalCents = seats.reduce(
      (sum, s) => sum + Math.round(Number(s.faceValue) * 100),
      0,
    );
    const [{ id }] = await em.query<{ id: string }[]>(
      `INSERT INTO bookings (user_id, showtime_id, status, total_amount, expires_at)
       VALUES ($1, $2, 'PENDING', $3, now() + make_interval(mins => $4))
       RETURNING id`,
      [userId, showtimeId, (totalCents / 100).toFixed(2), HOLD_MINUTES],
    );

    // 10. Tạo các booking_seats HELD
    await em.query(
      `INSERT INTO booking_seats (booking_id, showtime_id, seat_id, reservation_status, unit_price)
       SELECT $1, $2, t.seat_id, 'HELD', t.price
       FROM unnest($3::bigint[], $4::numeric[]) AS t(seat_id, price)`,
      [id, showtimeId, seats.map((s) => s.id), seats.map((s) => s.faceValue)],
    );
    return Number(id);
  }

  /** Các đơn của người đang đăng nhập, mới nhất trước. */
  async listMine(
    userId: number,
    query: BookingListQuery,
  ): Promise<PageResponse<BookingResponse>> {
    const where = `WHERE b.user_id = $1 AND ($2::text IS NULL OR ${effectiveStatusSql('b')} = $2)`;
    const params = [userId, query.status ?? null];
    const [idRows, counted] = await Promise.all([
      this.dataSource.query<{ id: string }[]>(
        `SELECT b.id FROM bookings b ${where}
         ORDER BY b.created_at DESC, b.id DESC LIMIT $3 OFFSET $4`,
        [...params, query.size, query.page * query.size],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM bookings b ${where}`,
        params,
      ),
    ]);
    const content = await fetchBookings(
      this.dataSource.manager,
      idRows.map((r) => Number(r.id)),
    );
    return PageResponse.of(content, query.page, query.size, counted[0].count);
  }

  /** Tất cả các đơn (quản trị), có thể lọc theo trạng thái và khách hàng. */
  async listAll(
    query: AdminBookingListQuery,
  ): Promise<PageResponse<BookingResponse>> {
    const pattern = query.q ? `%${escapeLike(query.q)}%` : null;
    const where = `JOIN users u ON u.id = b.user_id
      WHERE ($1::text IS NULL OR ${effectiveStatusSql('b')} = $1)
        AND ($2::text IS NULL OR u.email ILIKE $2 OR u.full_name ILIKE $2)`;
    const params = [query.status ?? null, pattern];
    const [idRows, counted] = await Promise.all([
      this.dataSource.query<{ id: string }[]>(
        `SELECT b.id FROM bookings b ${where}
         ORDER BY b.created_at DESC, b.id DESC LIMIT $3 OFFSET $4`,
        [...params, query.size, query.page * query.size],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM bookings b ${where}`,
        params,
      ),
    ]);
    const content = await fetchBookings(
      this.dataSource.manager,
      idRows.map((r) => Number(r.id)),
      true,
    );
    return PageResponse.of(content, query.page, query.size, counted[0].count);
  }

  /** Chi tiết 1 đơn; chỉ chủ đơn hoặc admin được xem (người khác nhận 404 để không lộ đơn tồn tại). */
  async getForUser(user: AuthUser, id: number): Promise<BookingResponse> {
    const [owner] = await this.dataSource.query<{ userId: string }[]>(
      `SELECT user_id AS "userId" FROM bookings WHERE id = $1`,
      [id],
    );
    const isAdmin = user.role === Role.ADMIN;
    if (!owner || (!isAdmin && owner.userId !== String(user.id)))
      throw this.notFound(id);
    return (await this.getOne(id, isAdmin))!;
  }

  async cancel(user: AuthUser, id: number): Promise<BookingResponse> {
    await this.dataSource.transaction(async (em) => {
      const [booking]: { userId: string; status: string }[] = await em.query(
        `SELECT user_id AS "userId", status FROM bookings WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (
        !booking ||
        (user.role !== Role.ADMIN && booking.userId !== String(user.id))
      ) {
        throw this.notFound(id);
      }

      switch (booking.status) {
        case 'PENDING':
          await em.query(
            `UPDATE bookings SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
            [id],
          );
          await em.query(
            `UPDATE booking_seats SET reservation_status = 'RELEASED'
             WHERE booking_id = $1 AND reservation_status = 'HELD'`,
            [id],
          );
          break;
        case 'CANCELLED':
        case 'EXPIRED':
          break; // đã được giải phóng, huỷ lại không có tác dụng gì
        case 'PAYMENT_PROCESSING':
          throw new ApiException(
            HttpStatus.CONFLICT,
            'INVALID_BOOKING_STATE',
            'Đơn đang được thanh toán, chưa thể huỷ',
          );
        default:
          throw new ApiException(
            HttpStatus.CONFLICT,
            'INVALID_BOOKING_STATE',
            'Đơn đã thanh toán, không thể huỷ',
          );
      }
    });
    return (await this.getOne(id, user.role === Role.ADMIN))!;
  }

  /**
   * Soát vé tại cửa: đánh dấu đơn đã vào lần đầu. Quét lại vé đã vào trả ALREADY_CHECKED_IN
   * (không phải lỗi) để nhân viên biết vé này đã được dùng.
   */
  async checkIn(ticketCode: string): Promise<CheckInResponse> {
    const { id, result } = await this.dataSource.transaction(
      async (em): Promise<{ id: string; result: CheckInResult }> => {
        const [row] = await em.query<
          { id: string; status: string; checkedInAt: Date | null }[]
        >(
          `SELECT id, status, checked_in_at AS "checkedInAt"
           FROM bookings WHERE ticket_code = $1 FOR UPDATE`,
          [ticketCode],
        );
        if (!row) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            'TICKET_NOT_FOUND',
            'Mã vé không hợp lệ',
          );
        }
        if (row.status !== 'CONFIRMED') {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'TICKET_INVALID',
            'Vé không còn hiệu lực',
          );
        }
        if (row.checkedInAt)
          return { id: row.id, result: 'ALREADY_CHECKED_IN' };

        await em.query(
          `UPDATE bookings SET checked_in_at = now(), updated_at = now() WHERE id = $1`,
          [row.id],
        );
        return { id: row.id, result: 'CHECKED_IN' };
      },
    );
    return { result, booking: (await this.getOne(Number(id), true))! };
  }

  /** Job nền: chuyển các đơn PENDING quá hạn sang EXPIRED và nhả ghế. Trả về số đơn đã xử lý. */
  expireStale(limit = 500): Promise<number> {
    return this.dataSource.transaction((em) =>
      expireBookings(
        em,
        `SELECT id FROM bookings
         WHERE status = 'PENDING' AND expires_at <= now()
         ORDER BY id LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      ),
    );
  }

  private async getOne(
    id: number,
    includeCustomer = false,
  ): Promise<BookingResponse | undefined> {
    return (
      await fetchBookings(this.dataSource.manager, [id], includeCustomer)
    )[0];
  }

  private seatUnavailable() {
    return new ApiException(
      HttpStatus.CONFLICT,
      'SEAT_UNAVAILABLE',
      'Một hoặc nhiều ghế không còn trống',
    );
  }

  private notFound(id: number) {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      'BOOKING_NOT_FOUND',
      `Không tìm thấy đơn đặt vé có id ${id}`,
    );
  }
}

/**
 * Chuyển các đơn do `selectIdsSql` chọn sang EXPIRED và nhả ghế đang HELD.
 * Khoá các dòng booking theo thứ tự id trước khi cập nhật để tránh deadlock giữa các giao dịch.
 */
export async function expireBookings(
  em: EntityManager,
  selectIdsSql: string,
  params: unknown[],
): Promise<number> {
  const picked = await em.query<{ id: string }[]>(selectIdsSql, params);
  if (!picked.length) return 0;

  const locked = await em.query<{ id: string }[]>(
    `SELECT id FROM bookings
     WHERE id = ANY($1::bigint[]) AND status = 'PENDING' AND expires_at <= now()
     ORDER BY id
     FOR UPDATE`,
    [picked.map((r) => r.id)],
  );
  if (!locked.length) return 0;

  const ids = locked.map((r) => r.id);
  await em.query(
    `UPDATE bookings SET status = 'EXPIRED', updated_at = now() WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  await em.query(
    `UPDATE booking_seats SET reservation_status = 'RELEASED'
     WHERE booking_id = ANY($1::bigint[]) AND reservation_status = 'HELD'`,
    [ids],
  );
  return ids.length;
}
