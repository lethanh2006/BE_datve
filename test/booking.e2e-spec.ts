import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  BookingService,
  MAX_ACTIVE_HOLDS_PER_USER,
} from '../src/booking/booking.service';
import {
  bearer,
  createAdmin,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

describe('Đặt vé (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());
  const book = (token: string, showtimeId: number | string, seatIds: unknown) =>
    http()
      .post(`/api/showtimes/${showtimeId}/bookings`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ seatIds });

  beforeAll(async () => ({ app, ds } = await createTestApp()));
  beforeEach(() => resetDb(ds));
  afterAll(() => app.close());

  it('cần đăng nhập để đặt vé', async () => {
    const { showtimeId, seatIds } = await seedShow(ds);
    const res = await http()
      .post(`/api/showtimes/${showtimeId}/bookings`)
      .send({ seatIds })
      .expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    await http().get('/api/bookings').expect(401);
  });

  describe('POST /api/showtimes/:id/bookings', () => {
    it('giữ ghế 5 phút và tính tổng tiền từ giá trong DB', async () => {
      const { eventId, showtimeId, seatIds } = await seedShow(ds, {
        seats: 4,
        price: 150000,
      });
      await ds.query(`UPDATE seats SET face_value = 200000.50 WHERE id = $1`, [
        seatIds[1],
      ]);
      const user = await registerUser(app);

      const before = Date.now();
      const res = await book(user.token, showtimeId, [
        seatIds[0],
        seatIds[1],
      ]).expect(201);

      expect(res.body).toMatchObject({
        showtimeId,
        eventId,
        eventName: 'Sự kiện thử',
        venue: 'Nhà hát',
        status: 'PENDING',
        totalAmount: 350000.5,
      });
      expect(res.body.seats).toEqual([
        {
          seatId: seatIds[0],
          seatCode: 'A1',
          category: 'STANDARD',
          unitPrice: 150000,
          reservationStatus: 'HELD',
        },
        {
          seatId: seatIds[1],
          seatCode: 'A2',
          category: 'STANDARD',
          unitPrice: 200000.5,
          reservationStatus: 'HELD',
        },
      ]);
      const holdMs = new Date(res.body.expiresAt).getTime() - before;
      expect(holdMs).toBeGreaterThan(4.9 * 60_000);
      expect(holdMs).toBeLessThan(5.1 * 60_000);
      expect(res.body.customer).toBeUndefined();
    });

    it('từ chối ghế đã có người giữ (409), người giữ ban đầu không bị ảnh hưởng', async () => {
      const { showtimeId, seatIds } = await seedShow(ds);
      const a = await registerUser(app, 'a@test.com');
      const b = await registerUser(app, 'b@test.com');
      await book(a.token, showtimeId, [seatIds[0], seatIds[1]]).expect(201);

      const res = await book(b.token, showtimeId, [
        seatIds[1],
        seatIds[2],
      ]).expect(409);
      expect(res.body.code).toBe('SEAT_UNAVAILABLE');

      // ghế seatIds[2] không bị giữ nhầm do đơn thất bại
      await book(b.token, showtimeId, [seatIds[2]]).expect(201);
    });

    it('kiểm tra dữ liệu đầu vào', async () => {
      const { showtimeId, seatIds } = await seedShow(ds);
      const user = await registerUser(app);

      const empty = await book(user.token, showtimeId, []).expect(400);
      expect(empty.body.message).toContain('Danh sách ghế không được để trống');
      const missing = await http()
        .post(`/api/showtimes/${showtimeId}/bookings`)
        .set(bearer(user))
        .send({})
        .expect(400);
      expect(missing.body.message).toContain(
        'Danh sách ghế không được để trống',
      );

      const dup = await book(user.token, showtimeId, [
        seatIds[0],
        seatIds[0],
      ]).expect(400);
      expect(dup.body.code).toBe('DUPLICATE_SEAT_ID');

      const notInt = await book(user.token, showtimeId, ['a', 1.5]).expect(400);
      expect(notInt.body.message).toContain('Seat ID phải là số nguyên');
      await book(user.token, showtimeId, [-1]).expect(400);

      const tooMany = await book(
        user.token,
        showtimeId,
        Array.from({ length: 11 }, (_, i) => i + 1),
      ).expect(400);
      expect(tooMany.body.message).toContain('tối đa 10 ghế');

      const unknownSeat = await book(user.token, showtimeId, [
        seatIds[0],
        999999,
      ]).expect(404);
      expect(unknownSeat.body.code).toBe('SEAT_NOT_FOUND');
    });

    it('ghế của suất khác không được đặt qua suất này', async () => {
      const first = await seedShow(ds);
      const second = await seedShow(ds, {
        name: 'Sự kiện khác',
        startsInHours: 48,
      });
      const user = await registerUser(app);
      const res = await book(user.token, first.showtimeId, [
        second.seatIds[0],
      ]).expect(404);
      expect(res.body.code).toBe('SEAT_NOT_FOUND');
    });

    it('404 khi suất diễn không tồn tại, 409 khi suất đã bắt đầu', async () => {
      const user = await registerUser(app);
      const missing = await book(user.token, 999999, [1]).expect(404);
      expect(missing.body.code).toBe('SHOWTIME_NOT_FOUND');

      const past = await seedShow(ds, { startsInHours: -1 });
      const closed = await book(
        user.token,
        past.showtimeId,
        past.seatIds,
      ).expect(409);
      expect(closed.body.code).toBe('SHOWTIME_CLOSED');
    });

    it('chỉ một người thắng khi nhiều người tranh cùng một ghế', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 3 });
      const users = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          registerUser(app, `u${i}@test.com`),
        ),
      );

      const results = await Promise.all(
        users.map((u) => book(u.token, showtimeId, [seatIds[0]])),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM booking_seats WHERE seat_id = $1 AND reservation_status = 'HELD'`,
        [seatIds[0]],
      );
      expect(count).toBe(1);
    });

    it('đặt chéo thứ tự ghế cùng lúc không gây deadlock hay lỗi 500', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 4 });
      const [a, b] = await Promise.all([
        registerUser(app, 'a@test.com'),
        registerUser(app, 'b@test.com'),
      ]);

      const [ra, rb] = await Promise.all([
        book(a.token, showtimeId, [seatIds[0], seatIds[1], seatIds[2]]),
        book(b.token, showtimeId, [seatIds[2], seatIds[1], seatIds[0]]),
      ]);

      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    });

    it('đơn quá hạn nhả ghế cho người đặt sau', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 3 });
      const a = await registerUser(app, 'a@test.com');
      const b = await registerUser(app, 'b@test.com');
      const old = await createBooking(app, a, showtimeId, [
        seatIds[0],
        seatIds[1],
      ]);
      await ds.query(
        `UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [old.id],
      );

      await book(b.token, showtimeId, [seatIds[1]]).expect(201);

      const [booking] = await ds.query(
        `SELECT status FROM bookings WHERE id = $1`,
        [old.id],
      );
      expect(booking.status).toBe('EXPIRED');
      const released = await ds.query(
        `SELECT seat_id FROM booking_seats WHERE booking_id = $1 AND reservation_status = 'RELEASED'`,
        [old.id],
      );
      expect(released).toHaveLength(2);
      // người cũ thấy đơn của mình đã hết hạn
      const mine = await http()
        .get(`/api/bookings/${old.id}`)
        .set(bearer(a))
        .expect(200);
      expect(mine.body.status).toBe('EXPIRED');
    });

    it(`giới hạn ${MAX_ACTIVE_HOLDS_PER_USER} đơn đang giữ ghế mỗi người`, async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 8 });
      const user = await registerUser(app);
      for (let i = 0; i < MAX_ACTIVE_HOLDS_PER_USER; i++) {
        await book(user.token, showtimeId, [seatIds[i]]).expect(201);
      }
      const res = await book(user.token, showtimeId, [
        seatIds[MAX_ACTIVE_HOLDS_PER_USER],
      ]).expect(409);
      expect(res.body.code).toBe('TOO_MANY_PENDING_BOOKINGS');
    });
  });

  describe('xem và huỷ đơn', () => {
    it('danh sách đơn chỉ gồm đơn của mình, mới nhất trước, lọc được theo trạng thái', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 4 });
      const a = await registerUser(app, 'a@test.com');
      const b = await registerUser(app, 'b@test.com');
      const first = await createBooking(app, a, showtimeId, [seatIds[0]]);
      const second = await createBooking(app, a, showtimeId, [seatIds[1]]);
      await createBooking(app, b, showtimeId, [seatIds[2]]);
      await http()
        .post(`/api/bookings/${first.id}/cancel`)
        .set(bearer(a))
        .expect(200);

      const all = await http().get('/api/bookings').set(bearer(a)).expect(200);
      expect(all.body.totalElements).toBe(2);
      expect(all.body.content.map((x: { id: number }) => x.id)).toEqual([
        second.id,
        first.id,
      ]);

      const cancelled = await http()
        .get('/api/bookings')
        .query({ status: 'CANCELLED' })
        .set(bearer(a))
        .expect(200);
      expect(cancelled.body.content.map((x: { id: number }) => x.id)).toEqual([
        first.id,
      ]);

      const paged = await http()
        .get('/api/bookings')
        .query({ size: 1, page: 1 })
        .set(bearer(a))
        .expect(200);
      expect(paged.body).toMatchObject({
        totalElements: 2,
        totalPages: 2,
        page: 1,
      });
      expect(paged.body.content.map((x: { id: number }) => x.id)).toEqual([
        first.id,
      ]);

      await http()
        .get('/api/bookings')
        .query({ status: 'LUNG_TUNG' })
        .set(bearer(a))
        .expect(400);
    });

    it('lọc theo trạng thái EXPIRED gồm cả đơn quá hạn chưa được job dọn', async () => {
      const { showtimeId, seatIds } = await seedShow(ds);
      const user = await registerUser(app);
      const booking = await createBooking(app, user, showtimeId, [seatIds[0]]);
      await ds.query(
        `UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [booking.id],
      );

      const res = await http()
        .get('/api/bookings')
        .query({ status: 'EXPIRED' })
        .set(bearer(user))
        .expect(200);
      expect(res.body.content.map((x: { id: number }) => x.id)).toEqual([
        booking.id,
      ]);
      const pending = await http()
        .get('/api/bookings')
        .query({ status: 'PENDING' })
        .set(bearer(user))
        .expect(200);
      expect(pending.body.totalElements).toBe(0);
    });

    it('chỉ chủ đơn hoặc admin xem được chi tiết; người khác nhận 404', async () => {
      const { showtimeId, seatIds } = await seedShow(ds);
      const owner = await registerUser(app, 'owner@test.com');
      const other = await registerUser(app, 'other@test.com');
      const admin = await createAdmin(app, ds);
      const booking = await createBooking(app, owner, showtimeId, [seatIds[0]]);

      await http()
        .get(`/api/bookings/${booking.id}`)
        .set(bearer(owner))
        .expect(200);
      const denied = await http()
        .get(`/api/bookings/${booking.id}`)
        .set(bearer(other))
        .expect(404);
      expect(denied.body.code).toBe('BOOKING_NOT_FOUND');
      const asAdmin = await http()
        .get(`/api/bookings/${booking.id}`)
        .set(bearer(admin))
        .expect(200);
      expect(asAdmin.body.customer).toMatchObject({ email: 'owner@test.com' });
      await http().get('/api/bookings/999999').set(bearer(owner)).expect(404);
    });

    it('huỷ đơn nhả ghế, huỷ lại là idempotent, người khác không huỷ được', async () => {
      const { showtimeId, seatIds } = await seedShow(ds);
      const owner = await registerUser(app, 'owner@test.com');
      const other = await registerUser(app, 'other@test.com');
      const booking = await createBooking(app, owner, showtimeId, [
        seatIds[0],
        seatIds[1],
      ]);

      await http()
        .post(`/api/bookings/${booking.id}/cancel`)
        .set(bearer(other))
        .expect(404);

      const cancelled = await http()
        .post(`/api/bookings/${booking.id}/cancel`)
        .set(bearer(owner))
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(
        cancelled.body.seats.map(
          (s: { reservationStatus: string }) => s.reservationStatus,
        ),
      ).toEqual(['RELEASED', 'RELEASED']);
      const again = await http()
        .post(`/api/bookings/${booking.id}/cancel`)
        .set(bearer(owner))
        .expect(200);
      expect(again.body.status).toBe('CANCELLED');

      // ghế đã trống, người khác đặt được ngay
      await book(other.token, showtimeId, [seatIds[0]]).expect(201);
    });
  });

  describe('job dọn đơn hết hạn', () => {
    it('expireStale chỉ xử lý đơn PENDING đã quá hạn', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 4 });
      const user = await registerUser(app);
      const stale = await createBooking(app, user, showtimeId, [seatIds[0]]);
      const fresh = await createBooking(app, user, showtimeId, [seatIds[1]]);
      const cancelled = await createBooking(app, user, showtimeId, [
        seatIds[2],
      ]);
      await http()
        .post(`/api/bookings/${cancelled.id}/cancel`)
        .set(bearer(user))
        .expect(200);
      await ds.query(
        `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = ANY($1::bigint[])`,
        [[stale.id, cancelled.id]],
      );

      const service = app.get(BookingService);
      expect(await service.expireStale()).toBe(1);
      expect(await service.expireStale()).toBe(0);

      const rows = await ds.query(
        `SELECT id, status FROM bookings ORDER BY id`,
      );
      expect(
        rows.map((r: { id: string; status: string }) => [
          Number(r.id),
          r.status,
        ]),
      ).toEqual([
        [stale.id, 'EXPIRED'],
        [fresh.id, 'PENDING'],
        [cancelled.id, 'CANCELLED'],
      ]);
      const [{ held }] = await ds.query(
        `SELECT count(*)::int AS held FROM booking_seats WHERE reservation_status = 'HELD'`,
      );
      expect(held).toBe(1);
    });
  });
});
