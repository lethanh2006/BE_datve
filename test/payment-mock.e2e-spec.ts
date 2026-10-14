import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  bearer,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

/** Chạy với MockPaymentGateway thật để kiểm tra cờ giả lập thất bại. */
describe('Cổng thanh toán giả (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const pay = (token: string, bookingId: number, key: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/payments`)
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': key })
      .send(body);

  async function newBooking() {
    const show = await seedShow(ds, { seats: 1 });
    const user = await registerUser(app);
    return {
      user,
      booking: await createBooking(app, user, show.showtimeId, show.seatIds),
    };
  }

  afterEach(async () => {
    await app.close();
    process.env.PAYMENT_ALLOW_SIMULATION = 'true';
  });

  it('simulate=FAILED làm giao dịch thất bại, đơn về PENDING; thử lại với key mới thì thành công', async () => {
    ({ app, ds } = await createTestApp());
    await resetDb(ds);
    const { user, booking } = await newBooking();

    const failed = await pay(user.token, booking.id, 'mock-fail-000001', {
      simulate: 'FAILED',
    }).expect(201);
    expect(failed.body).toMatchObject({
      status: 'FAILED',
      provider: 'MOCK',
      providerReference: null,
      bookingStatus: 'PENDING',
    });

    const ok = await pay(user.token, booking.id, 'mock-fail-000002', {}).expect(
      201,
    );
    expect(ok.body).toMatchObject({
      status: 'SUCCESS',
      bookingStatus: 'CONFIRMED',
    });
    expect(ok.body.providerReference).toMatch(/^MOCK-/);

    const detail = await request(app.getHttpServer())
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user));
    expect(detail.body.status).toBe('CONFIRMED');
  });

  it('bỏ qua simulate khi PAYMENT_ALLOW_SIMULATION không bật', async () => {
    process.env.PAYMENT_ALLOW_SIMULATION = 'false';
    ({ app, ds } = await createTestApp());
    await resetDb(ds);
    const { user, booking } = await newBooking();

    const res = await pay(user.token, booking.id, 'mock-nosim-00001', {
      simulate: 'FAILED',
    }).expect(201);
    expect(res.body.status).toBe('SUCCESS');
  });

  it('simulate chỉ nhận SUCCESS hoặc FAILED', async () => {
    ({ app, ds } = await createTestApp());
    await resetDb(ds);
    const { user, booking } = await newBooking();
    const res = await pay(user.token, booking.id, 'mock-badsim-0001', {
      simulate: 'LUNG_TUNG',
    }).expect(400);
    expect(res.body.message).toContain('simulate');
  });
});
