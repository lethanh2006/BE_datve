import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
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

/** Cổng thanh toán giả ghi lại các lần gọi hoàn tiền. */
class FakeGateway implements PaymentGateway {
  readonly name = 'FAKE';
  refunds: RefundRequest[] = [];
  refundBehaviour: () => Promise<RefundResult> = () =>
    Promise.resolve({ status: 'SUCCESS', providerReference: 'FAKE-REFUND-1' });

  charge(): Promise<ChargeResult> {
    return Promise.resolve({
      status: 'SUCCESS',
      providerReference: 'FAKE-CHARGE-1',
    });
  }

  refund(request: RefundRequest): Promise<RefundResult> {
    this.refunds.push(request);
    return this.refundBehaviour();
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Hoàn vé (e2e)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let mail: MailService;
  const gateway = new FakeGateway();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, ds } = await createTestApp((b) =>
      b.overrideProvider(PAYMENT_GATEWAY).useValue(gateway),
    ));
    mail = app.get(MailService);
  });
  beforeEach(async () => {
    await resetDb(ds);
    gateway.refunds = [];
    gateway.refundBehaviour = () =>
      Promise.resolve({
        status: 'SUCCESS',
        providerReference: 'FAKE-REFUND-1',
      });
    mail.outbox.length = 0;
  });
  afterAll(() => app.close());

  const refund = (user: TestUser, bookingId: number, body: object = {}) =>
    http()
      .post(`/api/bookings/${bookingId}/refund`)
      .set(bearer(user))
      .send(body);

  /** Đặt và thanh toán 1 đơn; mặc định suất diễn còn 3 ngày nữa nên nằm ngoài thời hạn không hoàn (24 giờ). */
  async function paidBooking(
    opts: { startsInHours?: number; seats?: number } = {},
  ) {
    const show = await seedShow(ds, {
      seats: 4,
      price: 200000,
      startsInHours: opts.startsInHours ?? 72,
    });
    const user = await registerUser(app, 'khach@test.com', 'Khách Hàng');
    const seatIds = show.seatIds.slice(0, opts.seats ?? 2);
    const booking = await createBooking(app, user, show.showtimeId, seatIds);
    await http()
      .post(`/api/bookings/${booking.id}/payments`)
      .set({
        Authorization: `Bearer ${user.token}`,
        'Idempotency-Key': `refund-key-${booking.id}-001`,
      })
      .send({})
      .expect(201);
    // Email xác nhận vé được gửi bất đồng bộ qua hàng đợi: chờ nó tới rồi mới xoá để không lẫn vào email hoàn tiền
    await waitFor(() => mail.outbox.length === 1);
    mail.outbox.length = 0;
    return { show, user, booking };
  }

  it('đơn đã thanh toán có hạn chót hoàn vé; chưa thanh toán thì không', async () => {
    const show = await seedShow(ds, { seats: 4, startsInHours: 72 });
    const user = await registerUser(app);
    const pending = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);
    expect(pending.refundableUntil).toBeNull();

    const { user: payer, booking } = await paidBooking();
    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(payer))
      .expect(200);
    const startsAt = new Date(detail.body.startTime).getTime();
    expect(new Date(detail.body.refundableUntil).getTime()).toBe(
      startsAt - 24 * 3_600_000,
    );
    expect(detail.body.refundedAt).toBeNull();
  });

  it('hoàn vé: đơn huỷ, ghế trống lại, giao dịch REFUNDED, gửi email', async () => {
    const { show, user, booking } = await paidBooking();

    const res = await refund(user, booking.id).expect(200);

    expect(res.body).toMatchObject({
      id: booking.id,
      status: 'CANCELLED',
      refundableUntil: null,
    });
    expect(res.body.refundedAt).toEqual(expect.any(String));
    expect(
      res.body.seats.map(
        (s: { reservationStatus: string }) => s.reservationStatus,
      ),
    ).toEqual(['RELEASED', 'RELEASED']);
    expect(gateway.refunds).toHaveLength(1);
    expect(gateway.refunds[0]).toMatchObject({
      amount: '400000.00',
      providerReference: 'FAKE-CHARGE-1',
    });

    const payments = await http()
      .get(`/api/bookings/${booking.id}/payments`)
      .set(bearer(user))
      .expect(200);
    expect(payments.body[0].status).toBe('REFUNDED');
    const seats = await http()
      .get(`/api/showtimes/${show.showtimeId}/seats`)
      .expect(200);
    expect(
      seats.body.slice(0, 2).map((s: { status: string }) => s.status),
    ).toEqual(['AVAILABLE', 'AVAILABLE']);

    await waitFor(() => mail.outbox.length === 1);
    expect(mail.outbox[0].subject).toContain('hoàn tiền');
    expect(mail.outbox[0].text).toMatch(/400\.000/);

    // người khác đặt lại được đúng ghế đó
    const other = await registerUser(app, 'khac@test.com');
    await createBooking(app, other, show.showtimeId, [show.seatIds[0]]);
  });

  it('hoàn xong thì không còn tính vào doanh thu và vé không còn vào cửa được', async () => {
    const { user, booking } = await paidBooking();
    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    const admin = await createAdmin(app, ds);

    const before = await http()
      .get('/api/admin/stats')
      .set(bearer(admin))
      .expect(200);
    expect(before.body).toMatchObject({ revenue: 400000, seatsSold: 2 });

    await refund(user, booking.id).expect(200);

    const after = await http()
      .get('/api/admin/stats')
      .set(bearer(admin))
      .expect(200);
    expect(after.body).toMatchObject({ revenue: 0, seatsSold: 0 });
    expect(after.body.bookingsByStatus).toMatchObject({
      CONFIRMED: 0,
      CANCELLED: 1,
    });
    expect(after.body.daily.at(-1)).toMatchObject({
      confirmedBookings: 0,
      revenue: 0,
    });

    const checkIn = await http()
      .post('/api/admin/bookings/check-in')
      .set(bearer(admin))
      .send({ ticketCode: detail.body.ticketCode })
      .expect(409);
    expect(checkIn.body.code).toBe('TICKET_INVALID');
  });

  it('gọi lại khi đã hoàn thì trả kết quả hiện tại, không hoàn tiền lần hai', async () => {
    const { user, booking } = await paidBooking();
    const first = await refund(user, booking.id).expect(200);
    const again = await refund(user, booking.id).expect(200);

    expect(again.body.refundedAt).toBe(first.body.refundedAt);
    expect(gateway.refunds).toHaveLength(1);
  });

  it('hai yêu cầu hoàn đồng thời chỉ gọi cổng thanh toán một lần', async () => {
    const { user, booking } = await paidBooking();
    gateway.refundBehaviour = async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { status: 'SUCCESS', providerReference: 'FAKE-SLOW' };
    };
    const results = await Promise.all([
      refund(user, booking.id),
      refund(user, booking.id),
      refund(user, booking.id),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(gateway.refunds).toHaveLength(1);
  });

  it('cổng thanh toán từ chối hoặc lỗi thì giữ nguyên vé và ghế', async () => {
    const { show, user, booking } = await paidBooking();
    gateway.refundBehaviour = () =>
      Promise.resolve({ status: 'FAILED', providerReference: null });
    const failed = await refund(user, booking.id).expect(409);
    expect(failed.body.code).toBe('REFUND_FAILED');

    gateway.refundBehaviour = () =>
      Promise.reject(new Error('gateway timeout'));
    await refund(user, booking.id).expect(409);

    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    expect(detail.body.status).toBe('CONFIRMED');
    expect(detail.body.refundedAt).toBeNull();
    const seats = await http()
      .get(`/api/showtimes/${show.showtimeId}/seats`)
      .expect(200);
    expect(
      seats.body.slice(0, 2).map((s: { status: string }) => s.status),
    ).toEqual(['BOOKED', 'BOOKED']);

    // sau đó cổng hoạt động lại thì hoàn được
    gateway.refundBehaviour = () =>
      Promise.resolve({ status: 'SUCCESS', providerReference: 'FAKE-OK' });
    await refund(user, booking.id).expect(200);
  });

  it('quá thời hạn hoàn vé: chủ đơn bị từ chối, admin vẫn hoàn được', async () => {
    const { user, booking } = await paidBooking({ startsInHours: 5 });
    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    expect(new Date(detail.body.refundableUntil).getTime()).toBeLessThan(
      Date.now(),
    );

    const denied = await refund(user, booking.id).expect(409);
    expect(denied.body.code).toBe('REFUND_WINDOW_PASSED');
    expect(gateway.refunds).toHaveLength(0);

    const admin = await createAdmin(app, ds);
    const ok = await refund(admin, booking.id).expect(200);
    expect(ok.body.status).toBe('CANCELLED');
  });

  it('không hoàn được vé đã soát, đơn chưa thanh toán, đơn của người khác', async () => {
    const { user, booking } = await paidBooking();
    const other = await registerUser(app, 'khac@test.com');
    const stranger = await refund(other, booking.id).expect(404);
    expect(stranger.body.code).toBe('BOOKING_NOT_FOUND');
    await refund(user, 999999).expect(404);

    const show = await seedShow(ds, { seats: 3, startsInHours: 96 });
    const pending = await createBooking(app, user, show.showtimeId, [
      show.seatIds[0],
    ]);
    const notPaid = await refund(user, pending.id).expect(409);
    expect(notPaid.body.code).toBe('INVALID_BOOKING_STATE');

    await ds.query(`UPDATE bookings SET checked_in_at = now() WHERE id = $1`, [
      booking.id,
    ]);
    const used = await refund(user, booking.id).expect(409);
    expect(used.body.code).toBe('TICKET_USED');
    expect(gateway.refunds).toHaveLength(0);

    const detail = await http()
      .get(`/api/bookings/${booking.id}`)
      .set(bearer(user))
      .expect(200);
    expect(detail.body.refundableUntil).toBeNull();
  });

  it('cần đăng nhập và chặn giá trị simulate lạ', async () => {
    const { user, booking } = await paidBooking();
    await http().post(`/api/bookings/${booking.id}/refund`).expect(401);
    await refund(user, booking.id, { simulate: 'LUNG_TUNG' }).expect(400);
  });
});
