import { MailMessage } from './mail.types';

type Template = Pick<MailMessage, 'subject' | 'text' | 'html'>;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: process.env.APP_TIME_ZONE ?? 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

export const formatVnd = (amount: number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);

/** Khung HTML đơn giản, an toàn cho hầu hết ứng dụng email (CSS inline, không script). */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f5fa;font-family:Arial,Helvetica,sans-serif;color:#161a2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:20px;font-weight:700;color:#4f46e5;padding-bottom:12px">ĐặtVé</td></tr>
<tr><td style="font-size:18px;font-weight:700;padding-bottom:12px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${escapeHtml(label)}</a></p>`;

export function passwordResetEmail(p: {
  name: string;
  link: string;
  minutes: number;
}): Template {
  return {
    subject: 'Đặt lại mật khẩu ĐặtVé',
    text: [
      `Xin chào ${p.name},`,
      '',
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
      `Mở liên kết sau trong ${p.minutes} phút để đặt mật khẩu mới:`,
      p.link,
      '',
      'Nếu bạn không yêu cầu, hãy bỏ qua email này, mật khẩu của bạn vẫn an toàn.',
    ].join('\n'),
    html: layout(
      'Đặt lại mật khẩu',
      `<p>Xin chào ${escapeHtml(p.name)},</p>
<p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Liên kết dưới đây có hiệu lực trong <b>${p.minutes} phút</b>.</p>
${button(p.link, 'Đặt mật khẩu mới')}
<p style="color:#5f6684;font-size:13px">Nếu bạn không yêu cầu, hãy bỏ qua email này, mật khẩu của bạn vẫn an toàn.</p>`,
    ),
  };
}

export interface BookingMailData {
  name: string;
  bookingCode: string;
  eventName: string;
  venue: string;
  startTime: Date;
  seats: string[];
  total: number;
  link: string;
}

export function bookingConfirmedEmail(
  p: BookingMailData & { ticketCode: string },
): Template {
  const seats = p.seats.join(', ');
  return {
    subject: `Vé của bạn đã được xác nhận - ${p.bookingCode}`,
    text: [
      `Xin chào ${p.name},`,
      '',
      `Thanh toán thành công. Vé của bạn cho "${p.eventName}" đã được xác nhận.`,
      '',
      `Mã đặt vé: ${p.bookingCode}`,
      `Mã vé (dùng cho QR): ${p.ticketCode}`,
      `Thời gian: ${formatDateTime(p.startTime)}`,
      `Địa điểm: ${p.venue}`,
      `Ghế: ${seats}`,
      `Tổng tiền: ${formatVnd(p.total)}`,
      '',
      `Xem vé điện tử: ${p.link}`,
    ].join('\n'),
    html: layout(
      'Vé của bạn đã được xác nhận',
      `<p>Xin chào ${escapeHtml(p.name)}, thanh toán thành công. Dưới đây là thông tin vé của bạn.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
<tr><td style="padding:6px 0;color:#5f6684;width:120px">Sự kiện</td><td><b>${escapeHtml(p.eventName)}</b></td></tr>
<tr><td style="padding:6px 0;color:#5f6684">Thời gian</td><td>${escapeHtml(formatDateTime(p.startTime))}</td></tr>
<tr><td style="padding:6px 0;color:#5f6684">Địa điểm</td><td>${escapeHtml(p.venue)}</td></tr>
<tr><td style="padding:6px 0;color:#5f6684">Ghế</td><td>${escapeHtml(seats)}</td></tr>
<tr><td style="padding:6px 0;color:#5f6684">Tổng tiền</td><td>${escapeHtml(formatVnd(p.total))}</td></tr>
<tr><td style="padding:6px 0;color:#5f6684">Mã đặt vé</td><td><b>${escapeHtml(p.bookingCode)}</b></td></tr>
</table>
${button(p.link, 'Xem vé điện tử')}`,
    ),
  };
}

export function bookingRefundedEmail(
  p: BookingMailData & { refund: number },
): Template {
  return {
    subject: `Đã huỷ vé và hoàn tiền - ${p.bookingCode}`,
    text: [
      `Xin chào ${p.name},`,
      '',
      `Vé ${p.bookingCode} cho "${p.eventName}" (${formatDateTime(p.startTime)}) đã được huỷ.`,
      `Số tiền hoàn lại: ${formatVnd(p.refund)}.`,
      '',
      `Chi tiết: ${p.link}`,
    ].join('\n'),
    html: layout(
      'Đã huỷ vé và hoàn tiền',
      `<p>Xin chào ${escapeHtml(p.name)},</p>
<p>Vé <b>${escapeHtml(p.bookingCode)}</b> cho <b>${escapeHtml(p.eventName)}</b> (${escapeHtml(formatDateTime(p.startTime))}) đã được huỷ.</p>
<p>Số tiền hoàn lại: <b>${escapeHtml(formatVnd(p.refund))}</b>.</p>
${button(p.link, 'Xem chi tiết')}`,
    ),
  };
}
