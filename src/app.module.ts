import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingModule } from './booking/booking.module';
import { EventModule } from './event/event.module';
import { SeatModule } from './seat/seat.module';
import { ShowtimeModule } from './showtime/showtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 5432)),
        database: config.get('DB_NAME', 'datve_db'),
        username: config.get('DB_USERNAME', 'datve_user'),
        password: config.get('DB_PASSWORD', 'local_dev_only_12345'),
        autoLoadEntities: true,
        synchronize: false, // schema do migration SQL quản lý
      }),
    }),
    EventModule,
    ShowtimeModule,
    SeatModule,
    BookingModule,
  ],
})
export class AppModule {}
