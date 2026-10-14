import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/role.enum';
import { bookingCode } from '../booking/booking-code';
import { BookingService } from '../booking/booking.service';
import { ApiException } from '../common/exception/api.exception';
import { MailService } from '../mail/mail.service';
import { showtimeCancelledEmail } from '../mail/templates';
import { PaymentService } from '../payment/payment.service';
import { CancellationStatus } from './dto/cancel-showtime.dto';

/** Tác nhân hệ thống khi tự hoàn tiền: được vượt thời hạn hoàn vé như admin. */
const SYSTEM_ACTOR: AuthUser = {
  id: 0,
  email: 'system@datve.local',
  role: Role.ADMIN,
};
/** Chờ bao lâu trước lần hoàn tiền kế tiếp của một đơn bị lỗi (giây), theo số lần đã thử: 1 phút, 5 phút, 15 phút, 1 giờ... */
const BACKOFF_SECONDS = [60, 300, 900, 3600];
const BATCH_SIZE = 20;
const PARALLEL_REFUNDS = 4;

/**
 * Huỷ suất diễn và hoàn tiền hàng loạt.
 *
 * `cancel` chỉ đánh dấu suất bị huỷ (ngừng bán) và nhả ghế các đơn chưa thanh toán rồi trả về ngay; việc hoàn tiền cho
 * từng đơn đã thanh toán do `sweep` thực hiện nền. Làm theo kiểu "quét" thay vì vòng lặp trong request vì:
 *  - hoàn tiền qua cổng thanh toán chậm, suất lớn có thể có hàng trăm đơn;
 *  - sống sót qua việc khởi động lại và chạy được trên nhiều instance (mỗi lần hoàn đã idempotent và khoá theo đơn);
 *  - đơn lỗi được thử lại có giãn cách, và đơn thanh toán dở lúc huỷ cũng tự được hoàn khi hoàn tất.
 */
