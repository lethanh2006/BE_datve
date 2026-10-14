import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailMessage, MailTransport } from './mail.types';
import { LogTransport, SmtpTransport } from './transports';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: MailTransport | null;
  private readonly from: string;

  /** Thư đã "gửi" bằng LogTransport (chỉ có ở dev/test, rỗng khi dùng SMTP). */
  readonly outbox: MailMessage[] = [];

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'ĐặtVé <no-reply@datve.local>');
    const smtpUrl = config.get<string>('SMTP_URL');

    if (process.env.NODE_ENV === 'test') {
      this.transport = new LogTransport(this.outbox, this.logger);
    } else if (smtpUrl) {
      this.transport = new SmtpTransport(smtpUrl);
    } else if (process.env.NODE_ENV !== 'production') {
      this.transport = new LogTransport(this.outbox, this.logger);
    } else {
      // Production mà không cấu hình SMTP: bỏ thư đi, tuyệt đối không ghi nội dung (có thể chứa liên kết đặt lại mật khẩu) vào log
      this.transport = null;
      this.logger.warn('Chưa cấu hình SMTP_URL nên email sẽ không được gửi');
    }
  }

  /** Gửi thư; lỗi chỉ được ghi log, không bao giờ làm hỏng luồng nghiệp vụ gọi nó. */
  async send(message: MailMessage): Promise<void> {
    if (!this.transport) return;
    try {
      await this.transport.send({ ...message, from: this.from });
    } catch (error) {
      this.logger.error(
        `Không gửi được email tới ${message.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
