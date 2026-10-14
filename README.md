# BE_datve (NestJS)

Backend đặt vé sự kiện, chuyển đổi từ bản Spring Boot (`BE_Java/dat-ve`) sang **NestJS + PostgreSQL**, dùng chung schema với bản Java.

- Xem sự kiện, suất diễn và sơ đồ ghế theo thời gian thực
- Đăng ký / đăng nhập bằng JWT, phân quyền `USER` / `ADMIN`
- Giữ ghế 5 phút, chống đặt trùng ghế khi nhiều người tranh cùng lúc
- Thanh toán có `Idempotency-Key` (cổng thanh toán giả, dễ thay bằng cổng thật)
- Vé điện tử có mã `ticketCode` (nội dung QR, 64-bit ngẫu nhiên) và API soát vé tại cửa
- API quản trị: sự kiện, suất diễn + sinh ghế, danh sách đơn, thống kê doanh thu

## Chạy dự án

Yêu cầu: Node.js 22+, Docker (cho PostgreSQL).

```bash
cp .env.example .env        # sửa DB_PASSWORD, JWT_SECRET (openssl rand -hex 32)
docker compose up -d        # PostgreSQL 18
npm install
npm run migrate             # áp dụng db/migrations/*.sql
npm run seed                # (tuỳ chọn) dữ liệu mẫu + tài khoản admin/khách
npm run start:dev           # http://localhost:8080
```

- Swagger UI: <http://localhost:8080/api/docs> (tắt khi `NODE_ENV=production`)
- Health check: `GET /actuator/health` (giữ đường dẫn giống bản Java)
- Tài khoản mẫu sau `npm run seed`: `admin@datve.local / Admin@12345` và `user@datve.local / User@12345`

### Dùng chung database với bản Java

`npm run migrate` nhận ra bảng `flyway_schema_history` và ghi nhận migration `V1` của Flyway là đã chạy, nên có thể trỏ thẳng vào database cũ của bản Java; chỉ các migration mới (`V2`...) được áp dụng. Các migration mới chỉ **thêm** cột/index nên bản Java vẫn chạy được.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8080` | Cổng HTTP |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USERNAME` `DB_PASSWORD` | xem `.env.example` | Kết nối PostgreSQL |
| `JWT_SECRET` | *(bắt buộc, ≥ 32 ký tự)* | Khoá ký JWT |
| `JWT_EXPIRES_IN_SECONDS` | `86400` | Thời hạn token |
| `CORS_ORIGINS` | `http://localhost:5173` | Các origin của frontend, ngăn cách bằng `,` |
| `TRUST_PROXY` | `false` | Đặt `true` khi chạy sau reverse proxy |
| `THROTTLE_LIMIT` | `300` | Số request/phút/IP (đăng nhập, đăng ký luôn giới hạn 10/phút) |
| `PAYMENT_ALLOW_SIMULATION` | `false` | Cho phép client ép kết quả thanh toán giả (`simulate`), chỉ nên bật khi dev |
| `PAYMENT_MOCK_DELAY_MS` | `400` | Độ trễ giả lập của cổng thanh toán |
| `SCHEDULER_ENABLED` | `true` | Bật job nền dọn đơn hết hạn / giao dịch kẹt |
| `SWAGGER_ENABLED` | bật khi không phải production | Bật/tắt Swagger UI |
| `STATS_TIME_ZONE` | `Asia/Ho_Chi_Minh` | Múi giờ gom doanh thu theo ngày |

## API

