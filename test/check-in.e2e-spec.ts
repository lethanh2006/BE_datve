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

describe('Soát vé (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, ds } = await createTestApp()));
  beforeEach(() => resetDb(ds));
  afterAll(() => app.close());

  async function paidBooking() {
    const show = await seedShow(ds, { seats: 3 });
    const user = await registerUser(app, 'khach@test.com', 'Khách Hàng');
    const booking = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);
    await http()
      .post(`/api/bookings/${booking.id}/payments`)
      .set({
        Authorization: `Bearer ${user.token}`,
        'Idempotency-Key': `key-${booking.id}-00000001`,
      })
      .send({})
      .expect(201);
    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    return { user, show, booking: detail.body };
  }

  it('chỉ đơn đã thanh toán mới có mã vé, mã không đoán được', async () => {
    const show = await seedShow(ds, { seats: 3 });
    const user = await registerUser(app);
    const pending = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);
    expect(pending.ticketCode).toBeNull();
    expect(pending.checkedInAt).toBeNull();

    const { booking } = await paidBooking();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.ticketCode).toMatch(/^[0-9a-f]{16}$/);
    expect(booking.checkedInAt).toBeNull();
  });

  it('admin quét vé: lần đầu CHECKED_IN, quét lại ALREADY_CHECKED_IN', async () => {
    const { user, booking } = await paidBooking();
    const admin = await createAdmin(app, ds);

    const first = await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: booking.ticketCode })
      .expect(200);
    expect(first.body.result).toBe('CHECKED_IN');
    expect(first.body.booking).toMatchObject({
      id: booking.id,
      status: 'CONFIRMED',
      customer: { email: 'khach@test.com', fullName: 'Khách Hàng' },
    });
    expect(first.body.booking.checkedInAt).toEqual(expect.any(String));

    const again = await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: booking.ticketCode })
      .expect(200);
    expect(again.body.result).toBe('ALREADY_CHECKED_IN');
    expect(again.body.booking.checkedInAt).toBe(first.body.booking.checkedInAt);

    // khách thấy vé của mình đã được dùng
    const mine = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    expect(mine.body.checkedInAt).toBe(first.body.booking.checkedInAt);
  });

  it('chấp nhận mã có khoảng trắng hoặc viết hoa (máy quét/nhập tay)', async () => {
    const { booking } = await paidBooking();
    const admin = await createAdmin(app, ds);
    const res = await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: `  ${String(booking.ticketCode).toUpperCase()}\n` })
      .expect(200);
    expect(res.body.result).toBe('CHECKED_IN');
  });

  it('mã sai hoặc thiếu bị từ chối', async () => {
    const admin = await createAdmin(app, ds);
    const unknown = await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: 'khongtontai00000' })
      .expect(404);
    expect(unknown.body.code).toBe('TICKET_NOT_FOUND');
    await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({})
      .expect(400);
    await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: '   ' })
      .expect(400);
  });

  it('chỉ ADMIN được soát vé', async () => {
    const { user, booking } = await paidBooking();
    await http()
      .post('/api/admin/bookings/check-in')
      .send({ ticketCode: booking.ticketCode })
      .expect(401);
    await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(user))
      .send({ ticketCode: booking.ticketCode })
      .expect(403);
  });

  it('vé của đơn không còn hiệu lực thì không cho vào', async () => {
    const { booking } = await paidBooking();
    await ds.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`, [
      booking.id,
    ]);
    const admin = await createAdmin(app, ds);
    const res = await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: booking.ticketCode })
      .expect(409);
    expect(res.body.code).toBe('TICKET_INVALID');
  });

  it('hai máy quét cùng lúc: đúng một máy được CHECKED_IN', async () => {
    const { booking } = await paidBooking();
    const admin = await createAdmin(app, ds);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        http()
          .post('/api/admin/bookings/check-in')
          .set(bearer(admin))
          .send({ ticketCode: booking.ticketCode }),
      ),
    );
    const outcomes = results.map((r) => r.body.result).sort();
    expect(outcomes).toEqual([
      'ALREADY_CHECKED_IN',
      'ALREADY_CHECKED_IN',
      'ALREADY_CHECKED_IN',
      'ALREADY_CHECKED_IN',
      'CHECKED_IN',
    ]);
  });
});
