import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/role.enum';
import { effectiveStatusSql } from '../booking/booking-queries';
import { BookingStatus } from '../booking/booking-status.enum';
import { PgError, pgConstraint, pgErrorCode } from '../common/db/pg-error';
import { ApiException } from '../common/exception/api.exception';
import { PayRequest } from './dto/pay.request';
import { PaymentResponse } from './dto/payment.response';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import type { ChargeResult, PaymentGateway } from './gateway/payment-gateway';
import { PaymentStatus } from './payment-status.enum';

/** Payment ở PROCESSING quá lâu (tiến trình chết giữa chừng) sẽ bị job phục hồi coi là thất bại. */
export const STUCK_PAYMENT_MINUTES = 2;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,100}$/;
const IDEMPOTENCY_CONSTRAINT = 'payments_idempotency_key_key';

interface PaymentRow {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  amount: string;
  provider: string;
  providerReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  bookingStatus: BookingStatus;
}

const SELECT_PAYMENT = `
  SELECT p.id, p.booking_id AS "bookingId", p.status, p.amount, p.provider,
         p.provider_reference AS "providerReference",
         p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         ${effectiveStatusSql('b')} AS "bookingStatus"
  FROM payments p
  JOIN bookings b ON b.id = p.booking_id`;

const toResponse = (r: PaymentRow): PaymentResponse => ({
  id: Number(r.id),
  bookingId: Number(r.bookingId),
  status: r.status,
  amount: Number(r.amount),
  provider: r.provider,
  providerReference: r.providerReference,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  bookingStatus: r.bookingStatus,
});

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * Thanh toán 1 đơn. Gồm 2 giao dịch DB tách nhau để không giữ khoá trong lúc gọi cổng thanh toán:
   *  1. Tạo payment PROCESSING và chuyển đơn sang PAYMENT_PROCESSING (ghế vẫn được giữ).
   *  2. Gọi cổng thanh toán, rồi ghi kết quả: thành công thì đơn CONFIRMED và ghế BOOKED,
   *     thất bại thì đơn quay lại PENDING (còn hạn) để thử lại với Idempotency-Key mới.
   * Gọi lại với cùng Idempotency-Key sẽ nhận lại kết quả cũ, không trừ tiền lần nữa.
   */
  async pay(
    user: AuthUser,
    bookingId: number,
    idempotencyKey: string | undefined,
    dto: PayRequest,
  ): Promise<{ payment: PaymentResponse; replayed: boolean }> {
    if (!idempotencyKey) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Thiếu header Idempotency-Key',
      );
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key gồm 8-100 ký tự chữ, số hoặc _ - : .',
      );
    }

    const started = await this.begin(user, bookingId, idempotencyKey);
    if (started.fresh) {
      const simulate =
        this.config.get('PAYMENT_ALLOW_SIMULATION') === 'true'
          ? dto.simulate
          : undefined;
      await this.settle(
        started.paymentId,
        bookingId,
        started.amount,
        idempotencyKey,
        simulate,
      );
    }
    return {
      payment: await this.getById(started.paymentId),
      replayed: !started.fresh,
    };
  }

  async getForUser(
    user: AuthUser,
    paymentId: number,
  ): Promise<PaymentResponse> {
    const rows: (PaymentRow & { ownerId: string })[] =
      await this.dataSource.query(
        `${SELECT_PAYMENT} WHERE p.id = $1`.replace(
          'SELECT p.id,',
          'SELECT b.user_id AS "ownerId", p.id,',
        ),
        [paymentId],
      );
    if (
      !rows.length ||
      (user.role !== Role.ADMIN && rows[0].ownerId !== String(user.id))
    ) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PAYMENT_NOT_FOUND',
        `Không tìm thấy giao dịch có id ${paymentId}`,
      );
    }
    return toResponse(rows[0]);
  }

  async listForBooking(
    user: AuthUser,
    bookingId: number,
  ): Promise<PaymentResponse[]> {
    const [booking] = await this.dataSource.query<{ userId: string }[]>(
      `SELECT user_id AS "userId" FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (
      !booking ||
      (user.role !== Role.ADMIN && booking.userId !== String(user.id))
    ) {
      throw this.bookingNotFound(bookingId);
    }
    const rows = await this.dataSource.query<PaymentRow[]>(
      `${SELECT_PAYMENT} WHERE p.booking_id = $1 ORDER BY p.id DESC`,
      [bookingId],
    );
    return rows.map(toResponse);
  }

  /** Job nền: payment kẹt ở PROCESSING coi như thất bại để người dùng có thể thử lại. */
  async recoverStuck(): Promise<number> {
    const stuck: { id: string; bookingId: string }[] =
      await this.dataSource.query(
        `SELECT id, booking_id AS "bookingId" FROM payments
       WHERE status = 'PROCESSING' AND updated_at < now() - make_interval(mins => $1)
       ORDER BY id LIMIT 100`,
        [STUCK_PAYMENT_MINUTES],
      );
    let recovered = 0;
    for (const { id, bookingId } of stuck) {
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT id FROM bookings WHERE id = $1 FOR UPDATE`, [
          bookingId,
        ]);
        const [payment] = await em.query<{ status: PaymentStatus }[]>(
          `SELECT status FROM payments WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (payment?.status !== PaymentStatus.PROCESSING) return;
        await this.markFailed(em, Number(id), Number(bookingId));
        recovered++;
      });
    }
    return recovered;
  }

  // ---- giao dịch 1: tạo payment PROCESSING ----
  private async begin(user: AuthUser, bookingId: number, key: string) {
    try {
      return await this.dataSource.transaction(async (em) => {
        const [booking]: {
          id: string;
          userId: string;
          status: BookingStatus;
          totalAmount: string;
          expired: boolean;
        }[] = await em.query(
          `SELECT id, user_id AS "userId", status, total_amount AS "totalAmount",
                  (expires_at <= now()) AS expired
           FROM bookings WHERE id = $1 FOR UPDATE`,
          [bookingId],
        );
        // Chỉ chủ đơn được thanh toán; người khác nhận 404 để không lộ đơn tồn tại
        if (!booking || booking.userId !== String(user.id))
          throw this.bookingNotFound(bookingId);

        // Kiểm tra key sau khi đã khoá đơn: hai request song song cùng key sẽ xếp hàng, request sau nhận lại kết quả của request trước
        const [existing]: { id: string; bookingId: string }[] = await em.query(
          `SELECT id, booking_id AS "bookingId" FROM payments WHERE idempotency_key = $1`,
          [key],
        );
        if (existing) {
          if (existing.bookingId !== booking.id) throw this.keyConflict();
          return {
            fresh: false as const,
            paymentId: Number(existing.id),
            amount: booking.totalAmount,
          };
        }

        switch (booking.status) {
          case BookingStatus.CONFIRMED:
            throw this.conflict(
              'BOOKING_ALREADY_PAID',
              'Đơn đã được thanh toán',
            );
          case BookingStatus.PAYMENT_PROCESSING:
            throw this.conflict(
              'PAYMENT_IN_PROGRESS',
              'Đơn đang được thanh toán, vui lòng chờ kết quả',
            );
          case BookingStatus.CANCELLED:
            throw this.conflict('BOOKING_CANCELLED', 'Đơn đã bị huỷ');
          case BookingStatus.EXPIRED:
            throw this.conflict('BOOKING_EXPIRED', 'Đơn đã hết hạn giữ ghế');
        }
        if (booking.expired)
          throw this.conflict('BOOKING_EXPIRED', 'Đơn đã hết hạn giữ ghế');

        // Số tiền luôn lấy từ đơn trong DB, không nhận từ client
        const [{ id }] = await em.query<{ id: string }[]>(
          `INSERT INTO payments (booking_id, idempotency_key, provider, status, amount)
           VALUES ($1, $2, $3, 'PROCESSING', $4) RETURNING id`,
          [booking.id, key, this.gateway.name, booking.totalAmount],
        );
        await em.query(
          `UPDATE bookings SET status = 'PAYMENT_PROCESSING', updated_at = now() WHERE id = $1`,
          [booking.id],
        );
        return {
          fresh: true as const,
          paymentId: Number(id),
          amount: booking.totalAmount,
        };
      });
    } catch (e) {
      // Hai đơn khác nhau dùng chung key cùng lúc
      if (
        pgErrorCode(e) === PgError.UNIQUE_VIOLATION &&
        pgConstraint(e) === IDEMPOTENCY_CONSTRAINT
      ) {
        throw this.keyConflict();
      }
      throw e;
    }
  }

  // ---- gọi cổng thanh toán rồi ghi kết quả (giao dịch 2) ----
  private async settle(
    paymentId: number,
    bookingId: number,
    amount: string,
    key: string,
    simulate?: 'SUCCESS' | 'FAILED',
  ) {
    let result: ChargeResult;
    try {
      result = await this.gateway.charge({
        amount,
        bookingId: String(bookingId),
        idempotencyKey: key,
        simulate,
      });
    } catch (e) {
      this.logger.error(
        `Cổng thanh toán lỗi (payment ${paymentId})`,
        e instanceof Error ? e.stack : String(e),
      );
      result = { status: 'FAILED', providerReference: null };
    }

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM bookings WHERE id = $1 FOR UPDATE`, [
        bookingId,
      ]);
      const [payment] = await em.query<{ status: PaymentStatus }[]>(
        `SELECT status FROM payments WHERE id = $1 FOR UPDATE`,
        [paymentId],
      );
      // Job phục hồi đã xử lý payment này rồi thì giữ nguyên kết quả đó
      if (payment?.status !== PaymentStatus.PROCESSING) return;

      if (result.status === 'SUCCESS') {
        await em.query(
          `UPDATE payments SET status = 'SUCCESS', provider_reference = $2, updated_at = now() WHERE id = $1`,
          [paymentId, result.providerReference],
        );
        await em.query(
          `UPDATE bookings
           SET status = 'CONFIRMED',
               ticket_code = COALESCE(ticket_code, substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
               updated_at = now()
           WHERE id = $1`,
          [bookingId],
        );
        await em.query(
          `UPDATE booking_seats SET reservation_status = 'BOOKED'
           WHERE booking_id = $1 AND reservation_status = 'HELD'`,
          [bookingId],
        );
      } else {
        await this.markFailed(em, paymentId, bookingId);
      }
    });
  }

  /** Payment thất bại: đơn quay lại PENDING nếu còn hạn, ngược lại hết hạn và nhả ghế. Gọi khi đã khoá đơn. */
  private async markFailed(
    em: EntityManager,
    paymentId: number,
    bookingId: number,
  ) {
    await em.query(
      `UPDATE payments SET status = 'FAILED', updated_at = now() WHERE id = $1`,
      [paymentId],
    );
    const [{ expired }] = await em.query<{ expired: boolean }[]>(
      `SELECT (expires_at <= now()) AS expired FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (expired) {
      await em.query(
        `UPDATE bookings SET status = 'EXPIRED', updated_at = now()
         WHERE id = $1 AND status = 'PAYMENT_PROCESSING'`,
        [bookingId],
      );
      await em.query(
        `UPDATE booking_seats SET reservation_status = 'RELEASED'
         WHERE booking_id = $1 AND reservation_status = 'HELD'`,
        [bookingId],
      );
    } else {
      await em.query(
        `UPDATE bookings SET status = 'PENDING', updated_at = now()
         WHERE id = $1 AND status = 'PAYMENT_PROCESSING'`,
        [bookingId],
      );
    }
  }

  private async getById(paymentId: number): Promise<PaymentResponse> {
    const rows = await this.dataSource.query<PaymentRow[]>(
      `${SELECT_PAYMENT} WHERE p.id = $1`,
      [paymentId],
    );
    return toResponse(rows[0]);
  }

  private conflict(code: string, message: string) {
    return new ApiException(HttpStatus.CONFLICT, code, message);
  }

  private keyConflict() {
    return this.conflict(
      'IDEMPOTENCY_KEY_CONFLICT',
      'Idempotency-Key này đã được dùng cho một đơn khác',
    );
  }

  private bookingNotFound(id: number) {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      'BOOKING_NOT_FOUND',
      `Không tìm thấy đơn đặt vé có id ${id}`,
    );
  }
}
