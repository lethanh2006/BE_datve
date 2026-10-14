import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminMailController } from './admin-mail.controller';
import { MAIL_TRANSPORT, MailTransport } from './mail.types';
import { MailService } from './mail.service';
import { LogTransport, SmtpTransport } from './transports';

/** Chọn cách gửi: test luôn dùng hộp thư giả; có SMTP_URL thì gửi thật; dev thì ghi ra log; production thiếu SMTP thì bỏ thư. */
export function createMailTransport(
  config: ConfigService,
): MailTransport | null {
  const logger = new Logger('MailTransport');
  if (process.env.NODE_ENV === 'test') return new LogTransport(logger);
  const smtpUrl = config.get<string>('SMTP_URL');
  if (smtpUrl) return new SmtpTransport(smtpUrl);
  if (process.env.NODE_ENV !== 'production') return new LogTransport(logger);
  // Tuyệt đối không ghi nội dung thư (có thể chứa liên kết đặt lại mật khẩu) vào log
  logger.warn('Chưa cấu hình SMTP_URL nên email sẽ không được gửi');
  return null;
}

@Global()
@Module({
  controllers: [AdminMailController],
  providers: [
    MailService,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: createMailTransport,
    },
  ],
  exports: [MailService],
})
export class MailModule {}
