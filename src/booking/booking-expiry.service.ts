import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingService } from './booking.service';

/** Định kỳ nhả ghế của các đơn chưa thanh toán đã quá hạn. */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);

  constructor(
    private readonly bookingService: BookingService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async run() {
    if (this.config.get('SCHEDULER_ENABLED') === 'false') return;
    try {
      const expired = await this.bookingService.expireStale();
      if (expired > 0) this.logger.log(`Đã nhả ghế của ${expired} đơn hết hạn`);
    } catch (e) {
      this.logger.error(
        'Không dọn được đơn hết hạn',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
