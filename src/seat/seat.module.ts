import { Module } from '@nestjs/common';
import { ShowtimeModule } from '../showtime/showtime.module';
import { SeatController } from './seat.controller';
import { SeatEventsService } from './seat-events.service';
import { SeatService } from './seat.service';

@Module({
  imports: [ShowtimeModule],
  controllers: [SeatController],
  providers: [SeatService, SeatEventsService],
})
export class SeatModule {}