Mọi route yêu cầu `Authorization: Bearer <token>` trừ các route đánh dấu **công khai**. Lỗi luôn có dạng `{ "code", "message", "timestamp" }`.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/auth/register` | công khai | Đăng ký, trả token |
| POST | `/api/auth/login` | công khai | Đăng nhập, trả token |
| GET | `/api/auth/me` | đăng nhập | Thông tin tài khoản |
| GET | `/api/events?q=&category=&page=0&size=20` | công khai | Danh sách sự kiện (kèm suất sắp tới và giá thấp nhất) |
| GET | `/api/events/categories` | công khai | Các thể loại đang có |
| GET | `/api/events/:id` | công khai | Chi tiết sự kiện |
| GET | `/api/events/:eventId/showtimes` | công khai | Suất diễn + số ghế còn lại |
| GET | `/api/showtimes/:id` | công khai | Chi tiết suất diễn |
| GET | `/api/showtimes/:showtimeId/seats` | công khai | Ghế + trạng thái `AVAILABLE/HELD/BOOKED` |
| POST | `/api/showtimes/:showtimeId/bookings` | đăng nhập | Giữ ghế 5 phút, body `{"seatIds":[1,2]}` |
| GET | `/api/bookings?status=&page=&size=` | đăng nhập | Đơn của tôi, mới nhất trước |
| GET | `/api/bookings/:id` | chủ đơn / admin | Chi tiết đơn |
| POST | `/api/bookings/:id/cancel` | chủ đơn / admin | Huỷ đơn chưa thanh toán, nhả ghế |
| POST | `/api/bookings/:bookingId/payments` | chủ đơn | Thanh toán, **bắt buộc** header `Idempotency-Key` |
| GET | `/api/bookings/:bookingId/payments` | chủ đơn / admin | Các lần thanh toán của đơn |
| GET | `/api/payments/:id` | chủ đơn / admin | Chi tiết giao dịch |
| POST/PUT/DELETE | `/api/admin/events[/:id]` | ADMIN | Quản lý sự kiện |
| POST | `/api/admin/events/:eventId/showtimes` | ADMIN | Tạo suất diễn, có thể sinh ghế theo khu (`sections`) |
| POST | `/api/admin/showtimes/:id/seats` | ADMIN | Thêm ghế cho suất diễn |
| DELETE | `/api/admin/showtimes/:id` | ADMIN | Xoá suất diễn chưa có đơn |
| GET | `/api/admin/bookings?status=&q=` | ADMIN | Mọi đơn kèm thông tin khách |
| POST | `/api/admin/bookings/check-in` | ADMIN | Soát vé: body `{"ticketCode":"..."}` (mã trong QR), quét lại trả `ALREADY_CHECKED_IN` |
| GET | `/api/admin/stats` | ADMIN | Doanh thu, ghế đã bán, thống kê 14 ngày, top sự kiện |

### Vòng đời đơn đặt vé

```
PENDING ──thanh toán──▶ PAYMENT_PROCESSING ──thành công──▶ CONFIRMED
   │  ▲                        │
   │  └──────── thất bại ──────┘ (còn hạn thì về PENDING, hết hạn thì EXPIRED)
   ├──huỷ──▶ CANCELLED
   └──quá 5 phút──▶ EXPIRED   (ghế được nhả)
```

- Đơn `PENDING` quá hạn được báo là `EXPIRED` ngay khi truy vấn; job nền (30 giây/lần) và lần đặt vé kế tiếp sẽ nhả ghế thật sự.
- Giao dịch kẹt ở `PROCESSING` quá 2 phút (ví dụ server chết giữa chừng) bị job phục hồi đánh dấu `FAILED` để người dùng thử lại.
- Mỗi người giữ tối đa 5 đơn chưa thanh toán và 10 ghế/đơn.

### Chống đặt trùng ghế

1. Khoá các dòng ghế bằng `SELECT ... FOR UPDATE ORDER BY id` (cùng thứ tự nên không deadlock).
2. Kiểm tra ghế còn trống rồi mới tạo đơn, tất cả trong một transaction.
3. Chốt chặn cuối cùng ở DB: unique index `booking_seats_one_active_reservation_per_seat`.

## Docker

```bash
docker compose up -d                       # chỉ PostgreSQL (dev)
JWT_SECRET=$(openssl rand -hex 32) docker compose --profile app up -d --build   # PostgreSQL + API (tự migrate)
```

Image dùng multi-stage, chạy bằng user `node` không phải root, có `HEALTHCHECK` gọi `/actuator/health`. Trong production Swagger mặc định tắt.

## Kiểm thử

```bash
npm test            # unit test
npm run test:e2e    # e2e trên PostgreSQL thật, DB riêng `datve_nest_test`
npm run lint:check   # eslint không tự sửa (dùng trong CI); npm run lint để tự sửa
```

E2E tự tạo và migrate database test (tên phải chứa `test`, đổi bằng `TEST_DB_NAME`), và `TRUNCATE` dữ liệu giữa các test nên **không bao giờ** trỏ vào database thật.

## Cấu trúc

```
src/
  auth/       đăng ký, đăng nhập, JWT guard, phân quyền
  event/ showtime/ seat/   danh mục công khai + API quản trị
  booking/    giữ ghế, đơn của tôi, huỷ, job hết hạn
  payment/    thanh toán idempotent, cổng thanh toán (mock), job phục hồi
  admin/      thống kê
  common/     lỗi chung, phân trang, tiện ích Postgres
db/migrations/   schema (SQL thuần); TypeORM chỉ dùng để kết nối, `synchronize` luôn tắt
scripts/         migrate.js, seed.js
test/            e2e
```

Truy vấn dùng SQL thuần qua TypeORM để giữ nguyên các câu lệnh khoá/kiểm tra của bản Java.
