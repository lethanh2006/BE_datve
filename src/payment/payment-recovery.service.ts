import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentRecoveryService {
  private readonly logger = new Logger(PaymentRecoveryService.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    if (this.config.get('SCHEDULER_ENABLED') === 'false') return;
    try {
      const recovered = await this.paymentService.recoverStuck();
      if (recovered > 0)
        this.logger.warn(`Đã đánh dấu thất bại ${recovered} giao dịch bị kẹt`);
    } catch (e) {
      this.logger.error(
        'Không phục hồi được giao dịch kẹt',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
