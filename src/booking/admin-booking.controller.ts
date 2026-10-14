import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { BookingService } from './booking.service';
import { AdminBookingListQuery } from './dto/booking-list.query';

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
}
