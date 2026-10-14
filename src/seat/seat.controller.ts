import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { SeatService } from './seat.service';

@ApiTags('Ghế')
@Public()
@Controller()
export class SeatController {
  constructor(private readonly seatService: SeatService) {}

  // danh sách ghế của 1 suất
  @Get('api/showtimes/:showtimeId/seats')
  listSeats(@Param('showtimeId', ParseIdPipe) showtimeId: number) {
    return this.seatService.findByShowtimeId(showtimeId);
  }
}
