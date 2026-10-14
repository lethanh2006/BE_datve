export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  send(message: MailMessage & { from: string }): Promise<void>;
}

/** Token DI của transport; null nghĩa là không gửi được (production chưa cấu hình SMTP). */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
