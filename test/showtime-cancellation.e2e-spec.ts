import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ShowtimeCancellationService } from '../src/cancellation/showtime-cancellation.service';
import { MailService } from '../src/mail/mail.service';
import {
  ChargeResult,
  PAYMENT_GATEWAY,
  PaymentGateway,
  RefundRequest,
  RefundResult,
} from '../src/payment/gateway/payment-gateway';
import {
  bearer,
  createAdmin,
  createBooking,
  createTestApp,
  registerUser,
  resetDb,
  seedShow,
  TestUser,
} from './helpers';

/** Cổng thanh toán giả: mỗi lần thu tiền cho mã tham chiếu riêng, hoàn tiền điều khiển được theo từng mã. */
class FakeGateway implements PaymentGateway {
  readonly name = 'FAKE';
  charges = 0;
  chargeGate: Promise<void> | null = null;
  refunds: RefundRequest[] = [];
  failRefundFor = new Set<string>();

  async charge(): Promise<ChargeResult> {
    await this.chargeGate;
    return { status: 'SUCCESS', providerReference: `CHARGE-${++this.charges}` };
  }

  refund(req: RefundRequest): Promise<RefundResult> {
    this.refunds.push(req);
    if (
      req.providerReference &&
      this.failRefundFor.has(req.providerReference)
    ) {
      return Promise.resolve({ status: 'FAILED', providerReference: null });
    }
    return Promise.resolve({
      status: 'SUCCESS',
      providerReference: `REFUND-${this.refunds.length}`,
    });
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs)
      throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Huỷ suất diễn và hoàn tiền hàng loạt (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let mail: MailService;
  let service: ShowtimeCancellationService;
  const gateway = new FakeGateway();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, ds } = await createTestApp((b) =>
      b.overrideProvider(PAYMENT_GATEWAY).useValue(gateway),
    ));
    mail = app.get(MailService);
    service = app.get(ShowtimeCancellationService);
  });
  beforeEach(async () => {
    await resetDb(ds);
    Object.assign(gateway, {
      charges: 0,
      chargeGate: null,
      refunds: [],
      failRefundFor: new Set<string>(),
    });
    mail.outbox.length = 0;
  });
  afterAll(() => app.close());

  const pay = (user: TestUser, bookingId: number) =>
    http()
      .post(`/api/bookings/${bookingId}/payments`)
      .set({
        Authorization: `Bearer ${user.token}`,
        'Idempotency-Key': `cancel-test-${bookingId}-0001`,
      })
      .send({});
  const cancel = (
    admin: TestUser,
    showtimeId: number,
    reason = 'Nghệ sĩ bị ốm',
  ) =>
    http()
      .post(`/api/admin/showtimes/${showtimeId}/cancel`)
      .set(bearer(admin))
      .send({ reason });
  const bookingOf = async (user: TestUser, id: number) =>
    (await http().get(`/api/bookings/${id}`).set(bearer(user)).expect(200))
      .body;

  /** 3 khách: A (2 ghế) và B (1 ghế) đã thanh toán, C đang giữ ghế chưa thanh toán. */
  async function scenario() {
    const show = await seedShow(ds, {
      seats: 6,
      price: 100000,
      startsInHours: 72,
    });
    const admin = await createAdmin(app, ds);
    const a = await registerUser(app, 'a@test.com', 'Nguyễn An');
    const b = await registerUser(app, 'b@test.com', 'Trần Bình');
    const c = await registerUser(app, 'c@test.com', 'Lê Chi');
    const bookingA = await createBooking(app, a, show.showtimeId, [
      show.seatIds[0],
      show.seatIds[1],
    ]);
    const bookingB = await createBooking(app, b, show.showtimeId, [
      show.seatIds[2],
    ]);
    const bookingC = await createBooking(app, c, show.showtimeId, [
      show.seatIds[3],
    ]);
    await pay(a, bookingA.id).expect(201);
    await pay(b, bookingB.id).expect(201);
    await waitFor(() => mail.outbox.length === 2);
    mail.outbox.length = 0;
    return { show, admin, a, b, c, bookingA, bookingB, bookingC };
  }

  it('chỉ ADMIN được huỷ suất diễn và xem tiến độ', async () => {
    const { show, a } = await scenario();
    await http()
      .post(`/api/admin/showtimes/${show.showtimeId}/cancel`)
      .send({ reason: 'abc' })
      .expect(401);
    await cancel(a, show.showtimeId).expect(403);
    await http()
      .get(`/api/admin/showtimes/${show.showtimeId}/cancellation`)
      .set(bearer(a))
      .expect(403);
  });

  it('huỷ suất: ngừng bán, nhả ghế đơn chưa thanh toán, hoàn tiền đơn đã thanh toán và gửi email kèm lý do', async () => {
    const { show, admin, a, b, c, bookingA, bookingB, bookingC } =
      await scenario();

    const res = await cancel(
      admin,
      show.showtimeId,
      '  Nghệ sĩ bị ốm  ',
    ).expect(202);
    expect(res.body).toMatchObject({
      showtimeId: show.showtimeId,
      reason: 'Nghệ sĩ bị ốm',
    });
    await service.sweep();

    // đơn đã thanh toán được hoàn đầy đủ
    for (const [user, booking] of [
      [a, bookingA],
      [b, bookingB],
    ] as const) {
      const detail = await bookingOf(user, booking.id);
      expect(detail).toMatchObject({
        status: 'CANCELLED',
        refundableUntil: null,
        showtimeCancelReason: 'Nghệ sĩ bị ốm',
      });
      expect(detail.refundedAt).toEqual(expect.any(String));
      expect(detail.showtimeCancelledAt).toEqual(expect.any(String));
    }
    expect(gateway.refunds.map((r) => r.amount).sort()).toEqual([
      '100000.00',
      '200000.00',
    ]);
    // đơn chưa thanh toán bị đóng và nhả ghế
    expect((await bookingOf(c, bookingC.id)).status).toBe('CANCELLED');
    const seats = await http()
      .get(`/api/showtimes/${show.showtimeId}/seats`)
      .expect(200);
    expect(
      seats.body.every((s: { status: string }) => s.status === 'AVAILABLE'),
    ).toBe(true);

    // email cho khách đã mua vé (không gửi cho người chỉ giữ chỗ), có lý do
    await waitFor(() => mail.outbox.length === 2);
    expect(mail.outbox.map((m) => m.to).sort()).toEqual([
      'a@test.com',
      'b@test.com',
    ]);
    const toA = mail.outbox.find((m) => m.to === 'a@test.com')!;
    expect(toA.subject).toContain('Suất diễn đã bị huỷ');
    expect(toA.text).toContain('Nghệ sĩ bị ốm');
    expect(toA.text).toMatch(/200\.000/);

    // hiển thị công khai và số liệu
    const showtime = await http()
      .get(`/api/showtimes/${show.showtimeId}`)
      .expect(200);
    expect(showtime.body).toMatchObject({
      availableSeats: 0,
      cancelReason: 'Nghệ sĩ bị ốm',
    });
    expect(showtime.body.cancelledAt).toEqual(expect.any(String));
    const event = await http().get(`/api/events/${show.eventId}`).expect(200);
    expect(event.body).toMatchObject({ nextShowtime: null, minPrice: null });
    const stats = await http()
      .get('/api/admin/stats')
      .set(bearer(admin))
      .expect(200);
    expect(stats.body).toMatchObject({ revenue: 0, seatsSold: 0 });

    const status = await http()
      .get(`/api/admin/showtimes/${show.showtimeId}/cancellation`)
      .set(bearer(admin))
      .expect(200);
    expect(status.body).toMatchObject({
      pendingRefunds: 0,
      refunded: 2,
      checkedIn: 0,
      paymentsInProgress: 0,
      failures: [],
    });
  });

  it('suất đã huỷ không đặt vé hay thanh toán được nữa', async () => {
    const { show, admin, b, bookingB } = await scenario();
    await cancel(admin, show.showtimeId).expect(202);
    await service.sweep();

    const user = await registerUser(app, 'moi@test.com');
    const booking = await http()
      .post(`/api/showtimes/${show.showtimeId}/bookings`)
      .set(bearer(user))
      .send({ seatIds: [show.seatIds[4]] })
      .expect(409);
    expect(booking.body.code).toBe('SHOWTIME_CANCELLED');

    // đơn "lọt lưới" quay về PENDING cũng không trả tiền được
    await ds.query(
      `UPDATE bookings SET status = 'PENDING', expires_at = now() + interval '5 minutes' WHERE id = $1`,
      [bookingB.id],
    );
    const payment = await http()
      .post(`/api/bookings/${bookingB.id}/payments`)
      .set({
        Authorization: `Bearer ${b.token}`,
        'Idempotency-Key': 'stray-payment-0001',
      })
      .send({})
      .expect(409);
    expect(payment.body.code).toBe('SHOWTIME_CANCELLED');
    // và lượt quét kế tiếp đóng nốt đơn đó, nhả ghế
    await service.sweep();
    expect((await bookingOf(b, bookingB.id)).status).toBe('CANCELLED');
  });

  it('hoàn tiền lỗi thì thử lại có giãn cách, báo lỗi cho admin, hết lỗi thì tự hoàn', async () => {
    const { show, admin, a, b, bookingA, bookingB } = await scenario();
    const refB = (
      await ds.query<{ provider_reference: string }[]>(
        `SELECT provider_reference FROM payments WHERE booking_id = $1`,
        [bookingB.id],
      )
    )[0].provider_reference;
    gateway.failRefundFor.add(refB);

    await cancel(admin, show.showtimeId).expect(202);
    await service.sweep();

    expect((await bookingOf(a, bookingA.id)).status).toBe('CANCELLED');
    expect((await bookingOf(b, bookingB.id)).status).toBe('CONFIRMED');
    let status = (
      await http()
        .get(`/api/admin/showtimes/${show.showtimeId}/cancellation`)
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(status).toMatchObject({ pendingRefunds: 1, refunded: 1 });
    expect(status.failures).toEqual([
      {
        bookingId: bookingB.id,
        attempts: 1,
        error: expect.stringContaining('chưa hoàn tiền được'),
      },
    ]);

    // chưa đến hạn thử lại thì lượt quét không gọi lại cổng thanh toán
    const callsBefore = gateway.refunds.length;
    await service.sweep();
    expect(gateway.refunds.length).toBe(callsBefore);
    const [{ wait }] = await ds.query(
      `SELECT extract(epoch FROM refund_retry_at - now())::int AS wait FROM bookings WHERE id = $1`,
      [bookingB.id],
    );
    expect(wait).toBeGreaterThan(30);

    // cổng hoạt động lại và đến hạn thử lại
    gateway.failRefundFor.clear();
    await ds.query(
      `UPDATE bookings SET refund_retry_at = now() WHERE id = $1`,
      [bookingB.id],
    );
    await service.sweep();
    expect((await bookingOf(b, bookingB.id)).status).toBe('CANCELLED');
    status = (
      await http()
        .get(`/api/admin/showtimes/${show.showtimeId}/cancellation`)
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(status).toMatchObject({
      pendingRefunds: 0,
      refunded: 2,
      failures: [],
    });
    await waitFor(() => mail.outbox.length === 2);
  });

  it('gọi huỷ lại và quét song song không hoàn tiền hay gửi email trùng', async () => {
    const { show, admin } = await scenario();
    const [first, second] = await Promise.all([
      cancel(admin, show.showtimeId),
      cancel(admin, show.showtimeId, 'Lý do khác'),
    ]);
    expect([first.status, second.status]).toEqual([202, 202]);
    await Promise.all([service.sweep(), service.sweep()]);
    await service.sweep();
    await cancel(admin, show.showtimeId).expect(202);
    await service.sweep();

    expect(gateway.refunds).toHaveLength(2);
    await waitFor(() => mail.outbox.length >= 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(mail.outbox).toHaveLength(2);
    // lý do của lần huỷ đầu tiên được giữ nguyên
    const [{ cancel_reason }] = await ds.query(
      `SELECT cancel_reason FROM showtimes WHERE id = $1`,
      [show.showtimeId],
    );
    expect(['Nghệ sĩ bị ốm', 'Lý do khác']).toContain(cancel_reason);
  });

  it('vé đã soát không tự hoàn mà được thống kê để xử lý thủ công', async () => {
    const { show, admin, a, bookingA, bookingB, b } = await scenario();
    await ds.query(`UPDATE bookings SET checked_in_at = now() WHERE id = $1`, [
      bookingA.id,
    ]);
    await cancel(admin, show.showtimeId).expect(202);
    await service.sweep();

    expect((await bookingOf(a, bookingA.id)).status).toBe('CONFIRMED');
    expect((await bookingOf(b, bookingB.id)).status).toBe('CANCELLED');
    const status = (
      await http()
        .get(`/api/admin/showtimes/${show.showtimeId}/cancellation`)
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(status).toMatchObject({
      checkedIn: 1,
      pendingRefunds: 0,
      refunded: 1,
    });
  });

  it('đơn đang thanh toán dở lúc huỷ vẫn được hoàn tự động khi thanh toán xong', async () => {
    const show = await seedShow(ds, { seats: 3, startsInHours: 72 });
    const admin = await createAdmin(app, ds);
    const user = await registerUser(app, 'a@test.com', 'Nguyễn An');
    const booking = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);

    let release!: () => void;
    gateway.chargeGate = new Promise<void>((r) => (release = r));
    const paying = pay(user, booking.id).then((r) => r);
    await waitFor(
      async () =>
        (
          await ds.query(
            `SELECT 1 FROM bookings WHERE id = $1 AND status = 'PAYMENT_PROCESSING'`,
            [booking.id],
          )
        ).length > 0,
    );

    const res = await cancel(admin, show.showtimeId).expect(202);
    expect(res.body.paymentsInProgress).toBe(1);
    await service.sweep();
    expect(gateway.refunds).toHaveLength(0); // chưa thu tiền xong nên chưa có gì để hoàn

    release();
    expect((await paying).status).toBe(201);
    await service.sweep();
    expect((await bookingOf(user, booking.id)).status).toBe('CANCELLED');
    expect(gateway.refunds).toHaveLength(1);
  });

  it('kiểm tra đầu vào: lý do, suất không tồn tại, suất đã kết thúc, chưa huỷ thì không có tiến độ', async () => {
    const admin = await createAdmin(app, ds);
    const show = await seedShow(ds, { seats: 2, startsInHours: 72 });
    const tooShort = await cancel(admin, show.showtimeId, 'ab').expect(400);
    expect(tooShort.body.message).toContain('Lý do huỷ tối thiểu 3 ký tự');
    await http()
      .post(`/api/admin/showtimes/${show.showtimeId}/cancel`)
      .set(bearer(admin))
      .send({})
      .expect(400);
    await cancel(admin, 999999).expect(404);

    const past = await seedShow(ds, {
      seats: 2,
      startsInHours: -5,
      name: 'Đã diễn',
    });
    const ended = await cancel(admin, past.showtimeId).expect(409);
    expect(ended.body.code).toBe('SHOWTIME_ENDED');

    const status = await http()
      .get(`/api/admin/showtimes/${show.showtimeId}/cancellation`)
      .set(bearer(admin))
      .expect(404);
    expect(status.body.code).toBe('SHOWTIME_NOT_CANCELLED');
    await http()
      .get('/api/admin/showtimes/999999/cancellation')
      .set(bearer(admin))
      .expect(404);
  });

  it('suất đã huỷ có đơn thì không xoá được', async () => {
    const { show, admin } = await scenario();
    await cancel(admin, show.showtimeId).expect(202);
    await service.sweep();
    const res = await http()
      .delete(`/api/admin/showtimes/${show.showtimeId}`)
      .set(bearer(admin))
      .expect(409);
    expect(res.body.code).toBe('SHOWTIME_HAS_BOOKINGS');
  });

  it('huỷ đúng lúc có người đang giữ ghế: đơn mới hoặc bị từ chối hoặc được quét đóng, không bao giờ kẹt ghế', async () => {
    const show = await seedShow(ds, { seats: 8, startsInHours: 72 });
    const admin = await createAdmin(app, ds);
    const users = await Promise.all(
      Array.from({ length: 6 }, (_, i) => registerUser(app, `u${i}@test.com`)),
    );

    const [, ...results] = await Promise.all([
      cancel(admin, show.showtimeId),
      ...users.map((u, i) =>
        http()
          .post(`/api/showtimes/${show.showtimeId}/bookings`)
          .set(bearer(u))
          .send({ seatIds: [show.seatIds[i]] }),
      ),
    ]);
    expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);

    await service.sweep();
    const [{ held }] = await ds.query(
      `SELECT count(*)::int AS held FROM booking_seats WHERE reservation_status = 'HELD'`,
    );
    expect(held).toBe(0);
    const [{ open }] = await ds.query(
      `SELECT count(*)::int AS open FROM bookings WHERE status IN ('PENDING', 'PAYMENT_PROCESSING')`,
    );
    expect(open).toBe(0);
  });
});
