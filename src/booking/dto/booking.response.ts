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
  /** Chỉ có trong API quản trị */
  customer?: CustomerResponse;
}
