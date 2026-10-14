import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { PaymentModule } from './payment/payment.module';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { UserModule } from './user/user.module';
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
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { ttl: 60_000, limit: Number(config.get('THROTTLE_LIMIT', 300)) },
        ],
        skipIf: () => config.get('THROTTLE_DISABLED') === 'true',
      }),
    }),
    ScheduleModule.forRoot(),
    MailModule,
    AuthModule,
    EventModule,
    ShowtimeModule,
    SeatModule,
    BookingModule,
    PaymentModule,
    AdminModule,
    UserModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
