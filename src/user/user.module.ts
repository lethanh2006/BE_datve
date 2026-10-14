import { Module } from '@nestjs/common';
import { AdminUserController } from './admin-user.controller';
import { UserAdminService } from './user-admin.service';

@Module({
  controllers: [AdminUserController],
  providers: [UserAdminService],
})
export class UserModule {}
