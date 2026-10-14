import { Role } from './role.enum';

/** Thông tin người dùng đã xác thực, gắn vào request bởi JwtAuthGuard. */
export class AuthUser {
  id: number;
  email: string;
  role: Role;
}
