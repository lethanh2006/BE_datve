import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
) {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, ds: app.get(DataSource) };
}

export async function resetDb(ds: DataSource) {
  await ds.query(
    'TRUNCATE payments, booking_seats, bookings, seats, showtimes, events, users RESTART IDENTITY CASCADE',
  );
}

export interface TestUser {
  id: number;
  email: string;
  token: string;
}

export async function registerUser(
  app: NestExpressApplication,
  email = 'user@test.com',
  fullName = 'Người Dùng',
): Promise<TestUser> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', fullName })
    .expect(201);
  return { id: res.body.user.id, email, token: res.body.accessToken };
}

/** Tạo tài khoản rồi nâng lên ADMIN (token phải lấy lại sau khi đổi role). */
export async function createAdmin(
  app: NestExpressApplication,
  ds: DataSource,
  email = 'admin@test.com',
) {
  await registerUser(app, email, 'Quản Trị');
  await ds.query(`UPDATE users SET role = 'ADMIN' WHERE email = $1`, [email]);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'password123' })
    .expect(200);
  return {
    id: res.body.user.id as number,
    email,
    token: res.body.accessToken as string,
  };
}

export const bearer = (user: { token: string }) => ({
  Authorization: `Bearer ${user.token}`,
});

export interface SeededShow {
  eventId: number;
  showtimeId: number;
  seatIds: number[];
}

/** Tạo nhanh 1 sự kiện + 1 suất diễn (mặc định 1 ngày nữa) + ghế A1..An. */
export async function seedShow(
  ds: DataSource,
  opts: {
    seats?: number;
    price?: number;
    startsInHours?: number;
    name?: string;
  } = {},
): Promise<SeededShow> {
  const {
    seats = 5,
    price = 100000,
    startsInHours = 24,
    name = 'Sự kiện thử',
  } = opts;
  const [{ id: eventId }] = await ds.query(
    `INSERT INTO events (name, description, venue, category) VALUES ($1, 'Mô tả', 'Nhà hát', 'Âm nhạc') RETURNING id`,
    [name],
  );
  const [{ id: showtimeId }] = await ds.query(
    `INSERT INTO showtimes (event_id, start_time, end_time)
     VALUES ($1, now() + make_interval(hours => $2::int), now() + make_interval(hours => $2::int + 2))
     RETURNING id`,
    [eventId, startsInHours],
  );
  const rows: { id: string }[] = await ds.query(
    `INSERT INTO seats (showtime_id, seat_code, face_value)
     SELECT $1, 'A' || n, $2 FROM generate_series(1, $3::int) n RETURNING id`,
    [showtimeId, price, seats],
  );
  return {
    eventId: Number(eventId),
    showtimeId: Number(showtimeId),
    seatIds: rows.map((r) => Number(r.id)).sort((a, b) => a - b),
  };
}

/** Đặt vé nhanh qua API, trả về body của đơn. */
export async function createBooking(
  app: NestExpressApplication,
  user: { token: string },
  showtimeId: number,
  seatIds: number[],
) {
  const res = await request(app.getHttpServer())
    .post(`/api/showtimes/${showtimeId}/bookings`)
    .set(bearer(user))
    .send({ seatIds })
    .expect(201);
  return res.body;
}
