import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ShowtimeService } from './showtime.service';

@Controller()
export class ShowtimeController {
  constructor(private readonly showtimeService: ShowtimeService) {}

  // danh sách suất diễn của 1 sự kiện
  @Get('api/events/:eventId/showtimes')
  listByEvent(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.showtimeService.findByEventId(eventId);
  }
}
