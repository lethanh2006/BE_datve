import { Module } from '@nestjs/common';
import { ShowtimeModule } from '../showtime/showtime.module';
import { AdminBookingController } from './admin-booking.controller';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { RefundPolicy } from './refund-policy';

@Module({
  imports: [ShowtimeModule],
  controllers: [BookingController, AdminBookingController],
  providers: [BookingService, BookingExpiryService, RefundPolicy],
  exports: [BookingService, RefundPolicy],
})
export class BookingModule {}
