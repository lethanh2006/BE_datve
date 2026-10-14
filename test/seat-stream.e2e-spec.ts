import { NestExpressApplication } from '@nestjs/platform-express';
import * as http from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BookingService } from '../src/booking/booking.service';
import {
  bearer,
  createAdmin,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

interface SseEvent {
  event: string;
  data: string;
}

/** Mở một luồng SSE và gom các sự kiện nhận được. */
function openStream(port: number, path: string) {
  const events: SseEvent[] = [];
  let statusCode = 0;
  let contentType = '';
  let buffer = '';
  const req = http.get({
    host: '127.0.0.1',
    port,
    path,
    headers: { Accept: 'text/event-stream' },
  });
  const ready = new Promise<void>((resolve, reject) => {
    req.on('response', (res) => {
      statusCode = res.statusCode ?? 0;
      contentType = String(res.headers['content-type']);
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
          const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
          events.push({ event, data });
        }
      });
      res.on('error', () => undefined);
      resolve();
    });
    req.on('error', reject);
  });
  return {
    ready,
    events,
    close: () => req.destroy(),
    get statusCode() {
      return statusCode;
    },
    get contentType() {
      return contentType;
    },
    named: (name: string) => events.filter((e) => e.event === name),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Luồng cập nhật ghế SSE (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let port: number;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
    // chờ kết nối LISTEN sẵn sàng (nối bất đồng bộ lúc khởi động)
    await new Promise((r) => setTimeout(r, 300));
  });
  beforeEach(() => resetDb(ds));
  afterAll(() => app.close());

  it('nối thành công: trả text/event-stream và sự kiện ready ngay lập tức', async () => {
    const { showtimeId } = await seedShow(ds);
    const stream = openStream(
      port,
      `/api/showtimes/${showtimeId}/seats/events`,
    );
    await stream.ready;
    await waitFor(() => stream.named('ready').length === 1);
    expect(stream.statusCode).toBe(200);
    expect(stream.contentType).toContain('text/event-stream');
    expect(JSON.parse(stream.named('ready')[0].data)).toEqual({ showtimeId });
    stream.close();
  });

  it('có người giữ ghế, huỷ, thanh toán thì nhận sự kiện seats; suất khác không bị ảnh hưởng', async () => {
    const mine = await seedShow(ds, { seats: 4 });
    const other = await seedShow(ds, {
      seats: 2,
      name: 'Sự kiện khác',
      startsInHours: 48,
    });
    const user = await registerUser(app);

    const watching = openStream(
      port,
      `/api/showtimes/${mine.showtimeId}/seats/events`,
    );
    const unrelated = openStream(
      port,
      `/api/showtimes/${other.showtimeId}/seats/events`,
    );
    await Promise.all([watching.ready, unrelated.ready]);
    await waitFor(
      () =>
        watching.named('ready').length === 1 &&
        unrelated.named('ready').length === 1,
    );

    // giữ ghế
    const booking = await createBooking(app, user, mine.showtimeId, [
      mine.seatIds[0],
    ]);
    await waitFor(() => watching.named('seats').length === 1);
    expect(JSON.parse(watching.named('seats')[0].data)).toEqual({
      showtimeId: mine.showtimeId,
    });

    // thanh toán (HELD -> BOOKED)
    await request(app.getHttpServer())
      .post(`/api/bookings/${booking.id}/payments`)
      .set({
        Authorization: `Bearer ${user.token}`,
        'Idempotency-Key': 'stream-pay-0000001',
      })
      .send({})
      .expect(201);
    await waitFor(() => watching.named('seats').length === 2);

    // huỷ một đơn khác (nhả ghế)
    const second = await createBooking(app, user, mine.showtimeId, [
      mine.seatIds[1],
    ]);
    await waitFor(() => watching.named('seats').length === 3);
    await request(app.getHttpServer())
      .post(`/api/bookings/${second.id}/cancel`)
      .set(bearer(user))
      .expect(200);
    await waitFor(() => watching.named('seats').length === 4);

    expect(unrelated.named('seats')).toHaveLength(0);
    watching.close();
    unrelated.close();
  });

  it('nhiều thay đổi dồn dập được gộp: đặt 3 ghế trong một giao dịch chỉ báo một lần', async () => {
    const show = await seedShow(ds, { seats: 5 });
    const user = await registerUser(app);
    const stream = openStream(
      port,
      `/api/showtimes/${show.showtimeId}/seats/events`,
    );
    await stream.ready;
    await waitFor(() => stream.named('ready').length === 1);

    await createBooking(app, user, show.showtimeId, show.seatIds.slice(0, 3));
    await waitFor(() => stream.named('seats').length >= 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(stream.named('seats')).toHaveLength(1);
    stream.close();
  });

  it('job dọn đơn hết hạn cũng báo cho người đang xem', async () => {
    const show = await seedShow(ds, { seats: 2 });
    const user = await registerUser(app);
    await createBooking(app, user, show.showtimeId, [show.seatIds[0]]);
    const stream = openStream(
      port,
      `/api/showtimes/${show.showtimeId}/seats/events`,
    );
    await stream.ready;
    await waitFor(() => stream.named('ready').length === 1);

    await ds.query(
      `UPDATE bookings SET expires_at = now() - interval '1 minute'`,
    );
    expect(await app.get(BookingService).expireStale()).toBe(1);
    await waitFor(() => stream.named('seats').length === 1);
    stream.close();
  });

  it('admin thêm ghế cho suất diễn thì người đang xem được báo', async () => {
    const show = await seedShow(ds, { seats: 1 });
    const admin = await createAdmin(app, ds);
    const stream = openStream(
      port,
      `/api/showtimes/${show.showtimeId}/seats/events`,
    );
    await stream.ready;
    await waitFor(() => stream.named('ready').length === 1);

    await request(app.getHttpServer())
      .post(`/api/admin/showtimes/${show.showtimeId}/seats`)
      .set(bearer(admin))
      .send({
        sections: [
          { category: 'VIP', rows: ['Z'], seatsPerRow: 2, faceValue: 100000 },
        ],
      })
      .expect(201);
    await waitFor(() => stream.named('seats').length === 1);
    stream.close();
  });

  it('suất diễn không tồn tại trả 404 dạng JSON, id sai trả 400', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/showtimes/999999/seats/events')
      .expect(404);
    expect(missing.body.code).toBe('SHOWTIME_NOT_FOUND');
    await request(app.getHttpServer())
      .get('/api/showtimes/abc/seats/events')
      .expect(400);
  });

  it('tắt server khi còn luồng đang mở vẫn kết thúc nhanh', async () => {
    const extra = await createTestApp();
    await extra.app.listen(0);
    const extraPort = (extra.app.getHttpServer().address() as { port: number })
      .port;
    const show = await seedShow(extra.ds);
    const stream = openStream(
      extraPort,
      `/api/showtimes/${show.showtimeId}/seats/events`,
    );
    await stream.ready;
    await waitFor(() => stream.named('ready').length === 1);

    const started = Date.now();
    await extra.app.close();
    expect(Date.now() - started).toBeLessThan(3000);
    stream.close();
  });
});
