import { Role } from '../role.enum';
import { User } from '../user.entity';

export class UserResponse {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  createdAt: Date;

  static from(u: User): UserResponse {
    return {
      id: Number(u.id),
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      createdAt: u.createdAt,
    };
  }
}

export class AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Thời hạn token, tính bằng giây */
  expiresIn: number;
  user: UserResponse;
}
