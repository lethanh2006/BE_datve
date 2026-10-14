import { Module } from '@nestjs/common';
import { AdminEventController } from './admin-event.controller';
import { EventController } from './event.controller';
import { EventService } from './event.service';

@Module({
  controllers: [EventController, AdminEventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