@Injectable()
export class ShowtimeCancellationService implements OnModuleDestroy {
  private readonly logger = new Logger(ShowtimeCancellationService.name);
  private readonly appUrl: string;
  private running: Promise<number> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly bookings: BookingService,
    private readonly payments: PaymentService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {
    this.appUrl = config
      .get<string>('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
  }

  async onModuleDestroy() {
    await this.running?.catch(() => undefined);
  }

  async cancel(
    showtimeId: number,
    reason: string,
  ): Promise<CancellationStatus> {
    await this.dataSource.transaction(async (em) => {
      const [showtime] = await em.query<
        { cancelledAt: Date | null; ended: boolean }[]
      >(
        `SELECT cancelled_at AS "cancelledAt", (end_time <= now()) AS ended
         FROM showtimes WHERE id = $1 FOR NO KEY UPDATE`,
        [showtimeId],
      );
      if (!showtime) throw this.notFound(showtimeId);
      if (showtime.cancelledAt) return; // đã huỷ rồi: gọi lại chỉ để kích hoạt lại việc hoàn tiền
      if (showtime.ended) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'SHOWTIME_ENDED',
          'Suất diễn đã kết thúc, không thể huỷ',
        );
      }
      await em.query(
        `UPDATE showtimes SET cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
        [showtimeId, reason],
      );
    });

    await this.releaseUnpaid(showtimeId);
    void this.sweep().catch((e: unknown) => this.logger.error(e));
    return this.status(showtimeId);
  }

  async status(showtimeId: number): Promise<CancellationStatus> {
    const [row] = await this.dataSource.query<
      {
        cancelledAt: Date | null;
        reason: string | null;
        pendingRefunds: number;
        refunded: number;
        checkedIn: number;
        paymentsInProgress: number;
      }[]
    >(
      `SELECT s.cancelled_at AS "cancelledAt", s.cancel_reason AS reason,
              count(b.id) FILTER (WHERE b.status = 'CONFIRMED' AND b.checked_in_at IS NULL)::int AS "pendingRefunds",
              count(b.id) FILTER (WHERE b.status = 'CONFIRMED' AND b.checked_in_at IS NOT NULL)::int AS "checkedIn",
              count(b.id) FILTER (WHERE b.status = 'PAYMENT_PROCESSING')::int AS "paymentsInProgress",
              count(b.id) FILTER (WHERE EXISTS (
                SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'REFUNDED'))::int AS refunded
       FROM showtimes s LEFT JOIN bookings b ON b.showtime_id = s.id
       WHERE s.id = $1 GROUP BY s.id`,
      [showtimeId],
    );
    if (!row) throw this.notFound(showtimeId);
    if (!row.cancelledAt) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'SHOWTIME_NOT_CANCELLED',
        'Suất diễn này chưa bị huỷ',
      );
    }

    const failures = await this.dataSource.query<
      { bookingId: string; attempts: number; error: string }[]
    >(
      `SELECT id AS "bookingId", refund_attempts AS attempts, refund_error AS error
       FROM bookings
       WHERE showtime_id = $1 AND status = 'CONFIRMED' AND checked_in_at IS NULL AND refund_error IS NOT NULL
       ORDER BY id LIMIT 20`,
      [showtimeId],
    );
    return {
      showtimeId,
      cancelledAt: row.cancelledAt,
      reason: row.reason,
      pendingRefunds: row.pendingRefunds,
      refunded: row.refunded,
      checkedIn: row.checkedIn,
      paymentsInProgress: row.paymentsInProgress,
      failures: failures.map((f) => ({
        bookingId: Number(f.bookingId),
        attempts: f.attempts,
        error: f.error,
      })),
    };
  }

  /**
   * Một lượt quét: huỷ các đơn chưa thanh toán còn sót và hoàn tiền một lô đơn đã thanh toán của các suất bị huỷ.
   * Nhiều lượt gọi chồng nhau trong cùng tiến trình dùng chung một lượt đang chạy. Trả về số đơn đã hoàn.
   */
  sweep(): Promise<number> {
    this.running ??= this.doSweep().finally(() => (this.running = null));
    return this.running;
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async worker() {
    if (this.config.get('SCHEDULER_ENABLED') === 'false') return;
    try {
      await this.sweep();
    } catch (e) {
      this.logger.error(
        'Lượt hoàn tiền do huỷ suất diễn bị lỗi',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  private async doSweep(): Promise<number> {
    // Đơn quay về PENDING sau khi suất đã huỷ (ví dụ thanh toán dở thất bại) cũng phải được nhả ghế
    const strays = await this.dataSource.query<{ showtimeId: string }[]>(
      `SELECT DISTINCT b.showtime_id AS "showtimeId" FROM bookings b
       JOIN showtimes s ON s.id = b.showtime_id
       WHERE s.cancelled_at IS NOT NULL AND b.status = 'PENDING'`,
    );
    for (const { showtimeId } of strays)
      await this.releaseUnpaid(Number(showtimeId));

    const due = await this.dataSource.query<{ id: string }[]>(
      `SELECT b.id FROM bookings b
       JOIN showtimes s ON s.id = b.showtime_id
       WHERE s.cancelled_at IS NOT NULL AND b.status = 'CONFIRMED' AND b.checked_in_at IS NULL
         AND (b.refund_retry_at IS NULL OR b.refund_retry_at <= now())
       ORDER BY b.id LIMIT $1`,
      [BATCH_SIZE],
    );

    let refunded = 0;
    const queue = due.map((r) => Number(r.id));
    const workers = Array.from(
      { length: Math.min(PARALLEL_REFUNDS, queue.length) },
      async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          if (await this.refundOne(id)) refunded++;
        }
      },
    );
    await Promise.all(workers);
    return refunded;
  }

  private async refundOne(bookingId: number): Promise<boolean> {
    try {
      const { refundedNow } = await this.payments.refundDetailed(
        SYSTEM_ACTOR,
        bookingId,
        {},
        { notify: false },
      );
      await this.dataSource.query(
        `UPDATE bookings SET refund_error = NULL, refund_retry_at = NULL WHERE id = $1`,
        [bookingId],
      );
      if (refundedNow) this.notifyCustomer(bookingId);
      return refundedNow;
    } catch (error) {
      // Vừa được soát vé trong lúc quét: không tự hoàn nữa
      if (error instanceof ApiException && error.code === 'TICKET_USED')
        return false;
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      this.logger.warn(
        `Hoàn tiền đơn ${bookingId} do huỷ suất diễn thất bại: ${message}`,
      );
      // Giãn cách thử lại tăng dần: 1 phút, 5 phút, 15 phút rồi 1 giờ/lần
      await this.dataSource.query(
        `UPDATE bookings
         SET refund_attempts = refund_attempts + 1, refund_error = $2,
             refund_retry_at = now() + make_interval(secs =>
               (ARRAY[${BACKOFF_SECONDS.join(',')}])[LEAST(refund_attempts + 1, ${BACKOFF_SECONDS.length})])
         WHERE id = $1`,
        [bookingId, message],
      );
      return false;
    }
  }

  /** Nhả ghế và đóng các đơn chưa thanh toán của suất diễn đã huỷ. Trả về số đơn đã đóng. */
  private async releaseUnpaid(showtimeId: number): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const pending = await em.query<{ id: string }[]>(
        `SELECT id FROM bookings WHERE showtime_id = $1 AND status = 'PENDING' ORDER BY id FOR UPDATE`,
        [showtimeId],
      );
      if (!pending.length) return 0;
      const ids = pending.map((r) => r.id);
      await em.query(
        `UPDATE bookings SET status = 'CANCELLED', updated_at = now() WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      await em.query(
        `UPDATE booking_seats SET reservation_status = 'RELEASED'
         WHERE booking_id = ANY($1::bigint[]) AND reservation_status = 'HELD'`,
        [ids],
      );
      return ids.length;
    });
  }

  private notifyCustomer(bookingId: number) {
    void this.bookings
      .findDetail(bookingId, true)
      .then((b) => {
        if (!b?.customer) return;
        return this.mail.send({
          to: b.customer.email,
          ...showtimeCancelledEmail({
            name: b.customer.fullName,
            bookingCode: bookingCode(b.id),
            eventName: b.eventName,
            venue: b.venue,
            startTime: b.startTime,
            seats: b.seats.map((s) => s.seatCode),
            total: b.totalAmount,
            link: `${this.appUrl}/bookings/${b.id}`,
            refund: b.totalAmount,
            reason: b.showtimeCancelReason ?? 'Suất diễn đã bị huỷ',
          }),
        });
      })
      .catch((e: unknown) =>
        this.logger.error(
          `Không gửi được email huỷ suất cho đơn ${bookingId}`,
          e instanceof Error ? e.stack : String(e),
        ),
      );
  }

  private notFound(id: number) {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      'SHOWTIME_NOT_FOUND',
      `Không tìm thấy suất diễn có id ${id}`,
    );
  }
}
