import { Module } from '@nestjs/common';
import { EventModule } from '../event/event.module';
import { AdminShowtimeController } from './admin-showtime.controller';
import { ShowtimeController } from './showtime.controller';
import { ShowtimeService } from './showtime.service';

@Module({
  imports: [EventModule],
  controllers: [ShowtimeController, AdminShowtimeController],
  providers: [ShowtimeService],
  exports: [ShowtimeService],
})
export class ShowtimeModule {}
