import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { SeatService } from './seat.service';

@Controller()
export class SeatController {
  constructor(private readonly seatService: SeatService) {}

  // danh sách ghế của 1 suất
  @Get('api/showtimes/:showtimeId/seats')
  listSeats(@Param('showtimeId', ParseIntPipe) showtimeId: number) {
    return this.seatService.findByShowtimeId(showtimeId);
  }
}
