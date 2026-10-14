import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from './auth.service';

/** Dọn dữ liệu tạm của tài khoản mỗi ngày. */
@Injectable()
export class AuthMaintenanceService {
  private readonly logger = new Logger(AuthMaintenanceService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run() {
    if (this.config.get('SCHEDULER_ENABLED') === 'false') return;
    try {
      await this.authService.purgeOldResetTokens();
    } catch (e) {
      this.logger.error(
        'Không dọn được mã đặt lại mật khẩu cũ',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
