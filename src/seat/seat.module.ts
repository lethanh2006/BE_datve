import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShowtimeModule } from '../showtime/showtime.module';
import { SeatController } from './seat.controller';
import { Seat } from './seat.entity';
import { SeatService } from './seat.service';

@Module({
  imports: [TypeOrmModule.forFeature([Seat]), ShowtimeModule],
  controllers: [SeatController],
  providers: [SeatService],
})
export class SeatModule {}
