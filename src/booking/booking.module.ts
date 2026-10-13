import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShowtimeModule } from '../showtime/showtime.module';
import { BookingSeat } from './booking-seat.entity';
import { BookingController } from './booking.controller';
import { Booking } from './booking.entity';
import { BookingService } from './booking.service';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, BookingSeat]), ShowtimeModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
