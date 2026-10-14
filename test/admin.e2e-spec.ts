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

describe('Quản trị (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let admin: { id: number; token: string };
  const http = () => request(app.getHttpServer());
  const asAdmin = { get: (u: string) => http().get(u).set(bearer(admin)) };
  const post = (url: string, body: object, who = admin) =>
    http().post(url).set(bearer(who)).send(body);

  const section = {
    category: 'VIP',
    rows: ['a', 'B'],
    seatsPerRow: 3,
    faceValue: 500000,
  };
  const future = (hours: number) =>
    new Date(Date.now() + hours * 3_600_000).toISOString();

  beforeAll(async () => ({ app, ds } = await createTestApp()));
  beforeEach(async () => {
    await resetDb(ds);
    admin = await createAdmin(app, ds);
  });
  afterAll(() => app.close());

  describe('phân quyền', () => {
    it('chỉ ADMIN được dùng API quản trị', async () => {
      const user = await registerUser(app, 'user@test.com');
      const calls = [
        () => http().post('/api/admin/events'),
        () => http().put('/api/admin/events/1'),
        () => http().delete('/api/admin/events/1'),
        () => http().post('/api/admin/events/1/showtimes'),
        () => http().post('/api/admin/showtimes/1/seats'),
        () => http().delete('/api/admin/showtimes/1'),
        () => http().get('/api/admin/bookings'),
        () => http().get('/api/admin/stats'),
      ];
      for (const call of calls) {
        const anonymous = await call().expect(401);
        expect(anonymous.body.code).toBe('UNAUTHORIZED');
        const forbidden = await call().set(bearer(user)).send({}).expect(403);
        expect(forbidden.body.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('sự kiện', () => {
    const payload = {
      name: '  Đêm nhạc Rock  ',
      description: 'Mô tả',
      venue: 'Sân vận động',
      imageUrl: 'https://example.com/a.jpg',
      category: 'Âm nhạc',
    };

    it('tạo, sửa, xoá sự kiện', async () => {
      const created = await post('/api/admin/events', payload).expect(201);
      expect(created.body).toMatchObject({
        name: 'Đêm nhạc Rock',
        venue: 'Sân vận động',
        imageUrl: 'https://example.com/a.jpg',
        category: 'Âm nhạc',
        nextShowtime: null,
        minPrice: null,
      });

      const updated = await http()
        .put(`/api/admin/events/${created.body.id}`)
        .set(bearer(admin))
        .send({
          name: 'Tên mới',
          venue: 'Nơi khác',
          description: '',
          imageUrl: '',
        })
        .expect(200);
      // PUT thay thế toàn bộ: trường để trống bị xoá
      expect(updated.body).toMatchObject({
        name: 'Tên mới',
        venue: 'Nơi khác',
        description: null,
        imageUrl: null,
        category: null,
      });

      await http()
        .delete(`/api/admin/events/${created.body.id}`)
        .set(bearer(admin))
        .expect(204);
      await http().get(`/api/events/${created.body.id}`).expect(404);
    });

    it('kiểm tra dữ liệu và 404', async () => {
      const bad = await post('/api/admin/events', {
        name: '   ',
        venue: '',
        imageUrl: 'javascript:alert(1)',
      }).expect(400);
      expect(bad.body.message).toContain('Tên sự kiện không được để trống');
      expect(bad.body.message).toContain('Địa điểm không được để trống');
      expect(bad.body.message).toContain(
        'Ảnh bìa phải là đường dẫn http(s) hợp lệ',
      );

      await http()
        .put('/api/admin/events/999')
        .set(bearer(admin))
        .send({ name: 'x', venue: 'y' })
        .expect(404);
      await http()
        .delete('/api/admin/events/999')
        .set(bearer(admin))
        .expect(404);
    });

    it('không xoá được sự kiện đã có suất diễn', async () => {
      const { eventId } = await seedShow(ds);
      const res = await http()
        .delete(`/api/admin/events/${eventId}`)
        .set(bearer(admin))
        .expect(409);
      expect(res.body.code).toBe('EVENT_HAS_SHOWTIMES');
    });
  });

  describe('suất diễn', () => {
    let eventId: number;
    beforeEach(async () => {
      const res = await post('/api/admin/events', {
        name: 'Sự kiện',
        venue: 'Nhà hát',
      }).expect(201);
      eventId = res.body.id;
    });

    it('tạo suất diễn kèm sinh ghế theo khu', async () => {
      const res = await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: future(48),
        endTime: future(50),
        sections: [
          section,
          {
            category: 'STANDARD',
            rows: ['C'],
            seatsPerRow: 2,
            faceValue: 200000,
          },
        ],
      }).expect(201);

      expect(res.body).toMatchObject({
        eventId,
        totalSeats: 8,
        availableSeats: 8,
        minPrice: 200000,
      });
      const seats = await http()
        .get(`/api/showtimes/${res.body.id}/seats`)
        .expect(200);
      expect(seats.body.map((s: { seatCode: string }) => s.seatCode)).toEqual([
        'A1',
        'A2',
        'A3',
        'B1',
        'B2',
        'B3',
        'C1',
        'C2',
      ]);
      expect(seats.body[0]).toMatchObject({
        category: 'VIP',
        faceValue: 500000,
        status: 'AVAILABLE',
      });

      // sự kiện giờ có giá và suất sắp tới
      const event = await http().get(`/api/events/${eventId}`).expect(200);
      expect(event.body.minPrice).toBe(200000);
      expect(event.body.nextShowtime).toEqual(expect.any(String));
    });

    it('tạo suất diễn không cần ghế rồi thêm ghế sau; mã ghế trùng bị từ chối', async () => {
      const created = await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: future(10),
        endTime: future(12),
      }).expect(201);
      expect(created.body).toMatchObject({ totalSeats: 0, minPrice: null });

      const added = await post(
        `/api/admin/showtimes/${created.body.id}/seats`,
        { sections: [section] },
      ).expect(201);
      expect(added.body.totalSeats).toBe(6);

      const dup = await post(`/api/admin/showtimes/${created.body.id}/seats`, {
        sections: [{ ...section, rows: ['A'], seatsPerRow: 1 }],
      }).expect(409);
      expect(dup.body.code).toBe('SEAT_CODE_EXISTS');
      const after = await http()
        .get(`/api/showtimes/${created.body.id}`)
        .expect(200);
      expect(after.body.totalSeats).toBe(6);

      await post('/api/admin/showtimes/999/seats', {
        sections: [section],
      }).expect(404);
    });

    it('từ chối giờ không hợp lệ và suất trùng giờ', async () => {
      const noZone = await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: '2030-01-01T10:00:00',
        endTime: '2030-01-01T12:00:00',
      }).expect(400);
      expect(noZone.body.message).toContain('múi giờ');

      const reversed = await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: future(5),
        endTime: future(4),
      }).expect(400);
      expect(reversed.body.code).toBe('INVALID_TIME_RANGE');

      await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: future(20),
        endTime: future(23),
      }).expect(201);
      const overlap = await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: future(22),
        endTime: future(25),
      }).expect(409);
      expect(overlap.body.code).toBe('SHOWTIME_OVERLAP');

      // sự kiện khác thì không bị coi là trùng
      const other = await post('/api/admin/events', {
        name: 'Khác',
        venue: 'V',
      }).expect(201);
      await post(`/api/admin/events/${other.body.id}/showtimes`, {
        startTime: future(22),
        endTime: future(25),
      }).expect(201);

      await post('/api/admin/events/999/showtimes', {
        startTime: future(1),
        endTime: future(2),
      }).expect(404);
    });

    it('từ chối bố cục ghế sai: trùng mã, quá nhiều ghế, tên hàng sai', async () => {
      const times = { startTime: future(60), endTime: future(62) };
      const url = `/api/admin/events/${eventId}/showtimes`;

      const dup = await post(url, {
        ...times,
        sections: [section, { ...section, category: 'X', rows: ['A'] }],
      }).expect(400);
      expect(dup.body.code).toBe('DUPLICATE_SEAT_CODE');

      const rows = Array.from({ length: 26 }, (_, i) =>
        String.fromCharCode(65 + i),
      );
      const tooMany = await post(url, {
        ...times,
        sections: [{ ...section, rows, seatsPerRow: 100 }],
      }).expect(400);
      expect(tooMany.body.code).toBe('TOO_MANY_SEATS');

      const badRow = await post(url, {
        ...times,
        sections: [{ ...section, rows: ['1A'] }],
      }).expect(400);
      expect(badRow.body.message).toContain('Tên hàng ghế');
      const badPrice = await post(url, {
        ...times,
        sections: [{ ...section, faceValue: -1 }],
      }).expect(400);
      expect(badPrice.body.message).toContain('Giá vé không được âm');
      await post(url, {
        ...times,
        sections: [{ ...section, faceValue: 1.234 }],
      }).expect(400);

      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM showtimes`,
      );
      expect(count).toBe(0);
    });

    it('xoá suất diễn chưa có đơn; suất đã có đơn thì giữ lại', async () => {
      const free = await post(`/api/admin/events/${eventId}/showtimes`, {
        startTime: future(30),
        endTime: future(32),
        sections: [section],
      }).expect(201);
      await http()
        .delete(`/api/admin/showtimes/${free.body.id}`)
        .set(bearer(admin))
        .expect(204);
      const [{ seats }] = await ds.query(
        `SELECT count(*)::int AS seats FROM seats`,
      );
      expect(seats).toBe(0);
      await http()
        .delete(`/api/admin/showtimes/${free.body.id}`)
        .set(bearer(admin))
        .expect(404);

      const sold = await seedShow(ds);
      const user = await registerUser(app, 'user@test.com');
      await createBooking(app, user, sold.showtimeId, [sold.seatIds[0]]);
      const res = await http()
        .delete(`/api/admin/showtimes/${sold.showtimeId}`)
        .set(bearer(admin))
        .expect(409);
      expect(res.body.code).toBe('SHOWTIME_HAS_BOOKINGS');
    });
  });

  describe('đơn đặt vé và thống kê', () => {
    async function payFor(token: string, bookingId: number, key: string) {
      await http()
        .post(`/api/bookings/${bookingId}/payments`)
        .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': key })
        .send({})
        .expect(201);
    }

    it('liệt kê mọi đơn kèm thông tin khách, lọc theo trạng thái và khách', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 4 });
      const a = await registerUser(app, 'an@test.com', 'Nguyễn An');
      const b = await registerUser(app, 'binh@test.com', 'Trần Bình');
      const first = await createBooking(app, a, showtimeId, [seatIds[0]]);
      const second = await createBooking(app, b, showtimeId, [seatIds[1]]);
      await payFor(b.token, second.id, 'admin-list-key-01');

      const all = await asAdmin.get('/api/admin/bookings').expect(200);
      expect(all.body.totalElements).toBe(2);
      expect(all.body.content.map((x: { id: number }) => x.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(all.body.content[0].customer).toEqual({
        id: b.id,
        email: 'binh@test.com',
        fullName: 'Trần Bình',
      });

      const confirmed = await asAdmin
        .get('/api/admin/bookings?status=CONFIRMED')
        .expect(200);
      expect(confirmed.body.content.map((x: { id: number }) => x.id)).toEqual([
        second.id,
      ]);
      const byName = await asAdmin
        .get('/api/admin/bookings?q=nguyễn')
        .expect(200);
      expect(byName.body.content.map((x: { id: number }) => x.id)).toEqual([
        first.id,
      ]);
      const byEmail = await asAdmin
        .get('/api/admin/bookings?q=binh@')
        .expect(200);
      expect(byEmail.body.totalElements).toBe(1);
    });

    it('thống kê doanh thu, ghế đã bán, trạng thái đơn và top sự kiện', async () => {
      const big = await seedShow(ds, {
        seats: 4,
        price: 200000,
        name: 'Sự kiện lớn',
      });
      const small = await seedShow(ds, {
        seats: 2,
        price: 50000,
        name: 'Sự kiện nhỏ',
        startsInHours: 48,
      });
      const user = await registerUser(app, 'user@test.com');
      const paidBig = await createBooking(app, user, big.showtimeId, [
        big.seatIds[0],
        big.seatIds[1],
      ]);
      const paidSmall = await createBooking(app, user, small.showtimeId, [
        small.seatIds[0],
      ]);
      await createBooking(app, user, big.showtimeId, [big.seatIds[2]]); // PENDING
      const cancelled = await createBooking(app, user, big.showtimeId, [
        big.seatIds[3],
      ]);
      await http()
        .post(`/api/bookings/${cancelled.id}/cancel`)
        .set(bearer(user))
        .expect(200);
      await payFor(user.token, paidBig.id, 'admin-stats-key-1');
      await payFor(user.token, paidSmall.id, 'admin-stats-key-2');

      const res = await asAdmin.get('/api/admin/stats').expect(200);

      expect(res.body).toMatchObject({
        events: 2,
        upcomingShowtimes: 2,
        users: 2,
        seatsSold: 3,
        revenue: 450000,
        bookingsByStatus: {
          PENDING: 1,
          PAYMENT_PROCESSING: 0,
          CONFIRMED: 2,
          CANCELLED: 1,
          EXPIRED: 0,
        },
      });
      expect(res.body.topEvents).toEqual([
        {
          eventId: big.eventId,
          name: 'Sự kiện lớn',
          seatsSold: 2,
          revenue: 400000,
        },
        {
          eventId: small.eventId,
          name: 'Sự kiện nhỏ',
          seatsSold: 1,
          revenue: 50000,
        },
      ]);
      expect(res.body.daily).toHaveLength(14);
      const today = res.body.daily[13];
      expect(today).toMatchObject({ confirmedBookings: 2, revenue: 450000 });
      expect(
        res.body.daily
          .slice(0, 13)
          .every((d: { revenue: number }) => d.revenue === 0),
      ).toBe(true);
    });
  });
});
