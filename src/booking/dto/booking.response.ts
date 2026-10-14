import { BookingSeatStatus, BookingStatus } from '../booking-status.enum';

export class BookingSeatResponse {
  seatId: number;
  seatCode: string;
  category: string;
  unitPrice: number;
  reservationStatus: BookingSeatStatus;
}

export class CustomerResponse {
  id: number;
  email: string;
  fullName: string;
}

export class BookingResponse {
  id: number;
  showtimeId: number;
  eventId: number;
  eventName: string;
  venue: string;
  startTime: Date;
  endTime: Date;
  /** Đơn PENDING đã quá hạn được báo là EXPIRED ngay, không cần chờ job dọn */
  status: BookingStatus;
  seats: BookingSeatResponse[];
  totalAmount: number;
  expiresAt: Date | null;
  createdAt: Date;
  /** Mã vé (nội dung QR), chỉ có khi đơn đã xác nhận */
  ticketCode: string | null;
  /** Thời điểm soát vé tại cửa, null nếu chưa vào */
  checkedInAt: Date | null;
  /** Hạn chót để huỷ vé và hoàn tiền; null nếu đơn không thể hoàn (chưa thanh toán, đã soát vé, đã huỷ...) */
  refundableUntil: Date | null;
  /** Thời điểm đã hoàn tiền, null nếu chưa hoàn */
  refundedAt: Date | null;
  /** Suất diễn bị huỷ (kèm lý do) thì đơn được hoàn tiền tự động */
  showtimeCancelledAt: Date | null;
  showtimeCancelReason: string | null;
  /** Chỉ có trong API quản trị */
  customer?: CustomerResponse;
}
