export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface ChargeRequest {
  /** Số tiền theo đơn vị VND, dạng chuỗi thập phân (vd "300000.50") */
  amount: string;
  bookingId: string;
  /** Cổng thanh toán dùng key này để không trừ tiền hai lần khi retry */
  idempotencyKey: string;
  /** Chỉ mock gateway mới đọc: ép kết quả để demo/test */
  simulate?: 'SUCCESS' | 'FAILED';
}

export interface ChargeResult {
  status: 'SUCCESS' | 'FAILED';
  providerReference: string | null;
}

/** Cổng thanh toán. Thay MockPaymentGateway bằng bản gọi VNPay/MoMo/Stripe... khi triển khai thật. */
export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
