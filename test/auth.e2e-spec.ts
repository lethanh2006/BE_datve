import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bearer, createTestApp, registerUser, resetDb } from './helpers';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, ds } = await createTestApp()));
  beforeEach(() => resetDb(ds));
  afterAll(() => app.close());

  it('đăng ký thành công, trả token và không lộ mật khẩu', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({
        email: ' Nguoi.Dung@Test.com ',
        password: 'password123',
        fullName: '  Nguyễn Văn A ',
      })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      email: 'nguoi.dung@test.com',
      fullName: 'Nguyễn Văn A',
      role: 'USER',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('không cho đăng ký trùng email (không phân biệt hoa thường)', async () => {
    await registerUser(app, 'a@test.com');
    const res = await http()
      .post('/api/auth/register')
      .send({ email: 'A@test.com', password: 'password123', fullName: 'B' })
      .expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('kiểm tra dữ liệu đăng ký', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ email: 'khong-phai-email', password: '123', fullName: '' })
      .expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('Email không hợp lệ');
    expect(res.body.message).toContain('Mật khẩu tối thiểu 8 ký tự');
    expect(res.body.message).toContain('Họ tên không được để trống');
  });

  it('đăng nhập đúng và sai mật khẩu', async () => {
    await registerUser(app, 'a@test.com');

    const ok = await http()
      .post('/api/auth/login')
      .send({ email: 'A@test.com', password: 'password123' })
      .expect(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));

    const wrong = await http()
      .post('/api/auth/login')
      .send({ email: 'a@test.com', password: 'sai-mat-khau' })
      .expect(401);
    const unknown = await http()
      .post('/api/auth/login')
      .send({ email: 'khong-co@test.com', password: 'password123' })
      .expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('/me cần token hợp lệ', async () => {
    const user = await registerUser(app, 'a@test.com');

    const me = await http().get('/api/auth/me').set(bearer(user)).expect(200);
    expect(me.body).toMatchObject({
      id: user.id,
      email: 'a@test.com',
      role: 'USER',
    });

    const none = await http().get('/api/auth/me').expect(401);
    expect(none.body.code).toBe('UNAUTHORIZED');

    const bad = await http()
      .get('/api/auth/me')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(401);
    expect(bad.body.code).toBe('INVALID_TOKEN');
  });

  it('route công khai không cần token', async () => {
    await http().get('/api/events').expect(200);
    await http().get('/actuator/health').expect(200, { status: 'UP' });
  });
});
