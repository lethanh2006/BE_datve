import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { AdminCancellationController } from './admin-cancellation.controller';
import { ShowtimeCancellationService } from './showtime-cancellation.service';

@Module({
  imports: [BookingModule, PaymentModule],
  controllers: [AdminCancellationController],
  providers: [ShowtimeCancellationService],
})
export class CancellationModule {}
