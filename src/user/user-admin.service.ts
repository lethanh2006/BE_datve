import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/role.enum';
import { containsPattern, matches } from '../common/db/search';
import { ApiException } from '../common/exception/api.exception';
import { PageResponse } from '../common/response/page-response';
import { AdminUserListQuery, AdminUserResponse } from './dto/admin-user.dto';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: Date;
  disabledAt: Date | null;
  confirmedBookings: number;
  totalSpent: string;
}

const SELECT_USER = `
  SELECT u.id, u.email, u.full_name AS "fullName", u.role,
         u.created_at AS "createdAt", u.disabled_at AS "disabledAt",
         coalesce(s.cnt, 0)::int AS "confirmedBookings",
         coalesce(s.total, 0) AS "totalSpent"
  FROM users u
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt, sum(b.total_amount) AS total
    FROM bookings b WHERE b.user_id = u.id AND b.status = 'CONFIRMED'
  ) s ON true`;

const toResponse = (r: UserRow): AdminUserResponse => ({
  id: Number(r.id),
  email: r.email,
  fullName: r.fullName,
  role: r.role,
  createdAt: r.createdAt,
  disabledAt: r.disabledAt,
  confirmedBookings: r.confirmedBookings,
  totalSpent: Number(r.totalSpent),
});

@Injectable()
export class UserAdminService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(
    query: AdminUserListQuery,
  ): Promise<PageResponse<AdminUserResponse>> {
    const where = `WHERE ($1::text IS NULL OR ${matches('u.email', '$1')} OR ${matches('u.full_name', '$1')})
        AND ($2::text IS NULL OR u.role = $2)
        AND ($3::text IS NULL
             OR ($3 = 'DISABLED' AND u.disabled_at IS NOT NULL)
             OR ($3 = 'ACTIVE' AND u.disabled_at IS NULL))`;
    const params = [
      containsPattern(query.q),
      query.role ?? null,
      query.status ?? null,
    ];

    const [rows, counted] = await Promise.all([
      this.dataSource.query<UserRow[]>(
        `${SELECT_USER} ${where} ORDER BY u.id DESC LIMIT $4 OFFSET $5`,
        [...params, query.size, query.page * query.size],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM users u ${where}`,
        params,
      ),
    ]);
    return PageResponse.of(
      rows.map(toResponse),
      query.page,
      query.size,
      counted[0].count,
    );
  }

  async setRole(
    actor: AuthUser,
    id: number,
    role: Role,
  ): Promise<AdminUserResponse> {
    this.assertNotSelf(actor, id);
    await this.dataSource.transaction(async (em) => {
      const { target, otherActiveAdmins } = await this.lock(em, id);
      if (
        target.role === Role.ADMIN &&
        role === Role.USER &&
        !target.disabledAt &&
        otherActiveAdmins === 0
      ) {
        throw this.lastAdmin();
      }
      await em.query(`UPDATE users SET role = $2 WHERE id = $1`, [id, role]);
    });
    return this.getOne(id);
  }

  /**
   * Khoá/mở khoá tài khoản. Khoá sẽ thu hồi mọi phiên đăng nhập hiện có (tăng token_version);
   * ngoài ra JwtAuthGuard luôn kiểm tra disabled_at nên có hiệu lực ngay.
   */
  async setDisabled(
    actor: AuthUser,
    id: number,
    disabled: boolean,
  ): Promise<AdminUserResponse> {
    this.assertNotSelf(actor, id);
    await this.dataSource.transaction(async (em) => {
      const { target, otherActiveAdmins } = await this.lock(em, id);
      if (
        disabled &&
        target.role === Role.ADMIN &&
        !target.disabledAt &&
        otherActiveAdmins === 0
      ) {
        throw this.lastAdmin();
      }
      await em.query(
        `UPDATE users
         SET disabled_at = CASE WHEN $2::boolean THEN COALESCE(disabled_at, now()) ELSE NULL END,
             token_version = token_version + CASE WHEN $2::boolean THEN 1 ELSE 0 END
         WHERE id = $1`,
        [id, disabled],
      );
    });
    return this.getOne(id);
  }

  async getOne(id: number): Promise<AdminUserResponse> {
    const [row] = await this.dataSource.query<UserRow[]>(
      `${SELECT_USER} WHERE u.id = $1`,
      [id],
    );
    if (!row) throw this.notFound(id);
    return toResponse(row);
  }

  private assertNotSelf(actor: AuthUser, id: number) {
    if (actor.id === id) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CANNOT_MODIFY_SELF',
        'Bạn không thể tự đổi quyền hoặc khoá chính tài khoản của mình',
      );
    }
  }

  /**
   * Khoá người bị tác động cùng toàn bộ admin đang hoạt động trong MỘT câu lệnh, theo thứ tự id.
   * Khoá cùng thứ tự ở mọi giao dịch nên hai admin hạ quyền nhau cùng lúc không bị deadlock mà xếp hàng,
   * giao dịch sau thấy trạng thái sau của giao dịch trước và bị chặn bởi quy tắc "còn ít nhất một admin".
   */
  private async lock(em: EntityManager, id: number) {
    const rows = await em.query<
      { id: string; role: Role; disabledAt: Date | null }[]
    >(
      `SELECT id, role, disabled_at AS "disabledAt" FROM users
       WHERE id = $1 OR (role = 'ADMIN' AND disabled_at IS NULL)
       ORDER BY id FOR UPDATE`,
      [id],
    );
    const target = rows.find((r) => Number(r.id) === id);
    if (!target) throw this.notFound(id);
    const otherActiveAdmins = rows.filter(
      (r) => Number(r.id) !== id && r.role === Role.ADMIN && !r.disabledAt,
    ).length;
    return { target, otherActiveAdmins };
  }

  private lastAdmin() {
    return new ApiException(
      HttpStatus.CONFLICT,
      'LAST_ADMIN',
      'Phải còn ít nhất một quản trị viên đang hoạt động',
    );
  }

  private notFound(id: number) {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      'USER_NOT_FOUND',
      `Không tìm thấy người dùng có id ${id}`,
    );
  }
}
