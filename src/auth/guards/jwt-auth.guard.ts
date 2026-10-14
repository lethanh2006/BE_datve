import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exception/api.exception';
import { AuthUser } from '../auth-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Role } from '../role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /** Phiên bản token của user lúc cấp; lệch với DB nghĩa là đã đổi mật khẩu và token này bị thu hồi */
  ver?: number;
}

interface UserRow {
  email: string;
  role: Role;
  tokenVersion: number;
  disabledAt: Date | null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Bạn cần đăng nhập',
      );
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw this.invalidToken();
    }
    if (
      !/^\d+$/.test(payload.sub) ||
      !Number.isSafeInteger(Number(payload.sub)) ||
      Number(payload.sub) <= 0
    ) {
      throw this.invalidToken();
    }

    // Vai trò, khoá tài khoản và thu hồi phiên đều lấy từ DB nên có hiệu lực ngay, không phải chờ token hết hạn
    const [user] = await this.dataSource.query<UserRow[]>(
      `SELECT email, role, token_version AS "tokenVersion", disabled_at AS "disabledAt"
       FROM users WHERE id = $1`,
      [payload.sub],
    );
    if (!user || user.disabledAt || user.tokenVersion !== (payload.ver ?? 0)) {
      throw this.invalidToken();
    }
    request.user = {
      id: Number(payload.sub),
      email: user.email,
      role: user.role,
    };
    return true;
  }

  private invalidToken() {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_TOKEN',
      'Phiên đăng nhập không hợp lệ hoặc đã hết hạn',
    );
  }
}
