export enum BookingStatus {
  PENDING = 'PENDING',
  PAYMENT_PROCESSING = 'PAYMENT_PROCESSING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum BookingSeatStatus {
  HELD = 'HELD',
  BOOKED = 'BOOKED',
  RELEASED = 'RELEASED',
}

/** Thời gian giữ ghế trước khi đơn tự hết hạn */
export const HOLD_MINUTES = 5;
