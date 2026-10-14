import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { EventListQuery } from './dto/event-list.query';
import { EventService } from './event.service';

@ApiTags('Sự kiện')
@Public()
@Controller('api/events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  // danh sách sự kiện (có phân trang, tìm kiếm theo từ khoá và thể loại)
  @Get()
  list(@Query() query: EventListQuery) {
    return this.eventService.findAll(query);
  }

  // các thể loại đang có (khai báo trước ':id' để không bị nuốt route)
  @Get('categories')
  categories() {
    return this.eventService.listCategories();
  }

  // chi tiết 1 sự kiện
  @Get(':id')
  get(@Param('id', ParseIdPipe) id: number) {
    return this.eventService.findById(id);
  }
}
