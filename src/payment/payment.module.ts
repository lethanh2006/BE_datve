import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { MockPaymentGateway } from './gateway/mock-payment.gateway';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import { PaymentRecoveryService } from './payment-recovery.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({
  imports: [BookingModule],
  controllers: [PaymentController],
  exports: [PaymentService],
  providers: [
    PaymentService,
    PaymentRecoveryService,
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
  ],
})
export class PaymentModule {}
