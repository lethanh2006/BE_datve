import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { BookingService } from './booking.service';
import { AdminBookingListQuery } from './dto/booking-list.query';
import { CheckInRequest } from './dto/check-in.dto';

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin/bookings')
export class AdminBookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get()
  list(@Query() query: AdminBookingListQuery) {
    return this.bookingService.listAll(query);
  }

  /** Soát vé: quét mã QR trên vé điện tử. */
  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  checkIn(@Body() dto: CheckInRequest) {
    return this.bookingService.checkIn(dto.ticketCode);
  }
}
