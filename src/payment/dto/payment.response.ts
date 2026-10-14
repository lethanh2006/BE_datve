import { BookingStatus } from '../../booking/booking-status.enum';
import { PaymentStatus } from '../payment-status.enum';

export class PaymentResponse {
  id: number;
  bookingId: number;
  status: PaymentStatus;
  amount: number;
  provider: string;
  providerReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Trạng thái hiện tại của đơn đặt vé tương ứng */
  bookingStatus: BookingStatus;
}
