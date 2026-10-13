import { BookingStatus } from '../booking-status.enum';

export class BookingSeatResponse {
  seatId: number;
  seatCode: string;
  unitPrice: number;
}

export class BookingResponse {
  id: number;
  showtimeId: number;
  status: BookingStatus;
  seats: BookingSeatResponse[];
  totalAmount: number;
  expiresAt: Date;
}
