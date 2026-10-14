import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ShowtimeService } from './showtime.service';

@ApiTags('Suất diễn')
@Public()
@Controller()
export class ShowtimeController {
  constructor(private readonly showtimeService: ShowtimeService) {}

  // danh sách suất diễn của 1 sự kiện
  @Get('api/events/:eventId/showtimes')
  listByEvent(@Param('eventId', ParseIdPipe) eventId: number) {
    return this.showtimeService.findByEventId(eventId);
  }

  // chi tiết 1 suất diễn
  @Get('api/showtimes/:id')
  get(@Param('id', ParseIdPipe) id: number) {
    return this.showtimeService.findOne(id);
  }
}
