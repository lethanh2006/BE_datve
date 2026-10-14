import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  bearer,
  createAdmin,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

describe('Quản lý người dùng (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, ds } = await createTestApp()));
  beforeEach(() => resetDb(ds));
  afterAll(() => app.close());

  it('chỉ ADMIN được dùng', async () => {
    const user = await registerUser(app);
    await http().get('/api/admin/users').expect(401);
    await http().get('/api/admin/users').set(bearer(user)).expect(403);
    await http()
      .put(`/api/admin/users/${user.id}/role`)
      .set(bearer(user))
      .send({ role: 'ADMIN' })
      .expect(403);
  });

  it('liệt kê, tìm kiếm, lọc theo vai trò và trạng thái, kèm số đơn và tổng chi tiêu', async () => {
    const admin = await createAdmin(app, ds);
    const an = await registerUser(app, 'an@test.com', 'Nguyễn An');
    await registerUser(app, 'binh@test.com', 'Trần Bình');
    await ds.query(
      `UPDATE users SET disabled_at = now() WHERE email = 'binh@test.com'`,
    );

    const show = await seedShow(ds, { seats: 3, price: 150000 });
    const booking = await createBooking(app, an, show.showtimeId, [
      show.seatIds[0],
      show.seatIds[1],
    ]);
    await http()
      .post(`/api/bookings/${booking.id}/payments`)
      .set({
        Authorization: `Bearer ${an.token}`,
        'Idempotency-Key': 'users-spent-00001',
      })
      .send({})
      .expect(201);

    const all = await http()
      .get('/api/admin/users')
      .set(bearer(admin))
      .expect(200);
    expect(all.body.totalElements).toBe(3);
    expect(all.body.content.map((u: { email: string }) => u.email)).toEqual([
      'binh@test.com',
      'an@test.com',
      'admin@test.com',
    ]);
    const anRow = all.body.content.find(
      (u: { email: string }) => u.email === 'an@test.com',
    );
    expect(anRow).toMatchObject({
      role: 'USER',
      disabledAt: null,
      confirmedBookings: 1,
      totalSpent: 300000,
    });
    expect(JSON.stringify(all.body)).not.toMatch(/password/i);

    const byName = await http()
      .get('/api/admin/users')
      .query({ q: 'nguyễn' })
      .set(bearer(admin))
      .expect(200);
    expect(byName.body.content.map((u: { email: string }) => u.email)).toEqual([
      'an@test.com',
    ]);
    const admins = await http()
      .get('/api/admin/users')
      .query({ role: 'ADMIN' })
      .set(bearer(admin))
      .expect(200);
    expect(admins.body.totalElements).toBe(1);
    const disabled = await http()
      .get('/api/admin/users')
      .query({ status: 'DISABLED' })
      .set(bearer(admin))
      .expect(200);
    expect(
      disabled.body.content.map((u: { email: string }) => u.email),
    ).toEqual(['binh@test.com']);
    const active = await http()
      .get('/api/admin/users')
      .query({ status: 'ACTIVE' })
      .set(bearer(admin))
      .expect(200);
    expect(active.body.totalElements).toBe(2);

    await http()
      .get('/api/admin/users')
      .query({ role: 'SUPER' })
      .set(bearer(admin))
      .expect(400);
    await http()
      .get('/api/admin/users')
      .query({ status: 'X' })
      .set(bearer(admin))
      .expect(400);
  });

  it('đổi vai trò có hiệu lực ngay với token đang dùng', async () => {
    const admin = await createAdmin(app, ds);
    const user = await registerUser(app, 'a@test.com');
    await http().get('/api/admin/stats').set(bearer(user)).expect(403);

    const promoted = await http()
      .put(`/api/admin/users/${user.id}/role`)
      .set(bearer(admin))
      .send({ role: 'ADMIN' })
      .expect(200);
    expect(promoted.body.role).toBe('ADMIN');
    await http().get('/api/admin/stats').set(bearer(user)).expect(200);

    await http()
      .put(`/api/admin/users/${user.id}/role`)
      .set(bearer(admin))
      .send({ role: 'USER' })
      .expect(200);
    await http().get('/api/admin/stats').set(bearer(user)).expect(403);

    await http()
      .put(`/api/admin/users/${user.id}/role`)
      .set(bearer(admin))
      .send({ role: 'ROOT' })
      .expect(400);
    await http()
      .put('/api/admin/users/999999/role')
      .set(bearer(admin))
      .send({ role: 'USER' })
      .expect(404);
  });

  it('khoá tài khoản thu hồi phiên ngay, mở khoá thì đăng nhập lại được', async () => {
    const admin = await createAdmin(app, ds);
    const user = await registerUser(app, 'a@test.com');

    const locked = await http()
      .put(`/api/admin/users/${user.id}/status`)
      .set(bearer(admin))
      .send({ disabled: true })
      .expect(200);
    expect(locked.body.disabledAt).toEqual(expect.any(String));
    await http().get('/api/auth/me').set(bearer(user)).expect(401);
    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'a@test.com', password: 'password123' })
      .expect(403);
    expect(login.body.code).toBe('ACCOUNT_DISABLED');

    // khoá lần nữa không đổi mốc thời gian khoá
    const again = await http()
      .put(`/api/admin/users/${user.id}/status`)
      .set(bearer(admin))
      .send({ disabled: true })
      .expect(200);
    expect(again.body.disabledAt).toBe(locked.body.disabledAt);

    const unlocked = await http()
      .put(`/api/admin/users/${user.id}/status`)
      .set(bearer(admin))
      .send({ disabled: false })
      .expect(200);
    expect(unlocked.body.disabledAt).toBeNull();
    await http().get('/api/auth/me').set(bearer(user)).expect(401); // token cũ đã bị thu hồi
    await http()
      .post('/api/auth/login')
      .send({ email: 'a@test.com', password: 'password123' })
      .expect(200);

    await http()
      .put(`/api/admin/users/${user.id}/status`)
      .set(bearer(admin))
      .send({ disabled: 'yes' })
      .expect(400);
  });

  it('không tự đổi quyền hay tự khoá chính mình', async () => {
    const admin = await createAdmin(app, ds);
    const role = await http()
      .put(`/api/admin/users/${admin.id}/role`)
      .set(bearer(admin))
      .send({ role: 'USER' })
      .expect(409);
    expect(role.body.code).toBe('CANNOT_MODIFY_SELF');
    await http()
      .put(`/api/admin/users/${admin.id}/status`)
      .set(bearer(admin))
      .send({ disabled: true })
      .expect(409);
    await http().get('/api/admin/stats').set(bearer(admin)).expect(200);
  });

  it('luôn còn ít nhất một quản trị viên: hai admin hạ quyền nhau cùng lúc thì chỉ một người thành công', async () => {
    const first = await createAdmin(app, ds, 'admin1@test.com');
    const second = await createAdmin(app, ds, 'admin2@test.com');

    const results = await Promise.all([
      http()
        .put(`/api/admin/users/${second.id}/role`)
        .set(bearer(first))
        .send({ role: 'USER' }),
      http()
        .put(`/api/admin/users/${first.id}/role`)
        .set(bearer(second))
        .send({ role: 'USER' }),
    ]);

    // Một yêu cầu thành công; yêu cầu còn lại bị chặn: 409 LAST_ADMIN nếu chạy chồng lên nhau,
    // hoặc 403 nếu admin kia đã bị hạ quyền trước khi nó vào tới guard.
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM users WHERE role = 'ADMIN' AND disabled_at IS NULL`,
    );
    expect(count).toBe(1);
  });

  it('hạ quyền một admin đã bị khoá luôn được vì không phải admin đang hoạt động', async () => {
    const actor = await createAdmin(app, ds, 'admin1@test.com');
    const other = await createAdmin(app, ds, 'admin2@test.com');
    await ds.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [
      other.id,
    ]);
    await http()
      .put(`/api/admin/users/${other.id}/role`)
      .set(bearer(actor))
      .send({ role: 'USER' })
      .expect(200);
  });
});
