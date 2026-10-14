import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { UpsertEventRequest } from './dto/upsert-event.request';
import { EventService } from './event.service';

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin/events')
export class AdminEventController {
  constructor(private readonly eventService: EventService) {}

  @Post()
  create(@Body() dto: UpsertEventRequest) {
    return this.eventService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: UpsertEventRequest,
  ) {
    return this.eventService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIdPipe) id: number) {
    return this.eventService.remove(id);
  }
}
