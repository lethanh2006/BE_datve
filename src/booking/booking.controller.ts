import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { BookingService } from './booking.service';
import { BookingListQuery } from './dto/booking-list.query';
import { CreateBookingRequest } from './dto/create-booking.request';

@ApiTags('Đặt vé')
@ApiBearerAuth()
@Controller()
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  /** Giữ ghế trong 5 phút; cần thanh toán trước khi hết hạn. */
  @Post('api/showtimes/:showtimeId/bookings')
  @HttpCode(HttpStatus.CREATED)
  createBooking(
    @CurrentUser() user: AuthUser,
    @Param('showtimeId', ParseIdPipe) showtimeId: number,
    @Body() request: CreateBookingRequest,
  ) {
    return this.bookingService.createBooking(user, showtimeId, request);
  }

  /** Các đơn của tôi, mới nhất trước. */
  @Get('api/bookings')
  listMine(@CurrentUser() user: AuthUser, @Query() query: BookingListQuery) {
    return this.bookingService.listMine(user.id, query);
  }

  @Get('api/bookings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.bookingService.getForUser(user, id);
  }

  /** Huỷ đơn chưa thanh toán và nhả ghế. */
  @Post('api/bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.bookingService.cancel(user, id);
  }
}
