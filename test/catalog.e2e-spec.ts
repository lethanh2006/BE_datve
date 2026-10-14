import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

describe('Danh mục sự kiện (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, ds } = await createTestApp()));
  beforeEach(() => resetDb(ds));
  afterAll(() => app.close());

  describe('GET /api/events', () => {
    it('sắp theo suất diễn sắp tới gần nhất, sự kiện chưa có suất xuống cuối', async () => {
      await ds.query(
        `INSERT INTO events (name, venue) VALUES ('Chưa có suất', 'X')`,
      );
      await seedShow(ds, { name: 'Xa', startsInHours: 72, price: 300000 });
      await seedShow(ds, { name: 'Gần', startsInHours: 5, price: 150000 });

      const res = await http().get('/api/events').expect(200);

      expect(res.body.content.map((e: { name: string }) => e.name)).toEqual([
        'Gần',
        'Xa',
        'Chưa có suất',
      ]);
      expect(res.body).toMatchObject({
        page: 0,
        size: 20,
        totalElements: 3,
        totalPages: 1,
      });
      expect(res.body.content[0]).toMatchObject({
        minPrice: 150000,
        category: 'Âm nhạc',
      });
      expect(res.body.content[0].nextShowtime).toEqual(expect.any(String));
      expect(res.body.content[2]).toMatchObject({
        nextShowtime: null,
        minPrice: null,
      });
    });

    it('bỏ qua suất diễn đã qua khi tính giá và suất sắp tới', async () => {
      await seedShow(ds, { name: 'Đã diễn', startsInHours: -48, price: 50000 });
      const res = await http().get('/api/events').expect(200);
      expect(res.body.content[0]).toMatchObject({
        nextShowtime: null,
        minPrice: null,
      });
    });

    it('tìm theo từ khoá (tên hoặc địa điểm) và thể loại', async () => {
      await ds.query(`INSERT INTO events (name, venue, category) VALUES
        ('Đêm nhạc Trịnh', 'Nhà hát lớn', 'Âm nhạc'),
        ('Kịch Hamlet', 'Sân khấu 5B', 'Sân khấu'),
        ('Giảm giá 100%', 'Hội trường', 'Hội thảo')`);

      const byName = await http()
        .get('/api/events')
        .query({ q: 'trịnh' })
        .expect(200);
      expect(byName.body.content.map((e: { name: string }) => e.name)).toEqual([
        'Đêm nhạc Trịnh',
      ]);

      const byVenue = await http()
        .get('/api/events')
        .query({ q: 'sân khấu' })
        .expect(200);
      expect(byVenue.body.totalElements).toBe(1);

      const byCategory = await http()
        .get('/api/events')
        .query({ category: 'Hội thảo' })
        .expect(200);
      expect(byCategory.body.content[0].name).toBe('Giảm giá 100%');

      // ký tự % và _ được coi là chữ thường, không phải wildcard
      const percent = await http()
        .get('/api/events')
        .query({ q: '%' })
        .expect(200);
      expect(percent.body.totalElements).toBe(1);
      const underscore = await http()
        .get('/api/events')
        .query({ q: '_' })
        .expect(200);
      expect(underscore.body.totalElements).toBe(0);
    });

    it('phân trang và kiểm tra tham số', async () => {
      await ds.query(
        `INSERT INTO events (name, venue) SELECT 'Sự kiện ' || n, 'V' FROM generate_series(1, 25) n`,
      );

      const p1 = await http()
        .get('/api/events')
        .query({ size: 10 })
        .expect(200);
      expect(p1.body).toMatchObject({
        page: 0,
        size: 10,
        totalElements: 25,
        totalPages: 3,
      });
      expect(p1.body.content).toHaveLength(10);

      const p3 = await http()
        .get('/api/events')
        .query({ size: 10, page: 2 })
        .expect(200);
      expect(p3.body.content).toHaveLength(5);

      const bad = await http()
        .get('/api/events')
        .query({ size: 500 })
        .expect(400);
      expect(bad.body.message).toContain('size tối đa là 50');
      await http().get('/api/events').query({ page: -1 }).expect(400);
    });
  });

  describe('GET /api/events/:id', () => {
    it('trả chi tiết sự kiện', async () => {
      const { eventId } = await seedShow(ds, { price: 120000 });
      const res = await http().get(`/api/events/${eventId}`).expect(200);
      expect(res.body).toMatchObject({
        id: eventId,
        name: 'Sự kiện thử',
        venue: 'Nhà hát',
        minPrice: 120000,
      });
    });

    it('404 khi không tồn tại, 400 khi id sai định dạng', async () => {
      const notFound = await http().get('/api/events/999999').expect(404);
      expect(notFound.body).toMatchObject({ code: 'EVENT_NOT_FOUND' });
      const bad = await http().get('/api/events/abc').expect(400);
      expect(bad.body.code).toBe('INVALID_ID');
      await http().get('/api/events/99999999999999999999').expect(400);
      await http().get('/api/events/0').expect(400);
    });
  });

  it('GET /api/events/categories liệt kê thể loại không trùng, đã sắp xếp', async () => {
    await ds.query(`INSERT INTO events (name, venue, category) VALUES
      ('a', 'v', 'Thể thao'), ('b', 'v', 'Âm nhạc'), ('c', 'v', 'Âm nhạc'), ('d', 'v', NULL)`);
    const res = await http().get('/api/events/categories').expect(200);
    expect(res.body).toEqual(['Âm nhạc', 'Thể thao']);
  });

  describe('suất diễn và ghế', () => {
    it('liệt kê suất diễn kèm số ghế còn lại', async () => {
      const { eventId, showtimeId, seatIds } = await seedShow(ds, {
        seats: 5,
        price: 100000,
      });
      const user = await registerUser(app);

      const before = await http()
        .get(`/api/events/${eventId}/showtimes`)
        .expect(200);
      expect(before.body).toHaveLength(1);
      expect(before.body[0]).toMatchObject({
        id: showtimeId,
        eventId,
        totalSeats: 5,
        availableSeats: 5,
        minPrice: 100000,
      });

      await createBooking(app, user, showtimeId, seatIds.slice(0, 2));
      const after = await http()
        .get(`/api/events/${eventId}/showtimes`)
        .expect(200);
      expect(after.body[0]).toMatchObject({ totalSeats: 5, availableSeats: 3 });
    });

    it('404 khi sự kiện/suất diễn không tồn tại', async () => {
      const e = await http().get('/api/events/999/showtimes').expect(404);
      expect(e.body.code).toBe('EVENT_NOT_FOUND');
      const s = await http().get('/api/showtimes/999/seats').expect(404);
      expect(s.body.code).toBe('SHOWTIME_NOT_FOUND');
      await http().get('/api/showtimes/999').expect(404);
    });

    it('trạng thái ghế: AVAILABLE, HELD, BOOKED', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, {
        seats: 3,
        price: 200000,
      });
      const user = await registerUser(app);
      const booking = await createBooking(app, user, showtimeId, [seatIds[0]]);
      await createBooking(app, user, showtimeId, [seatIds[1]]);
      // đánh dấu đã thanh toán trực tiếp trong DB để test không phụ thuộc module thanh toán
      await ds.query(`UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1`, [
        booking.id,
      ]);
      await ds.query(
        `UPDATE booking_seats SET reservation_status = 'BOOKED' WHERE booking_id = $1`,
        [booking.id],
      );

      const res = await http()
        .get(`/api/showtimes/${showtimeId}/seats`)
        .expect(200);
      expect(
        res.body.map((s: { seatCode: string; status: string }) => [
          s.seatCode,
          s.status,
        ]),
      ).toEqual([
        ['A1', 'BOOKED'],
        ['A2', 'HELD'],
        ['A3', 'AVAILABLE'],
      ]);
      expect(res.body[0]).toMatchObject({
        category: 'STANDARD',
        faceValue: 200000,
      });
    });

    it('ghế của đơn hết hạn hiện là AVAILABLE ngay cả khi job dọn chưa chạy', async () => {
      const { showtimeId, seatIds } = await seedShow(ds, { seats: 2 });
      const user = await registerUser(app);
      const booking = await createBooking(app, user, showtimeId, seatIds);
      await ds.query(
        `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [booking.id],
      );

      const res = await http()
        .get(`/api/showtimes/${showtimeId}/seats`)
        .expect(200);
      expect(
        res.body.every((s: { status: string }) => s.status === 'AVAILABLE'),
      ).toBe(true);
    });
  });

  it('có header bảo mật (helmet) và CORS cho origin của FE', async () => {
    const res = await http()
      .get('/api/events')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-expose-headers']).toContain('Date');
  });

  it('JSON sai cú pháp trả lỗi 400 theo định dạng chung', async () => {
    const res = await http()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ không phải json')
      .expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
