import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MAIL_TRANSPORT, MailMessage, MailTransport } from './mail.types';
import { LogTransport } from './transports';

/** Thử gửi tối đa chừng này lần rồi đánh dấu FAILED (admin có thể bấm gửi lại). */
export const MAX_ATTEMPTS = 5;
/** Chờ bao lâu trước lần thử kế tiếp, tính theo số lần đã thử (giây): 1 phút, 5 phút, 15 phút, 1 giờ. */
const BACKOFF_SECONDS = [60, 300, 900, 3600];
/** Thời gian "thuê" một thư khi đang gửi: nếu tiến trình chết giữa chừng, hết hạn thuê thì thư được gửi lại. */
const LEASE_SECONDS = 120;

export type EmailStatus = 'PENDING' | 'SENT' | 'FAILED';

interface OutboxRow {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  attempts: number;
}

/**
 * Gửi email qua hàng đợi bền vững (bảng email_outbox):
 *  1. `send()` chỉ ghi thư vào DB rồi trả về ngay nên không làm chậm hay làm hỏng nghiệp vụ gọi nó.
 *  2. Thư được gửi ngay sau đó; nếu SMTP lỗi thì worker (10 giây/lần) thử lại với khoảng chờ tăng dần.
 *  3. Nhiều instance API chạy song song vẫn không gửi trùng nhờ FOR UPDATE SKIP LOCKED và thời gian thuê.
 * Cơ chế là at-least-once: nếu tiến trình chết đúng lúc SMTP đã nhận thư thì thư có thể gửi lại một lần.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.from = config.get<string>('MAIL_FROM', 'ĐặtVé <no-reply@datve.local>');
  }

  /** Thư đã "gửi" bằng LogTransport (chỉ có ở dev/test, luôn rỗng khi dùng SMTP). */
  get outbox(): MailMessage[] {
    return this.transport instanceof LogTransport ? this.transport.sent : [];
  }

  async onModuleDestroy() {
    // Đợi các lượt gửi đang chạy xong để không dùng connection pool sau khi đã đóng
    await Promise.allSettled([...this.inflight]);
  }

  /** Xếp thư vào hàng đợi; lỗi chỉ được ghi log, không bao giờ làm hỏng luồng nghiệp vụ gọi nó. */
  async send(message: MailMessage): Promise<void> {
    if (!this.transport) return;
    try {
      await this.dataSource.query(
        `INSERT INTO email_outbox (to_address, subject, body_text, body_html) VALUES ($1, $2, $3, $4)`,
        [message.to, message.subject, message.text, message.html ?? null],
      );
    } catch (error) {
      this.logger.error(
        `Không xếp được email tới ${message.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    this.track(this.flush());
  }

  /**
   * Gửi các thư đến hạn. Trả về số thư đã gửi thành công.
   * Thư được "thuê" bằng một UPDATE nguyên tử rồi mới gửi ngoài giao dịch, nên không giữ khoá DB trong lúc chờ SMTP.
   */
  async flush(limit = 20): Promise<number> {
    if (!this.transport) return 0;
    let claimed: OutboxRow[];
    try {
      const [rows] = await this.dataSource.query<[OutboxRow[], number]>(
        `UPDATE email_outbox
         SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => $2)
         WHERE id IN (
           SELECT id FROM email_outbox
           WHERE status = 'PENDING' AND next_attempt_at <= now()
           ORDER BY id LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, to_address AS "to", subject, body_text AS "text", body_html AS "html", attempts`,
        [limit, LEASE_SECONDS],
      );
      claimed = rows;
    } catch (error) {
      this.logger.error(
        `Không lấy được thư cần gửi: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }

    let sent = 0;
    for (const mail of claimed) {
      try {
        await this.transport.send({
          from: this.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html ?? undefined,
        });
        // Xoá nội dung ngay khi gửi xong
        await this.dataSource.query(
          `UPDATE email_outbox SET status = 'SENT', sent_at = now(), last_error = NULL, body_text = '', body_html = NULL WHERE id = $1`,
          [mail.id],
        );
        sent++;
      } catch (error) {
        await this.recordFailure(mail, error);
      }
    }
    return sent;
  }

  async list(query: { status?: EmailStatus; page: number; size: number }) {
    const where = `WHERE ($1::text IS NULL OR status = $1)`;
    const [rows, counted] = await Promise.all([
      this.dataSource.query<
        {
          id: string;
          to: string;
          subject: string;
          status: EmailStatus;
          attempts: number;
          nextAttemptAt: Date;
          lastError: string | null;
          createdAt: Date;
          sentAt: Date | null;
        }[]
      >(
        `SELECT id, to_address AS "to", subject, status, attempts, next_attempt_at AS "nextAttemptAt",
                last_error AS "lastError", created_at AS "createdAt", sent_at AS "sentAt"
         FROM email_outbox ${where} ORDER BY id DESC LIMIT $2 OFFSET $3`,
        [query.status ?? null, query.size, query.page * query.size],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM email_outbox ${where}`,
        [query.status ?? null],
      ),
    ]);
    return {
      content: rows.map((r) => ({ ...r, id: Number(r.id) })),
      totalElements: counted[0].count,
    };
  }

  /** Đặt lại thư FAILED về PENDING để gửi lại. Trả về false nếu không có thư FAILED nào có id này. */
  async retry(id: number): Promise<boolean> {
    const [rows] = await this.dataSource.query<[unknown[], number]>(
      `UPDATE email_outbox SET status = 'PENDING', attempts = 0, next_attempt_at = now()
       WHERE id = $1 AND status = 'FAILED' RETURNING id`,
      [id],
    );
    if (rows.length === 0) return false;
    this.track(this.flush());
    return true;
  }

  /** Worker nền: gửi các thư đến hạn (kể cả thư đang chờ thử lại). */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async worker() {
    if (this.config.get('SCHEDULER_ENABLED') === 'false') return;
    await this.flush();
  }

  /** Dọn các thư đã xử lý xong từ lâu. */
  @Cron(CronExpression.EVERY_HOUR)
  async purge() {
    if (this.config.get('SCHEDULER_ENABLED') === 'false') return;
    try {
      await this.dataSource.query(
        `DELETE FROM email_outbox WHERE status <> 'PENDING' AND created_at < now() - interval '7 days'`,
      );
    } catch (error) {
      this.logger.error(
        `Không dọn được hàng đợi email: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async recordFailure(mail: OutboxRow, error: unknown) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500);
    const exhausted = mail.attempts >= MAX_ATTEMPTS;
    const delay =
      BACKOFF_SECONDS[Math.min(mail.attempts, BACKOFF_SECONDS.length) - 1];
    this.logger.warn(
      `Gửi email ${mail.id} tới ${mail.to} thất bại (lần ${mail.attempts}/${MAX_ATTEMPTS})${exhausted ? ', bỏ cuộc' : `, thử lại sau ${delay}s`}: ${message}`,
    );
    try {
      await this.dataSource.query(
        `UPDATE email_outbox
         SET status = $2, last_error = $3, next_attempt_at = now() + make_interval(secs => $4)
         WHERE id = $1`,
        [mail.id, exhausted ? 'FAILED' : 'PENDING', message, delay],
      );
    } catch (e) {
      this.logger.error(
        `Không ghi được kết quả gửi email ${mail.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private track(promise: Promise<unknown>) {
    const guarded = promise
      .catch((e: unknown) => this.logger.error(e))
      .finally(() => this.inflight.delete(guarded));
    this.inflight.add(guarded);
  }
}
