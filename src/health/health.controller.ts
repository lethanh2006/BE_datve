import { Controller, Get, HttpStatus } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiExcludeController } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';
import { ApiException } from '../common/exception/api.exception';

/** Giữ đường dẫn giống Spring Actuator của bản Java. */
@ApiExcludeController()
@Public()
@Controller('actuator')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('health')
  async health() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'UP' };
    } catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DB_DOWN',
        'Không kết nối được cơ sở dữ liệu',
      );
    }
  }
}
