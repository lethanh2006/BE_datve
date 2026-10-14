import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import {
  AdminUserListQuery,
  SetRoleRequest,
  SetStatusRequest,
} from './dto/admin-user.dto';
import { UserAdminService } from './user-admin.service';

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin/users')
export class AdminUserController {
  constructor(private readonly users: UserAdminService) {}

  @Get()
  list(@Query() query: AdminUserListQuery) {
    return this.users.list(query);
  }

  @Put(':id/role')
  setRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: SetRoleRequest,
  ) {
    return this.users.setRole(actor, id, dto.role);
  }

  /** Khoá hoặc mở khoá tài khoản. */
  @Put(':id/status')
  setStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: SetStatusRequest,
  ) {
    return this.users.setDisabled(actor, id, dto.disabled);
  }
}
