import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/role.enum';
import { bookingCode } from '../booking/booking-code';
import { effectiveStatusSql } from '../booking/booking-queries';
import { BookingStatus } from '../booking/booking-status.enum';
import { BookingService } from '../booking/booking.service';
import { BookingResponse } from '../booking/dto/booking.response';
import { RefundPolicy } from '../booking/refund-policy';
import { PgError, pgConstraint, pgErrorCode } from '../common/db/pg-error';
import { ApiException } from '../common/exception/api.exception';
import { MailService } from '../mail/mail.service';
import { bookingConfirmedEmail, bookingRefundedEmail } from '../mail/templates';
import { MailMessage } from '../mail/mail.types';
import { PayRequest } from './dto/pay.request';
import { RefundBookingRequest } from './dto/refund.request';
import { PaymentResponse } from './dto/payment.response';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import type {
  ChargeResult,
  PaymentGateway,
  RefundResult,
} from './gateway/payment-gateway';
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
    private readonly bookings: BookingService,
    private readonly mail: MailService,
    private readonly policy: RefundPolicy,
  ) {
    this.appUrl = config
      .get<string>('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
  }

  private readonly appUrl: string;

  /** Cho phép client ép kết quả của cổng thanh toán giả (chỉ khi dev/demo). */
  private simulation(
    requested: 'SUCCESS' | 'FAILED' | undefined,
  ): 'SUCCESS' | 'FAILED' | undefined {
    return this.config.get('PAYMENT_ALLOW_SIMULATION') === 'true'
      ? requested
      : undefined;
  }

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
      const confirmed = await this.settle(
        started.paymentId,
        bookingId,
        started.amount,
        idempotencyKey,
        this.simulation(dto.simulate),
      );
      if (confirmed) {
        this.notify(bookingId, (b) =>
          bookingConfirmedEmail({
            ...this.mailData(b),
            ticketCode: b.ticketCode ?? '',
          }),
        );
      }
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
          cancelled: boolean;
        }[] = await em.query(
          `SELECT b.id, b.user_id AS "userId", b.status, b.total_amount AS "totalAmount",
                  (b.expires_at <= now()) AS expired, (s.cancelled_at IS NOT NULL) AS cancelled
           FROM bookings b JOIN showtimes s ON s.id = b.showtime_id
           WHERE b.id = $1 FOR UPDATE OF b`,
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
        if (booking.cancelled) {
          throw this.conflict(
            'SHOWTIME_CANCELLED',
            'Suất diễn đã bị huỷ, không thể thanh toán',
          );
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
  ): Promise<boolean> {
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

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT id FROM bookings WHERE id = $1 FOR UPDATE`, [
        bookingId,
      ]);
      const [payment] = await em.query<{ status: PaymentStatus }[]>(
        `SELECT status FROM payments WHERE id = $1 FOR UPDATE`,
        [paymentId],
      );
      // Job phục hồi đã xử lý payment này rồi thì giữ nguyên kết quả đó
      if (payment?.status !== PaymentStatus.PROCESSING) return false;

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
        return true;
      }
      await this.markFailed(em, paymentId, bookingId);
      return false;
    });
  }

  /**
   * Huỷ vé đã thanh toán và hoàn tiền. Chủ đơn chỉ hoàn được trước giờ diễn tối thiểu REFUND_WINDOW_HOURS giờ
   * và khi vé chưa được soát; admin không bị giới hạn thời hạn. Gọi lại khi đã hoàn thì trả kết quả hiện tại.
   *
   * Gọi cổng thanh toán ngay trong giao dịch DB đang khoá dòng đơn: chỉ chặn đúng đơn này (chính là điều cần),
   * và nếu cổng lỗi thì không có gì thay đổi. Khoá hoàn tiền cố định theo giao dịch nên nếu commit thất bại
   * rồi người dùng thử lại, cổng sẽ không hoàn tiền hai lần.
   */
  async refund(
    user: AuthUser,
    bookingId: number,
    dto: RefundBookingRequest,
  ): Promise<BookingResponse> {
    return (await this.refundDetailed(user, bookingId, dto)).booking;
  }

  /**
   * Như `refund` nhưng cho biết lần gọi này có thật sự hoàn tiền không (`refundedNow`, false nếu đơn đã được hoàn trước đó)
   * để nơi gọi (ví dụ hoàn hàng loạt khi huỷ suất diễn) gửi thông báo đúng một lần; và cho phép tự gửi email riêng.
   */
  async refundDetailed(
    user: AuthUser,
    bookingId: number,
    dto: RefundBookingRequest,
    options: { notify?: boolean } = {},
  ): Promise<{ booking: BookingResponse; refundedNow: boolean }> {
    const isAdmin = user.role === Role.ADMIN;

    const refundedNow = await this.dataSource.transaction(async (em) => {
      const [booking] = await em.query<
        {
          userId: string;
          status: BookingStatus;
          checkedInAt: Date | null;
          pastDeadline: boolean;
        }[]
      >(
        `SELECT b.user_id AS "userId", b.status, b.checked_in_at AS "checkedInAt",
                (s.start_time - make_interval(secs => $2) <= now()) AS "pastDeadline"
         FROM bookings b
         JOIN showtimes s ON s.id = b.showtime_id
         WHERE b.id = $1
         FOR UPDATE OF b`,
        [bookingId, this.policy.windowSeconds],
      );
      if (!booking || (!isAdmin && booking.userId !== String(user.id))) {
        throw this.bookingNotFound(bookingId);
      }

      if (booking.status === BookingStatus.CANCELLED) {
        const [done] = await em.query<unknown[]>(
          `SELECT 1 FROM payments WHERE booking_id = $1 AND status = 'REFUNDED' LIMIT 1`,
          [bookingId],
        );
        if (done) return false; // đã hoàn trước đó
      }
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw this.conflict(
          'INVALID_BOOKING_STATE',
          'Chỉ đơn đã thanh toán mới có thể hoàn tiền',
        );
      }
      if (booking.checkedInAt) {
        throw this.conflict(
          'TICKET_USED',
          'Vé đã được sử dụng nên không thể hoàn tiền',
        );
      }
      if (!isAdmin && booking.pastDeadline) {
        throw this.conflict(
          'REFUND_WINDOW_PASSED',
          `Đã quá thời hạn hoàn vé (cần huỷ trước giờ diễn ít nhất ${this.policy.windowHours} giờ)`,
        );
      }

      const [payment] = await em.query<
        { id: string; amount: string; providerReference: string | null }[]
      >(
        `SELECT id, amount, provider_reference AS "providerReference"
         FROM payments WHERE booking_id = $1 AND status = 'SUCCESS'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [bookingId],
      );
      if (!payment) {
        throw this.conflict(
          'PAYMENT_NOT_FOUND',
          'Không tìm thấy giao dịch thanh toán của đơn này',
        );
      }

      let result: RefundResult;
      try {
        result = await this.gateway.refund({
          amount: payment.amount,
          providerReference: payment.providerReference,
          idempotencyKey: `refund-${payment.id}`,
          simulate: this.simulation(dto.simulate),
        });
      } catch (e) {
        this.logger.error(
          `Cổng thanh toán lỗi khi hoàn tiền (payment ${payment.id})`,
          e instanceof Error ? e.stack : String(e),
        );
        result = { status: 'FAILED', providerReference: null };
      }
      if (result.status !== 'SUCCESS') {
        throw this.conflict(
          'REFUND_FAILED',
          'Cổng thanh toán chưa hoàn tiền được, vui lòng thử lại sau',
        );
      }

      await em.query(
        `UPDATE payments SET status = 'REFUNDED', refunded_at = now(), updated_at = now() WHERE id = $1`,
        [payment.id],
      );
      await em.query(
        `UPDATE bookings SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
        [bookingId],
      );
      await em.query(
        `UPDATE booking_seats SET reservation_status = 'RELEASED'
         WHERE booking_id = $1 AND reservation_status = 'BOOKED'`,
        [bookingId],
      );
      return true;
    });

    if (refundedNow && options.notify !== false) {
      this.notify(bookingId, (b) =>
        bookingRefundedEmail({ ...this.mailData(b), refund: b.totalAmount }),
      );
    }
    return {
      booking: (await this.bookings.findDetail(bookingId, isAdmin))!,
      refundedNow,
    };
  }

  private mailData(b: BookingResponse) {
    return {
      name: b.customer?.fullName ?? '',
      bookingCode: bookingCode(b.id),
      eventName: b.eventName,
      venue: b.venue,
      startTime: b.startTime,
      seats: b.seats.map((s) => s.seatCode),
      total: b.totalAmount,
      link: `${this.appUrl}/bookings/${b.id}`,
    };
  }

  /** Gửi email về đơn, không chờ kết quả và không bao giờ làm hỏng luồng gọi nó. */
  private notify(
    bookingId: number,
    build: (
      booking: BookingResponse,
    ) => Pick<MailMessage, 'subject' | 'text' | 'html'>,
  ) {
    void this.bookings
      .findDetail(bookingId, true)
      .then((booking) => {
        if (!booking?.customer) return;
        return this.mail.send({
          to: booking.customer.email,
          ...build(booking),
        });
      })
      .catch((e: unknown) =>
        this.logger.error(
          `Không gửi được email cho đơn ${bookingId}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
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
