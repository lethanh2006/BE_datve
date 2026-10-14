import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash, hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { PgError, pgErrorCode } from '../common/db/pg-error';
import { ApiException } from '../common/exception/api.exception';
import { AuthResponse, UserResponse } from './dto/auth.response';
import { LoginRequest } from './dto/login.request';
import { RegisterRequest } from './dto/register.request';
import { JwtPayload } from './guards/jwt-auth.guard';
import { Role } from './role.enum';
import { User } from './user.entity';

const BCRYPT_COST = 10;

@Injectable()
export class AuthService {
  // Dùng để so sánh khi email không tồn tại, tránh lộ email qua thời gian phản hồi
  private readonly dummyHash = hashSync(randomUUID(), BCRYPT_COST);
  private readonly expiresIn: number;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.expiresIn = Number(config.get('JWT_EXPIRES_IN_SECONDS', 86400));
  }

  async register(dto: RegisterRequest): Promise<AuthResponse> {
    const passwordHash = await hash(dto.password, BCRYPT_COST);
    try {
      const user = await this.users.save(
        this.users.create({
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          role: Role.USER,
        }),
      );
      return this.issueToken(await this.users.findOneByOrFail({ id: user.id }));
    } catch (e) {
      if (pgErrorCode(e) === PgError.UNIQUE_VIOLATION) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'EMAIL_ALREADY_EXISTS',
          'Email đã được sử dụng',
        );
      }
      throw e;
    }
  }

  async login(dto: LoginRequest): Promise<AuthResponse> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: dto.email })
      .getOne();

    const matched = await compare(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user || !matched) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        'Email hoặc mật khẩu không đúng',
      );
    }
    return this.issueToken(user);
  }

  async me(userId: number): Promise<UserResponse> {
    const user = await this.users.findOneBy({ id: String(userId) });
    if (!user) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_TOKEN',
        'Tài khoản không còn tồn tại',
      );
    }
    return UserResponse.from(user);
  }

  private async issueToken(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      user: UserResponse.from(user),
    };
  }
}
