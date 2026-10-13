import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PageQueryDto } from '../common/response/page-query.dto';
import { EventService } from './event.service';

@Controller('api/events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  // danh sách sự kiện (có phân trang)
  @Get()
  list(@Query() q: PageQueryDto) {
    return this.eventService.findAll(q.page, q.size);
  }

  // chi tiết 1 sự kiện
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.eventService.findById(id);
  }
}
