import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  ChargeRequest,
  ChargeResult,
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../src/payment/gateway/payment-gateway';
import { PaymentService } from '../src/payment/payment.service';
import {
  bearer,
  createAdmin,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
} from './helpers';

/** Cổng thanh toán giả để điều khiển kết quả trong test. */
class FakeGateway implements PaymentGateway {
  readonly name = 'FAKE';
  calls: ChargeRequest[] = [];
  behaviour: (req: ChargeRequest) => Promise<ChargeResult> = () =>
    Promise.resolve<ChargeResult>({
      status: 'SUCCESS',
      providerReference: 'FAKE-1',
    });

  charge(req: ChargeRequest) {
    this.calls.push(req);
    return this.behaviour(req);
  }
}

describe('Thanh toán (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  const gateway = new FakeGateway();
  const http = () => request(app.getHttpServer());
  const pay = (
    token: string,
    bookingId: number,
    key?: string,
    body: object = {},
  ) => {
    const req = http()
      .post(`/api/bookings/${bookingId}/payments`)
      .set({ Authorization: `Bearer ${token}` });
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  beforeAll(async () => {
    ({ app, ds } = await createTestApp((b) =>
      b.overrideProvider(PAYMENT_GATEWAY).useValue(gateway),
    ));
  });
  beforeEach(async () => {
    await resetDb(ds);
    gateway.calls = [];
    gateway.behaviour = () =>
      Promise.resolve<ChargeResult>({
        status: 'SUCCESS',
        providerReference: 'FAKE-1',
      });
  });
  afterAll(() => app.close());

  async function setup(seats = 2, price = 100000) {
    const show = await seedShow(ds, { seats, price });
    const user = await registerUser(app);
    const booking = await createBooking(
      app,
      user,
      show.showtimeId,
      show.seatIds,
    );
    return { ...show, user, booking };
  }

  it('thanh toán thành công: đơn CONFIRMED, ghế BOOKED, số tiền lấy từ đơn', async () => {
    const { user, booking, showtimeId } = await setup(2, 150000);

    // client cố gửi số tiền khác cũng bị bỏ qua
    const res = await pay(user.token, booking.id, 'pay-success-0001', {
      amount: 1,
    }).expect(201);

    expect(res.body).toMatchObject({
      bookingId: booking.id,
      status: 'SUCCESS',
      amount: 300000,
      provider: 'FAKE',
      providerReference: 'FAKE-1',
      bookingStatus: 'CONFIRMED',
    });
    expect(gateway.calls).toEqual([
      expect.objectContaining({
        amount: '300000.00',
        bookingId: String(booking.id),
        idempotencyKey: 'pay-success-0001',
      }),
    ]);

    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    expect(detail.body.status).toBe('CONFIRMED');
    expect(
      detail.body.seats.map(
        (s: { reservationStatus: string }) => s.reservationStatus,
      ),
    ).toEqual(['BOOKED', 'BOOKED']);
    const seats = await http()
      .get(`/api/showtimes/${showtimeId}/seats`)
      .expect(200);
    expect(seats.body.map((s: { status: string }) => s.status)).toEqual([
      'BOOKED',
      'BOOKED',
    ]);
  });

  it('bắt buộc có Idempotency-Key hợp lệ', async () => {
    const { user, booking } = await setup();
    const missing = await pay(user.token, booking.id).expect(400);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const bad = await pay(user.token, booking.id, 'ngan').expect(400);
    expect(bad.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(gateway.calls).toHaveLength(0);
  });

  it('gọi lại cùng Idempotency-Key trả kết quả cũ và không trừ tiền lần nữa', async () => {
    const { user, booking } = await setup();
    const first = await pay(user.token, booking.id, 'pay-replay-0001').expect(
      201,
    );
    const again = await pay(user.token, booking.id, 'pay-replay-0001').expect(
      200,
    );

    expect(again.body).toEqual(first.body);
    expect(gateway.calls).toHaveLength(1);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM payments`,
    );
    expect(count).toBe(1);
  });

  it('hai request song song cùng key chỉ tạo một giao dịch', async () => {
    const { user, booking } = await setup();
    gateway.behaviour = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { status: 'SUCCESS', providerReference: 'FAKE-SLOW' };
    };

    const results = await Promise.all([
      pay(user.token, booking.id, 'pay-parallel-001'),
      pay(user.token, booking.id, 'pay-parallel-001'),
      pay(user.token, booking.id, 'pay-parallel-001'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(gateway.calls).toHaveLength(1);
  });

  it('không dùng chung một key cho hai đơn khác nhau', async () => {
    const show = await seedShow(ds, { seats: 4 });
    const user = await registerUser(app);
    const first = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);
    const second = await createBooking(app, user, show.showtimeId, [
      show.seatIds[1],
    ]);
    await pay(user.token, first.id, 'pay-shared-key-1').expect(201);

    const res = await pay(user.token, second.id, 'pay-shared-key-1').expect(
      409,
    );
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('người khác không thanh toán hay xem được giao dịch của đơn', async () => {
    const { user, booking } = await setup();
    const other = await registerUser(app, 'other@test.com');
    const res = await pay(other.token, booking.id, 'pay-intruder-001').expect(
      404,
    );
    expect(res.body.code).toBe('BOOKING_NOT_FOUND');

    const paid = await pay(user.token, booking.id, 'pay-owner-000001').expect(
      201,
    );
    await http()
      .get(`/api/payments/${paid.body.id}`)
      .set(bearer(other))
      .expect(404);
    await http()
      .get(`/api/bookings/${booking.id}/payments`)
      .set(bearer(other))
      .expect(404);
    await http()
      .get(`/api/payments/${paid.body.id}`)
      .set(bearer(user))
      .expect(200);
    const admin = await createAdmin(app, ds);
    await http()
      .get(`/api/payments/${paid.body.id}`)
      .set(bearer(admin))
      .expect(200);

    const list = await http()
      .get(`/api/bookings/${booking.id}/payments`)
      .set(bearer(user))
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('cổng thanh toán báo lỗi: payment FAILED, đơn PENDING, retry với key mới thành công', async () => {
    const { user, booking } = await setup();
    gateway.behaviour = () =>
      Promise.resolve<ChargeResult>({
        status: 'FAILED',
        providerReference: null,
      });
    const failed = await pay(
      user.token,
      booking.id,
      'pay-declined-0001',
    ).expect(201);
    expect(failed.body).toMatchObject({
      status: 'FAILED',
      bookingStatus: 'PENDING',
    });

    // gọi lại cùng key vẫn trả kết quả thất bại cũ
    const replay = await pay(
      user.token,
      booking.id,
      'pay-declined-0001',
    ).expect(200);
    expect(replay.body.status).toBe('FAILED');
    expect(gateway.calls).toHaveLength(1);

    gateway.behaviour = () =>
      Promise.resolve<ChargeResult>({
        status: 'SUCCESS',
        providerReference: 'FAKE-2',
      });
    const retry = await pay(user.token, booking.id, 'pay-declined-0002').expect(
      201,
    );
    expect(retry.body).toMatchObject({
      status: 'SUCCESS',
      bookingStatus: 'CONFIRMED',
    });

    const list = await http()
      .get(`/api/bookings/${booking.id}/payments`)
      .set(bearer(user))
      .expect(200);
    expect(list.body.map((p: { status: string }) => p.status)).toEqual([
      'SUCCESS',
      'FAILED',
    ]);
  });

  it('cổng thanh toán ném lỗi được coi là thất bại, ghế vẫn được giữ', async () => {
    const { user, booking, showtimeId } = await setup();
    gateway.behaviour = () => Promise.reject(new Error('gateway timeout'));
    const res = await pay(user.token, booking.id, 'pay-exception-001').expect(
      201,
    );
    expect(res.body).toMatchObject({
      status: 'FAILED',
      bookingStatus: 'PENDING',
    });
    const seats = await http()
      .get(`/api/showtimes/${showtimeId}/seats`)
      .expect(200);
    expect(seats.body.map((s: { status: string }) => s.status)).toEqual([
      'HELD',
      'HELD',
    ]);
  });

  it('không thanh toán lại đơn đã trả tiền, đã huỷ hoặc đã hết hạn', async () => {
    const { user, booking } = await setup();
    await pay(user.token, booking.id, 'pay-first-000001').expect(201);
    const paidAgain = await pay(
      user.token,
      booking.id,
      'pay-second-00001',
    ).expect(409);
    expect(paidAgain.body.code).toBe('BOOKING_ALREADY_PAID');
    const cancel = await http()
      .post(`/api/bookings/${booking.id}/cancel`)
      .set(bearer(user))
      .expect(409);
    expect(cancel.body.code).toBe('INVALID_BOOKING_STATE');

    const show = await seedShow(ds, { seats: 3, startsInHours: 30 });
    const cancelled = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);
    await http()
      .post(`/api/bookings/${cancelled.id}/cancel`)
      .set(bearer(user))
      .expect(200);
    const onCancelled = await pay(
      user.token,
      cancelled.id,
      'pay-cancelled-001',
    ).expect(409);
    expect(onCancelled.body.code).toBe('BOOKING_CANCELLED');

    const stale = await createBooking(app, user, show.showtimeId, [
      show.seatIds[1],
    ]);
    await ds.query(
      `UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [stale.id],
    );
    const onStale = await pay(user.token, stale.id, 'pay-expired-00001').expect(
      409,
    );
    expect(onStale.body.code).toBe('BOOKING_EXPIRED');
    expect(gateway.calls).toHaveLength(1);
  });

  it('đơn hết hạn trong lúc đang thanh toán: lỗi thì nhả ghế, thành công thì vẫn xác nhận', async () => {
    const { user, booking, showtimeId } = await setup();
    gateway.behaviour = async () => {
      await ds.query(
        `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [booking.id],
      );
      return { status: 'FAILED', providerReference: null };
    };
    const failed = await pay(
      user.token,
      booking.id,
      'pay-late-fail-001',
    ).expect(201);
    expect(failed.body).toMatchObject({
      status: 'FAILED',
      bookingStatus: 'EXPIRED',
    });
    const seats = await http()
      .get(`/api/showtimes/${showtimeId}/seats`)
      .expect(200);
    expect(
      seats.body.every((s: { status: string }) => s.status === 'AVAILABLE'),
    ).toBe(true);

    const show = await seedShow(ds, { seats: 1, startsInHours: 40 });
    const next = await createBooking(app, user, show.showtimeId, show.seatIds);
    gateway.behaviour = async () => {
      await ds.query(
        `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [next.id],
      );
      return { status: 'SUCCESS', providerReference: 'FAKE-LATE' };
    };
    const ok = await pay(user.token, next.id, 'pay-late-ok-0001').expect(201);
    expect(ok.body).toMatchObject({
      status: 'SUCCESS',
      bookingStatus: 'CONFIRMED',
    });
  });

  it('đơn đang thanh toán không bị job dọn hết hạn và không huỷ được', async () => {
    const { user, booking, showtimeId } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    gateway.behaviour = async () => {
      await gate;
      return { status: 'SUCCESS', providerReference: 'FAKE-GATE' };
    };

    const inFlight = pay(user.token, booking.id, 'pay-inflight-0001').then(
      (r) => r,
    );
    await waitFor(async () => {
      const [b] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [
        booking.id,
      ]);
      return b.status === 'PAYMENT_PROCESSING';
    });
    await ds.query(
      `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [booking.id],
    );

    const cancel = await http()
      .post(`/api/bookings/${booking.id}/cancel`)
      .set(bearer(user))
      .expect(409);
    expect(cancel.body.message).toContain('đang được thanh toán');
    const other = await pay(user.token, booking.id, 'pay-inflight-0002').expect(
      409,
    );
    expect(other.body.code).toBe('PAYMENT_IN_PROGRESS');
    const seats = await http()
      .get(`/api/showtimes/${showtimeId}/seats`)
      .expect(200);
    expect(seats.body.map((s: { status: string }) => s.status)).toEqual([
      'HELD',
      'HELD',
    ]);

    release();
    const done = await inFlight;
    expect(done.status).toBe(201);
    expect(done.body.bookingStatus).toBe('CONFIRMED');
  });

  it('job phục hồi: giao dịch kẹt ở PROCESSING bị đánh dấu thất bại để thử lại được', async () => {
    const { user, booking } = await setup();
    await ds.query(
      `UPDATE bookings SET status = 'PAYMENT_PROCESSING' WHERE id = $1`,
      [booking.id],
    );
    await ds.query(
      `INSERT INTO payments (booking_id, idempotency_key, provider, status, amount, updated_at)
       VALUES ($1, 'stuck-key-0001', 'FAKE', 'PROCESSING', 200000, now() - interval '10 minutes')`,
      [booking.id],
    );
    // giao dịch mới nhất chưa đủ lâu thì chưa bị đụng tới
    await ds.query(
      `INSERT INTO payments (booking_id, idempotency_key, provider, status, amount)
       VALUES ($1, 'recent-key-0001', 'FAKE', 'PROCESSING', 200000)`,
      [booking.id],
    );

    expect(await app.get(PaymentService).recoverStuck()).toBe(1);

    const rows = await ds.query(
      `SELECT idempotency_key, status FROM payments ORDER BY id`,
    );
    expect(rows).toEqual([
      { idempotency_key: 'stuck-key-0001', status: 'FAILED' },
      { idempotency_key: 'recent-key-0001', status: 'PROCESSING' },
    ]);
    const [{ status }] = await ds.query(
      `SELECT status FROM bookings WHERE id = $1`,
      [booking.id],
    );
    expect(status).toBe('PENDING');

    await ds.query(
      `UPDATE payments SET status = 'FAILED' WHERE idempotency_key = 'recent-key-0001'`,
    );
    const retry = await pay(
      user.token,
      booking.id,
      'pay-after-stuck-01',
    ).expect(201);
    expect(retry.body.status).toBe('SUCCESS');
  });
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 3000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs)
      throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 20));
  }
}
