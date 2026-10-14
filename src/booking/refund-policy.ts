import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Chính sách hoàn vé: chỉ hoàn được khi còn ít nhất REFUND_WINDOW_HOURS giờ trước giờ diễn. */
@Injectable()
export class RefundPolicy {
  readonly windowHours: number;
  /** Cùng giá trị, tính bằng giây (dùng trong SQL) */
  readonly windowSeconds: number;

  constructor(config: ConfigService) {
    this.windowHours = Number(config.get('REFUND_WINDOW_HOURS', 24));
    if (
      !Number.isFinite(this.windowHours) ||
      this.windowHours < 0 ||
      this.windowHours > 87600
    ) {
      throw new Error('REFUND_WINDOW_HOURS phải là số từ 0 đến 87600');
    }
    this.windowSeconds = this.windowHours * 3600;
  }

  /** Hạn chót để hoàn vé của suất diễn bắt đầu lúc `startTime`. */
  deadline(startTime: Date): Date {
    return new Date(startTime.getTime() - this.windowHours * 3_600_000);
  }
}
