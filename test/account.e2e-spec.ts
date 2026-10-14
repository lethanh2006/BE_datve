import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MailService } from '../src/mail/mail.service';
import {
  bearer,
  createAdmin,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

/** Chờ điều kiện đúng (email được gửi bất đồng bộ sau khi API trả lời). */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs)
      throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Tài khoản (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let mail: MailService;
  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    mail = app.get(MailService);
  });
  beforeEach(async () => {
    await resetDb(ds);
    mail.outbox.length = 0;
  });
  afterAll(() => app.close());

  /** Lấy mã đặt lại mật khẩu từ liên kết trong email gần nhất. */
  const tokenFromLastMail = () => {
    const last = mail.outbox.at(-1)!;
    const match = /reset-password\?token=([^\s&]+)/.exec(last.text);
    return decodeURIComponent(match![1]);
  };

  describe('hồ sơ', () => {
    it('đổi họ tên', async () => {
      const user = await registerUser(app);
      const res = await http()
        .put('/api/auth/me')
        .set(bearer(user))
        .send({ fullName: '  Tên Mới  ' })
        .expect(200);
      expect(res.body.fullName).toBe('Tên Mới');
      const me = await http().get('/api/auth/me').set(bearer(user)).expect(200);
      expect(me.body.fullName).toBe('Tên Mới');

      const bad = await http()
        .put('/api/auth/me')
        .set(bearer(user))
        .send({ fullName: '   ' })
        .expect(400);
      expect(bad.body.message).toContain('Họ tên không được để trống');
      await http().put('/api/auth/me').send({ fullName: 'x' }).expect(401);
    });
  });

  describe('đổi mật khẩu', () => {
    it('chỉ một yêu cầu đổi đồng thời được dùng mật khẩu cũ', async () => {
      const user = await registerUser(app);
      const results = await Promise.all(
        ['matkhau-moi-a', 'matkhau-moi-b'].map((newPassword) =>
          http()
            .put('/api/auth/password')
            .set(bearer(user))
            .send({ currentPassword: 'password123', newPassword }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        results.filter((r) => r.status === 400 || r.status === 401),
      ).toHaveLength(1);
      const winner = results.find((r) => r.status === 200)!;
      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${winner.body.accessToken}`)
        .expect(200);
    });

    it('đổi mật khẩu vô hiệu hoá cả liên kết khôi phục đã cấp', async () => {
      const user = await registerUser(app);
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: user.email })
        .expect(202);
      await waitFor(() => mail.outbox.length === 1);
      const token = tokenFromLastMail();
      await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'password123', newPassword: 'matkhau-moi-1' })
        .expect(200);
      await http()
        .post('/api/auth/reset-password')
        .send({ token, password: 'matkhau-moi-2' })
        .expect(400);
      await login(user.email, 'matkhau-moi-1').expect(200);
    });

    it('giới hạn mật khẩu bằng byte để bcrypt không cắt mật khẩu Unicode', async () => {
      const user = await registerUser(app);
      const tooLong = 'ệ'.repeat(25);
      const res = await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'password123', newPassword: tooLong })
        .expect(400);
      expect(res.body.message).toContain('72 byte');
      await http()
        .post('/api/auth/register')
        .send({
          email: 'unicode@test.com',
          fullName: 'Unicode',
          password: tooLong,
        })
        .expect(400);
      await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'password123', newPassword: 'ệ'.repeat(24) })
        .expect(200);
      await login(user.email, 'ệ'.repeat(24)).expect(200);
    });
    it('thu hồi token cũ, trả token mới và chỉ mật khẩu mới đăng nhập được', async () => {
      const user = await registerUser(app, 'a@test.com');
      const res = await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'password123', newPassword: 'matkhau-moi-1' })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.accessToken).not.toBe(user.token);

      const old = await http()
        .get('/api/auth/me')
        .set(bearer(user))
        .expect(401);
      expect(old.body.code).toBe('INVALID_TOKEN');
      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      await login('a@test.com', 'password123').expect(401);
      await login('a@test.com', 'matkhau-moi-1').expect(200);
    });

    it('từ chối mật khẩu hiện tại sai, mật khẩu mới trùng cũ hoặc quá ngắn', async () => {
      const user = await registerUser(app);
      const wrong = await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'sai-mat-khau', newPassword: 'matkhau-moi-1' })
        .expect(400);
      expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');

      const same = await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'password123', newPassword: 'password123' })
        .expect(400);
      expect(same.body.code).toBe('SAME_PASSWORD');

      const short = await http()
        .put('/api/auth/password')
        .set(bearer(user))
        .send({ currentPassword: 'password123', newPassword: '123' })
        .expect(400);
      expect(short.body.message).toContain('Mật khẩu tối thiểu 8 ký tự');

      // token cũ vẫn dùng được vì chưa đổi gì
      await http().get('/api/auth/me').set(bearer(user)).expect(200);
    });
  });

  describe('quên và đặt lại mật khẩu', () => {
    it('yêu cầu quên mật khẩu đồng thời chỉ gửi một email', async () => {
      const user = await registerUser(app);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          http().post('/api/auth/forgot-password').send({ email: user.email }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202]);
      await waitFor(() => mail.outbox.length >= 1);
      expect(mail.outbox).toHaveLength(1);
      const [{ count }] = await ds.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM password_reset_tokens WHERE used_at IS NULL`,
      );
      expect(count).toBe(1);
    });

    it('mã khôi phục chỉ dùng thành công một lần khi gửi đồng thời', async () => {
      const user = await registerUser(app);
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: user.email })
        .expect(202);
      await waitFor(() => mail.outbox.length === 1);
      const token = tokenFromLastMail();
      const results = await Promise.all(
        ['matkhau-moi-a', 'matkhau-moi-b'].map((password) =>
          http().post('/api/auth/reset-password').send({ token, password }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
      await login(
        user.email,
        results[0].status === 204 ? 'matkhau-moi-a' : 'matkhau-moi-b',
      ).expect(200);
    });
    it('email lạ: vẫn trả 202 và không gửi thư (không lộ tài khoản có tồn tại)', async () => {
      await registerUser(app, 'co-that@test.com');
      const unknown = await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'khong-co@test.com' })
        .expect(202);
      const known = await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'co-that@test.com' })
        .expect(202);
      expect(unknown.body).toEqual(known.body);
      await waitFor(() => mail.outbox.length === 1);
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].to).toBe('co-that@test.com');
    });

    it('đặt lại thành công: đăng nhập bằng mật khẩu mới, thu hồi phiên cũ, mã dùng một lần', async () => {
      const user = await registerUser(app, 'a@test.com', 'Nguyễn A');
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'A@test.com ' })
        .expect(202);
      await waitFor(() => mail.outbox.length === 1);
      const mailBody = mail.outbox[0];
      expect(mailBody.subject).toContain('Đặt lại mật khẩu');
      expect(mailBody.text).toContain('Nguyễn A');
      expect(mailBody.html).toContain('/reset-password?token=');
      const token = tokenFromLastMail();

      // mã chỉ nằm trong email; DB chỉ giữ băm
      const [row] = await ds.query(
        `SELECT token_hash FROM password_reset_tokens`,
      );
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.token_hash).not.toContain(token);

      await http()
        .post('/api/auth/reset-password')
        .send({ token, password: 'matkhau-moi-2' })
        .expect(204);

      await login('a@test.com', 'password123').expect(401);
      await login('a@test.com', 'matkhau-moi-2').expect(200);
      await http().get('/api/auth/me').set(bearer(user)).expect(401);

      const reuse = await http()
        .post('/api/auth/reset-password')
        .send({ token, password: 'matkhau-moi-3' })
        .expect(400);
      expect(reuse.body.code).toBe('INVALID_RESET_TOKEN');
    });

    it('từ chối mã sai, mã hết hạn và mật khẩu mới quá ngắn', async () => {
      await registerUser(app, 'a@test.com');
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
      await waitFor(() => mail.outbox.length === 1);
      const token = tokenFromLastMail();

      await http()
        .post('/api/auth/reset-password')
        .send({ token: 'khong-phai-ma-that', password: 'matkhau-moi-2' })
        .expect(400);
      const short = await http()
        .post('/api/auth/reset-password')
        .send({ token, password: '123' })
        .expect(400);
      expect(short.body.message).toContain('Mật khẩu tối thiểu 8 ký tự');

      await ds.query(
        `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'`,
      );
      const expired = await http()
        .post('/api/auth/reset-password')
        .send({ token, password: 'matkhau-moi-2' })
        .expect(400);
      expect(expired.body.code).toBe('INVALID_RESET_TOKEN');
      await login('a@test.com', 'password123').expect(200);
    });

    it('không gửi dồn dập: trong 60 giây chỉ nhận một thư; mã mới vô hiệu mã cũ', async () => {
      await registerUser(app, 'a@test.com');
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
      await waitFor(() => mail.outbox.length >= 1);
      expect(mail.outbox).toHaveLength(1);
      const first = tokenFromLastMail();

      await ds.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '2 minutes'`,
      );
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
      await waitFor(() => mail.outbox.length === 2);
      const second = tokenFromLastMail();
      expect(second).not.toBe(first);

      await http()
        .post('/api/auth/reset-password')
        .send({ token: first, password: 'matkhau-moi-2' })
        .expect(400);
      await http()
        .post('/api/auth/reset-password')
        .send({ token: second, password: 'matkhau-moi-2' })
        .expect(204);
    });

    it('tài khoản bị khoá không nhận được thư và không đặt lại được mật khẩu', async () => {
      await registerUser(app, 'a@test.com');
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
      await waitFor(() => mail.outbox.length === 1);
      const token = tokenFromLastMail();

      await ds.query(`UPDATE users SET disabled_at = now()`);
      await http()
        .post('/api/auth/reset-password')
        .send({ token, password: 'matkhau-moi-2' })
        .expect(400);
      mail.outbox.length = 0;
      await ds.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '2 minutes'`,
      );
      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
      await new Promise((r) => setTimeout(r, 100));
      expect(mail.outbox).toHaveLength(0);
    });

    it('kiểm tra định dạng email', async () => {
      const res = await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'khong-phai-email' })
        .expect(400);
      expect(res.body.message).toContain('Email không hợp lệ');
    });
  });

  describe('vai trò và khoá tài khoản có hiệu lực ngay', () => {
    it('nâng/hạ quyền admin áp dụng cho token đang dùng, không cần đăng nhập lại', async () => {
      const user = await registerUser(app, 'a@test.com');
      await http().get('/api/admin/stats').set(bearer(user)).expect(403);

      await ds.query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [
        user.id,
      ]);
      await http().get('/api/admin/stats').set(bearer(user)).expect(200);

      await ds.query(`UPDATE users SET role = 'USER' WHERE id = $1`, [user.id]);
      await http().get('/api/admin/stats').set(bearer(user)).expect(403);
    });

    it('khoá tài khoản: token đang dùng bị từ chối, đăng nhập đúng mật khẩu báo ACCOUNT_DISABLED', async () => {
      const user = await registerUser(app, 'a@test.com');
      await ds.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [
        user.id,
      ]);

      const res = await http()
        .get('/api/auth/me')
        .set(bearer(user))
        .expect(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
      const disabled = await login('a@test.com', 'password123').expect(403);
      expect(disabled.body.code).toBe('ACCOUNT_DISABLED');
      // sai mật khẩu thì vẫn chỉ báo sai thông tin, không lộ tình trạng tài khoản
      const wrong = await login('a@test.com', 'sai-mat-khau').expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('token của tài khoản đã bị xoá không dùng được', async () => {
      const user = await registerUser(app, 'a@test.com');
      await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
      await http().get('/api/auth/me').set(bearer(user)).expect(401);
    });
  });

  describe('email xác nhận vé', () => {
    it('gửi vé kèm mã đặt vé và mã QR sau khi thanh toán thành công', async () => {
      const show = await seedShow(ds, {
        seats: 3,
        price: 150000,
        name: 'Đêm <nhạc> & "Rock"',
      });
      const user = await registerUser(
        app,
        'khach@test.com',
        'Khách <b>Hàng</b>',
      );
      const booking = await createBooking(app, user, show.showtimeId, [
        show.seatIds[0],
        show.seatIds[1],
      ]);
      mail.outbox.length = 0;

      await http()
        .post(`/api/bookings/${booking.id}/payments`)
        .set({
          Authorization: `Bearer ${user.token}`,
          'Idempotency-Key': 'mail-confirm-0001',
        })
        .send({})
        .expect(201);
      await waitFor(() => mail.outbox.length === 1);

      const sent = mail.outbox[0];
      const detail = await http()
        .get(`/api/bookings/${booking.id}`)
        .set(bearer(user))
        .expect(200);
      expect(sent.to).toBe('khach@test.com');
      expect(sent.subject).toContain(
        `DV-${String(booking.id).padStart(6, '0')}`,
      );
      expect(sent.text).toContain(detail.body.ticketCode);
      expect(sent.text).toContain('A1, A2');
      expect(sent.text).toMatch(/300\.000/);
      // nội dung do người dùng nhập phải được escape trong HTML
      expect(sent.html).not.toContain('<b>Hàng</b>');
      expect(sent.html).toContain('Khách &lt;b&gt;Hàng&lt;/b&gt;');
      expect(sent.html).toContain('Đêm &lt;nhạc&gt; &amp; &quot;Rock&quot;');
    });

    it('thanh toán thất bại hoặc gọi lại cùng khoá thì không gửi thêm thư', async () => {
      const show = await seedShow(ds, { seats: 2 });
      const user = await registerUser(app);
      const booking = await createBooking(app, user, show.showtimeId, [
        show.seatIds[0],
      ]);
      mail.outbox.length = 0;

      const pay = (key: string, body: object = {}) =>
        http()
          .post(`/api/bookings/${booking.id}/payments`)
          .set({
            Authorization: `Bearer ${user.token}`,
            'Idempotency-Key': key,
          })
          .send(body);
      await pay('mail-failed-00001', { simulate: 'FAILED' }).expect(201);
      await new Promise((r) => setTimeout(r, 100));
      expect(mail.outbox).toHaveLength(0);

      await pay('mail-ok-000000001').expect(201);
      await waitFor(() => mail.outbox.length === 1);
      await pay('mail-ok-000000001').expect(200);
      await new Promise((r) => setTimeout(r, 100));
      expect(mail.outbox).toHaveLength(1);
    });
  });

  it('lỗi gửi thư không làm hỏng yêu cầu quên mật khẩu', async () => {
    const failing = await createTestApp((b) =>
      b.overrideProvider(MailService).useValue({
        outbox: [],
        send: () => Promise.reject(new Error('SMTP down')),
      }),
    );
    try {
      await registerUser(failing.app, 'a@test.com');
      await request(failing.app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'a@test.com' })
        .expect(202);
    } finally {
      await failing.app.close();
    }
  });

  it('admin vẫn đăng nhập và dùng được như trước', async () => {
    const admin = await createAdmin(app, ds);
    await http().get('/api/admin/stats').set(bearer(admin)).expect(200);
  });
});
