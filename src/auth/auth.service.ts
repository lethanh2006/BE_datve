import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { compare, hash, hashSync } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { PgError, pgErrorCode } from '../common/db/pg-error';
import { ApiException } from '../common/exception/api.exception';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail } from '../mail/templates';
import { AuthResponse, UserResponse } from './dto/auth.response';
import {
  ChangePasswordRequest,
  UpdateProfileRequest,
} from './dto/account.request';
import { LoginRequest } from './dto/login.request';
import { RegisterRequest } from './dto/register.request';
import { JwtPayload } from './guards/jwt-auth.guard';
import { Role } from './role.enum';
import { User } from './user.entity';

const BCRYPT_COST = 10;

/** Mã đặt lại mật khẩu có hiệu lực trong bao lâu */
export const RESET_TOKEN_MINUTES = 30;
/** Không gửi lại email đặt lại mật khẩu cho cùng một tài khoản trong khoảng này (chống spam hộp thư) */
const RESET_COOLDOWN_SECONDS = 60;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Dùng để so sánh khi email không tồn tại, tránh lộ email qua thời gian phản hồi
  private readonly dummyHash = hashSync(randomUUID(), BCRYPT_COST);
  private readonly expiresIn: number;
  private readonly appUrl: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.expiresIn = Number(config.get('JWT_EXPIRES_IN_SECONDS', 86400));
    this.appUrl = config
      .get<string>('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
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
    const user = await this.findWithPassword('email', dto.email);

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
    // Chỉ báo khoá sau khi đã đúng mật khẩu để không lộ tài khoản nào tồn tại
    if (user.disabledAt) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_DISABLED',
        'Tài khoản đã bị khoá, vui lòng liên hệ quản trị viên',
      );
    }
    return this.issueToken(user);
  }

  async me(userId: number): Promise<UserResponse> {
    return UserResponse.from(await this.getUser(userId));
  }

  async updateProfile(
    userId: number,
    dto: UpdateProfileRequest,
  ): Promise<UserResponse> {
    await this.users.update({ id: String(userId) }, { fullName: dto.fullName });
    return this.me(userId);
  }

  /**
   * Đổi mật khẩu: thu hồi mọi phiên cũ (tăng token_version) và trả token mới
   * để phiên hiện tại tiếp tục dùng được.
   */
  async changePassword(
    userId: number,
    dto: ChangePasswordRequest,
  ): Promise<AuthResponse> {
    return this.dataSource.transaction(async (em) => {
      // Cùng thứ tự khoá user -> reset token ở mọi thao tác bảo mật.
      const user = await em
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.id = :id', { id: String(userId) })
        .setLock('pessimistic_write')
        .getOne();
      if (!user || user.disabledAt) throw this.userGone();

      if (!(await compare(dto.currentPassword, user.passwordHash))) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_CURRENT_PASSWORD',
          'Mật khẩu hiện tại không đúng',
        );
      }
      if (dto.currentPassword === dto.newPassword) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'SAME_PASSWORD',
          'Mật khẩu mới phải khác mật khẩu hiện tại',
        );
      }

      await em.query(
        `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`,
        [userId, await hash(dto.newPassword, BCRYPT_COST)],
      );
      await em.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      user.tokenVersion += 1;
      return this.issueToken(user);
    });
  }

  /**
   * Quên mật khẩu. Luôn kết thúc êm như nhau dù email có tồn tại hay không để không lộ danh sách tài khoản.
   * Chỉ lưu băm SHA-256 của mã; mã gốc chỉ nằm trong email.
   */
  async forgotPassword(email: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const user = await this.dataSource.transaction(async (em) => {
      const account = await em
        .getRepository(User)
        .createQueryBuilder('u')
        .where('u.email = :email', { email })
        .setLock('pessimistic_write')
        .getOne();
      if (!account || account.disabledAt) return null;

      const [recent] = await em.query<unknown[]>(
        `SELECT 1 FROM password_reset_tokens
       WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2) LIMIT 1`,
        [account.id, RESET_COOLDOWN_SECONDS],
      );
      if (recent) return null;
      // Mã cũ chưa dùng không còn hiệu lực khi có mã mới
      await em.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [account.id],
      );
      await em.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [account.id, sha256(token), RESET_TOKEN_MINUTES],
      );
      return account;
    });
    if (!user) return;

    // Không chờ gửi mail xong để thời gian phản hồi không khác nhau giữa email có và không có tài khoản
    void this.mail
      .send({
        to: user.email,
        ...passwordResetEmail({
          name: user.fullName,
          link: `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
          minutes: RESET_TOKEN_MINUTES,
        }),
      })
      .catch((e: unknown) => this.logger.error(e));
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordHash = await hash(newPassword, BCRYPT_COST);

    await this.dataSource.transaction(async (em) => {
      // Khoá tài khoản trước để không đua với đổi mật khẩu hoặc cấp mã mới.
      await em.query(
        `SELECT id FROM users WHERE id = (
           SELECT user_id FROM password_reset_tokens WHERE token_hash = $1
         ) FOR UPDATE`,
        [sha256(token)],
      );
      const [row] = await em.query<{ id: string; userId: string }[]>(
        `SELECT t.id, t.user_id AS "userId"
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
           AND u.disabled_at IS NULL
         FOR UPDATE OF t`,
        [sha256(token)],
      );
      if (!row) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_RESET_TOKEN',
          'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
        );
      }

      await em.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [row.userId],
      );
      // Tăng token_version để mọi phiên đăng nhập cũ (có thể là của kẻ xâm nhập) bị thu hồi
      await em.query(
        `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`,
        [row.userId, passwordHash],
      );
    });
  }

  /** Xoá mã đặt lại mật khẩu đã hết hạn từ lâu. */
  async purgeOldResetTokens(): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days'`,
    );
  }

  private findWithPassword(
    column: 'email' | 'id',
    value: string,
  ): Promise<User | null> {
    const qb = this.users.createQueryBuilder('u').addSelect('u.passwordHash');
    return (
      column === 'email'
        ? qb.where('u.email = :value', { value })
        : qb.where('u.id = :value', { value })
    ).getOne();
  }

  private async getUser(userId: number): Promise<User> {
    const user = await this.users.findOneBy({ id: String(userId) });
    if (!user) throw this.userGone();
    return user;
  }

  private userGone() {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_TOKEN',
      'Tài khoản không còn tồn tại',
    );
  }

  private async issueToken(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.tokenVersion,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      user: UserResponse.from(user),
    };
  }
}
