import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/transforms';

export class CancelShowtimeRequest {
  /** Lý do huỷ, được gửi kèm email cho khách đã mua vé */
  @Transform(trim)
  @IsString({ message: 'Lý do huỷ không hợp lệ' })
  @MinLength(3, { message: 'Lý do huỷ tối thiểu 3 ký tự' })
  @MaxLength(500, { message: 'Lý do huỷ tối đa 500 ký tự' })
  reason: string;
}

export class CancellationFailure {
  bookingId: number;
  attempts: number;
  error: string;
}

export class CancellationStatus {
  showtimeId: number;
  cancelledAt: Date;
  reason: string | null;
  /** Đơn đã thanh toán, chưa soát vé và chưa được hoàn tiền (đang chờ hoặc đang thử lại) */
  pendingRefunds: number;
  /** Đơn đã hoàn tiền */
  refunded: number;
  /** Đơn đã soát vé trước khi huỷ nên không tự hoàn, cần xử lý thủ công */
  checkedIn: number;
  /** Đơn đang thanh toán dở; xong thì sẽ tự được hoàn */
  paymentsInProgress: number;
  /** Các đơn hoàn tiền đang lỗi (tối đa 20), hệ thống vẫn tự thử lại */
  failures: CancellationFailure[];
}
