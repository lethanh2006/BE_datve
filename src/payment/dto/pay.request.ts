import { IsIn, IsOptional } from 'class-validator';

export class PayRequest {
  /** Chỉ dùng khi dev/demo (PAYMENT_ALLOW_SIMULATION=true): ép cổng thanh toán giả trả về kết quả này */
  @IsOptional()
  @IsIn(['SUCCESS', 'FAILED'], {
    message: 'simulate chỉ nhận SUCCESS hoặc FAILED',
  })
  simulate?: 'SUCCESS' | 'FAILED';
}
