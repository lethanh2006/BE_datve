import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingRequest } from './dto/create-booking.request';

@Controller()
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('api/showtimes/:showtimeId/bookings')
  @HttpCode(HttpStatus.CREATED)
  createBooking(
    @Param('showtimeId', ParseIntPipe) showtimeId: number,
    @Body() request: CreateBookingRequest,
  ) {
    const userId = 1; // tạm thời, chưa làm JWT
    return this.bookingService.createBooking(userId, showtimeId, request);
  }
}
