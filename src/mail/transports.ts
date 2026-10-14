import { Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { MailMessage, MailTransport } from './mail.types';

/** Gửi thật qua SMTP, cấu hình bằng SMTP_URL (vd smtps://user:pass@smtp.example.com:465). */
export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(url: string) {
    this.transporter = createTransport(url);
  }

  async send(message: MailMessage & { from: string }): Promise<void> {
    await this.transporter.sendMail(message);
  }
}

/** Không gửi đi đâu: ghi ra log và giữ lại trong `outbox` (dùng khi dev và test). */
export class LogTransport implements MailTransport {
  constructor(
    private readonly outbox: MailMessage[],
    private readonly logger: Logger,
    private readonly maxKept = 50,
  ) {}

  send(message: MailMessage & { from: string }): Promise<void> {
    this.outbox.push({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (this.outbox.length > this.maxKept) this.outbox.shift();
    this.logger.log(
      `[Email giả lập] tới ${message.to}: ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}
