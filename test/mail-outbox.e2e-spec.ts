import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MAX_ATTEMPTS, MailService } from '../src/mail/mail.service';
import {
  MAIL_TRANSPORT,
  MailMessage,
  MailTransport,
} from '../src/mail/mail.types';
import {
  bearer,
  createAdmin,
  createTestApp,
  registerUser,
  resetDb,
} from './helpers';

/** Transport điều khiển được: lỗi N lần đầu rồi mới thành công; có thể làm chậm để thử đồng thời. */
class ScriptedTransport implements MailTransport {
  delivered: (MailMessage & { from: string })[] = [];
  calls = 0;
  failTimes = 0;
  delayMs = 0;

  async send(message: MailMessage & { from: string }) {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.calls <= this.failTimes)
      throw new Error(`SMTP tạm thời lỗi (lần ${this.calls})`);
    this.delivered.push(message);
  }
}

describe('Hàng đợi email (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let mail: MailService;
  const transport = new ScriptedTransport();
  const http = () => request(app.getHttpServer());
  const rows = () =>
    ds.query<
      {
        id: string;
        status: string;
        attempts: number;
        body_text: string;
        body_html: string | null;
        last_error: string | null;
        sent_at: Date | null;
      }[]
    >(`SELECT * FROM email_outbox ORDER BY id`);
  const message: MailMessage = {
    to: 'khach@test.com',
    subject: 'Xin chào',
    text: 'Mã bí mật: 123456',
    html: '<b>Mã bí mật: 123456</b>',
  };
  /** Đẩy mọi thư đang chờ thử lại về "đến hạn ngay". */
  const makeDue = () =>
    ds.query(
      `UPDATE email_outbox SET next_attempt_at = now() WHERE status = 'PENDING'`,
    );

  beforeAll(async () => {
    ({ app, ds } = await createTestApp((b) =>
      b.overrideProvider(MAIL_TRANSPORT).useValue(transport),
    ));
    mail = app.get(MailService);
  });
  beforeEach(async () => {
    await resetDb(ds);
    Object.assign(transport, {
      delivered: [],
      calls: 0,
      failTimes: 0,
      delayMs: 0,
    });
  });
  afterAll(() => app.close());

  /** Chờ các lượt gửi nền (kích hoạt ngay sau khi xếp hàng đợi) chạy xong. */
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('gửi thành công: tới đúng người, trạng thái SENT, nội dung bị xoá khỏi DB', async () => {
    await mail.send(message);
    await settle();

    expect(transport.delivered).toHaveLength(1);
    expect(transport.delivered[0]).toMatchObject({
      to: 'khach@test.com',
      subject: 'Xin chào',
      text: 'Mã bí mật: 123456',
    });
    expect(transport.delivered[0].from).toContain('no-reply');
    const [row] = await rows();
    expect(row).toMatchObject({
      status: 'SENT',
      attempts: 1,
      last_error: null,
      body_text: '',
      body_html: null,
    });
    expect(row.sent_at).not.toBeNull();
  });

  it('SMTP lỗi: giữ thư, tăng số lần thử, hẹn thử lại sau; hết lỗi thì tự gửi được', async () => {
    transport.failTimes = 2;
    await mail.send(message);
    await settle();

    let [row] = await rows();
    expect(row).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      body_text: message.text,
    });
    expect(row.last_error).toContain('SMTP tạm thời lỗi');
    const [{ wait }] = await ds.query(
      `SELECT extract(epoch FROM next_attempt_at - now())::int AS wait FROM email_outbox`,
    );
    expect(wait).toBeGreaterThan(30); // chưa đến hạn nên worker chưa gửi lại ngay
    expect(await mail.flush()).toBe(0);

    await makeDue();
    expect(await mail.flush()).toBe(0); // lần thử thứ 2 vẫn lỗi
    await makeDue();
    expect(await mail.flush()).toBe(1); // lần thứ 3 thành công
    [row] = await rows();
    expect(row).toMatchObject({
      status: 'SENT',
      attempts: 3,
      last_error: null,
      body_text: '',
    });
    expect(transport.delivered).toHaveLength(1);
  });

  it(`lỗi liên tục: sau ${MAX_ATTEMPTS} lần chuyển FAILED và giữ nội dung để gửi lại`, async () => {
    transport.failTimes = 999;
    await mail.send(message);
    await settle();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await makeDue();
      await mail.flush();
    }
    const [row] = await rows();
    expect(row).toMatchObject({
      status: 'FAILED',
      attempts: MAX_ATTEMPTS,
      body_text: message.text,
    });

    // FAILED không được gửi lại tự động
    await makeDue();
    expect(await mail.flush()).toBe(0);
    expect(transport.calls).toBe(MAX_ATTEMPTS);
  });

  it('nhiều worker chạy đồng thời không gửi trùng một thư', async () => {
    await mail.send(message);
    await settle();
    await ds.query(
      `UPDATE email_outbox SET status = 'PENDING', attempts = 0, next_attempt_at = now()`,
    );
    transport.delayMs = 150;
    Object.assign(transport, { delivered: [], calls: 0 });

    const results = await Promise.all([
      mail.flush(),
      mail.flush(),
      mail.flush(),
    ]);

    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(transport.calls).toBe(1);
  });

  it('thư đã được thuê (đang gửi) thì chưa gửi lại cho tới khi hết hạn thuê', async () => {
    await mail.send(message);
    await settle();
    await ds.query(
      `UPDATE email_outbox SET status = 'PENDING', attempts = 1, next_attempt_at = now() + interval '90 seconds'`,
    );
    expect(await mail.flush()).toBe(0);
    // tiến trình chết giữa chừng: hết hạn thuê thì thư được gửi lại
    await ds.query(
      `UPDATE email_outbox SET next_attempt_at = now() - interval '1 second'`,
    );
    expect(await mail.flush()).toBe(1);
  });

  describe('API quản trị', () => {
    it('chỉ ADMIN xem được; liệt kê, lọc theo trạng thái và không lộ nội dung thư', async () => {
      const user = await registerUser(app, 'a@test.com');
      await http().get('/api/admin/emails').expect(401);
      await http().get('/api/admin/emails').set(bearer(user)).expect(403);

      const admin = await createAdmin(app, ds);
      await mail.send(message);
      await settle();
      transport.failTimes = 999;
      await mail.send({ ...message, to: 'loi@test.com', subject: 'Sẽ lỗi' });
      await settle();

      const all = await http()
        .get('/api/admin/emails')
        .set(bearer(admin))
        .expect(200);
      expect(all.body.totalElements).toBe(2);
      expect(JSON.stringify(all.body)).not.toContain('123456');
      const pending = await http()
        .get('/api/admin/emails')
        .query({ status: 'PENDING' })
        .set(bearer(admin))
        .expect(200);
      expect(pending.body.content.map((e: { to: string }) => e.to)).toEqual([
        'loi@test.com',
      ]);
      expect(pending.body.content[0]).toMatchObject({
        attempts: 1,
        lastError: expect.stringContaining('SMTP'),
      });
      await http()
        .get('/api/admin/emails')
        .query({ status: 'LUNG_TUNG' })
        .set(bearer(admin))
        .expect(400);
    });

    it('gửi lại thư FAILED; thư khác trạng thái bị từ chối', async () => {
      const admin = await createAdmin(app, ds);
      transport.failTimes = MAX_ATTEMPTS;
      await mail.send(message);
      await settle();
      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        await makeDue();
        await mail.flush();
      }
      const [failed] = await rows();
      expect(failed.status).toBe('FAILED');

      const sentOk = await http()
        .post(`/api/admin/emails/${failed.id}/retry`)
        .set(bearer(admin))
        .expect(202);
      expect(sentOk.body.message).toContain('hàng đợi');
      await settle();
      const [after] = await rows();
      expect(after).toMatchObject({ status: 'SENT', body_text: '' });
      expect(transport.delivered).toHaveLength(1);

      const again = await http()
        .post(`/api/admin/emails/${failed.id}/retry`)
        .set(bearer(admin))
        .expect(409);
      expect(again.body.code).toBe('EMAIL_NOT_RETRYABLE');
      await http()
        .post('/api/admin/emails/999999/retry')
        .set(bearer(admin))
        .expect(409);
    });
  });

  it('luồng nghiệp vụ không bị ảnh hưởng khi SMTP hỏng: đăng ký vẫn được, quên mật khẩu vẫn trả 202', async () => {
    transport.failTimes = 999;
    await registerUser(app, 'a@test.com');
    await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'a@test.com' })
      .expect(202);
    await settle();
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row.body_text).toContain('reset-password?token=');
  });

  it('mã đặt lại mật khẩu không còn nằm trong DB sau khi thư được gửi', async () => {
    await registerUser(app, 'a@test.com');
    await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'a@test.com' })
      .expect(202);
    await settle();
    expect(transport.delivered[0].text).toContain('reset-password?token=');
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'SENT', body_text: '' });
  });
});
