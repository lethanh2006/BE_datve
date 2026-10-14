import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../../auth/role.enum';
import { PageQueryDto } from '../../common/response/page-query.dto';
import { trimToUndefined } from '../../common/transforms';

export class AdminUserListQuery extends PageQueryDto {
  /** Tìm theo email hoặc họ tên */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsEnum(Role, { message: 'Vai trò không hợp lệ' })
  role?: Role;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsIn(['ACTIVE', 'DISABLED'], {
    message: 'Trạng thái chỉ nhận ACTIVE hoặc DISABLED',
  })
  status?: 'ACTIVE' | 'DISABLED';
}

export class SetRoleRequest {
  @IsEnum(Role, { message: 'Vai trò không hợp lệ' })
  role: Role;
}

export class SetStatusRequest {
  @IsBoolean({ message: 'disabled phải là true hoặc false' })
  disabled: boolean;
}

export class AdminUserResponse {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  createdAt: Date;
  /** Thời điểm bị khoá, null nếu đang hoạt động */
  disabledAt: Date | null;
  confirmedBookings: number;
  totalSpent: number;
}
