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

/** Không gửi đi đâu: ghi ra log và giữ lại trong `sent` (dùng khi dev và test). */
export class LogTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly maxKept = 50,
  ) {}

  send(message: MailMessage & { from: string }): Promise<void> {
    this.sent.push({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (this.sent.length > this.maxKept) this.sent.shift();
    this.logger.log(
      `[Email giả lập] tới ${message.to}: ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  }
}
