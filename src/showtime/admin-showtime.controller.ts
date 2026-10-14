import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { AddSeatsRequest } from './dto/add-seats.request';
import { CreateShowtimeRequest } from './dto/create-showtime.request';
import { ShowtimeService } from './showtime.service';

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin')
export class AdminShowtimeController {
  constructor(private readonly showtimeService: ShowtimeService) {}

  @Post('events/:eventId/showtimes')
  create(
    @Param('eventId', ParseIdPipe) eventId: number,
    @Body() dto: CreateShowtimeRequest,
  ) {
    return this.showtimeService.create(eventId, dto);
  }

  @Post('showtimes/:id/seats')
  addSeats(@Param('id', ParseIdPipe) id: number, @Body() dto: AddSeatsRequest) {
    return this.showtimeService.addSeats(id, dto);
  }

  @Delete('showtimes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIdPipe) id: number) {
    return this.showtimeService.remove(id);
  }
}
