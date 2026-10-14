import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { StatsService } from './stats.service';

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin/stats')
export class AdminStatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  stats() {
    return this.statsService.getStats();
  }
}
