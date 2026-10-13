import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventModule } from '../event/event.module';
import { ShowtimeController } from './showtime.controller';
import { Showtime } from './showtime.entity';
import { ShowtimeService } from './showtime.service';

@Module({
  imports: [TypeOrmModule.forFeature([Showtime]), EventModule],
  controllers: [ShowtimeController],
  providers: [ShowtimeService],
  exports: [ShowtimeService],
})
export class ShowtimeModule {}
