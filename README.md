# BE_datve (NestJS)

Backend đặt vé sự kiện, chuyển đổi từ bản Spring Boot (`BE_Java/dat-ve`) sang **NestJS + PostgreSQL**, dùng chung schema với bản Java.

- Xem sự kiện, suất diễn và sơ đồ ghế theo thời gian thực
- Đăng ký / đăng nhập bằng JWT, phân quyền `USER` / `ADMIN`
- Hồ sơ cá nhân, đổi mật khẩu, khôi phục mật khẩu qua email; thu hồi các phiên cũ ngay khi đổi/đặt lại mật khẩu
- Giữ ghế 5 phút, chống đặt trùng ghế khi nhiều người tranh cùng lúc
- Thanh toán có `Idempotency-Key` (cổng thanh toán giả, dễ thay bằng cổng thật)
- Hoàn vé trong thời hạn cho phép, trả ghế, cập nhật doanh thu; email xác nhận vé và hoàn tiền
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

`npm run migrate` nhận ra bảng `flyway_schema_history` và ghi nhận migration `V1` của Flyway là đã chạy, nên có thể trỏ vào database cũ của bản Java; chỉ các migration mới (`V2`...) được áp dụng. V4 thêm phiên bản token, trạng thái khoá tài khoản và bảng mã khôi phục; V5 mở rộng trạng thái thanh toán thành `REFUNDED`. Bản Java cần hỗ trợ trạng thái mới trước khi đọc các giao dịch đã hoàn tiền. Luôn chạy migration trước khi khởi động phiên bản API này.

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
| `APP_URL` | `http://localhost:5173` | URL frontend cho liên kết trong email |
| `APP_TIME_ZONE` | `Asia/Ho_Chi_Minh` | Múi giờ hiển thị trong email |
| `SMTP_URL` | trống | Kết nối SMTP, ví dụ `smtps://user:pass@smtp.example.com:465` |
| `MAIL_FROM` | `ĐặtVé <no-reply@datve.local>` | Địa chỉ gửi thư; dùng địa chỉ đã xác minh khi gửi thật |
| `REFUND_WINDOW_HOURS` | `24` | Hạn hoàn vé tính lùi từ giờ diễn; số từ 0 đến 87600 |
| `LOG_REQUESTS` | `true` | Ghi log truy cập mỗi request (không kèm query); response luôn có `X-Request-Id`, client gửi id hợp lệ thì giữ nguyên |
| `SEAT_STREAM_MAX_CLIENTS` | `5000` | Số kết nối SSE theo dõi ghế tối đa mỗi instance, vượt thì trả 503 |

## API

Mọi route yêu cầu `Authorization: Bearer <token>` trừ các route đánh dấu **công khai**. Lỗi luôn có dạng `{ "code", "message", "timestamp" }`.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| POST | `/api/auth/register` | công khai | Đăng ký, trả token |
| POST | `/api/auth/login` | công khai | Đăng nhập, trả token |
| GET | `/api/auth/me` | đăng nhập | Thông tin tài khoản |
| PUT | `/api/auth/me` | đăng nhập | Đổi họ tên: `{"fullName":"Tên mới"}` |
| PUT | `/api/auth/password` | đăng nhập | `{"currentPassword":"...","newPassword":"..."}`, trả JWT mới, thu hồi phiên và mã khôi phục cũ |
| POST | `/api/auth/forgot-password` | công khai | `{"email":"..."}`, luôn trả 202 với thông báo chung |
| POST | `/api/auth/reset-password` | công khai | `{"token":"...","password":"..."}`, thành công trả 204 |
| GET | `/api/events?q=&category=&page=0&size=20` | công khai | Danh sách sự kiện (kèm suất sắp tới và giá thấp nhất) |
| GET | `/api/events/categories` | công khai | Các thể loại đang có |
| GET | `/api/events/:id` | công khai | Chi tiết sự kiện |
| GET | `/api/events/:eventId/showtimes` | công khai | Suất diễn + số ghế còn lại |
| GET | `/api/showtimes/:id` | công khai | Chi tiết suất diễn |
| GET | `/api/showtimes/:showtimeId/seats` | công khai | Ghế + trạng thái `AVAILABLE/HELD/BOOKED` |
| GET | `/api/showtimes/:showtimeId/seats/events` | công khai | **SSE**: sự kiện `ready` khi nối, `seats` mỗi khi ghế của suất đổi, `ping` mỗi 25 giây. Client nhận `seats` thì gọi lại API danh sách ghế |
| POST | `/api/showtimes/:showtimeId/bookings` | đăng nhập | Giữ ghế 5 phút, body `{"seatIds":[1,2]}` |
| GET | `/api/bookings?status=&page=&size=` | đăng nhập | Đơn của tôi, mới nhất trước |
| GET | `/api/bookings/:id` | chủ đơn / admin | Chi tiết đơn |
| POST | `/api/bookings/:id/cancel` | chủ đơn / admin | Huỷ đơn chưa thanh toán, nhả ghế |
| POST | `/api/bookings/:bookingId/payments` | chủ đơn | Thanh toán, **bắt buộc** header `Idempotency-Key` |
| POST | `/api/bookings/:bookingId/refund` | chủ đơn / admin | Body `{}`, huỷ vé đã thanh toán và hoàn toàn bộ tiền; trả đơn đã cập nhật |
| GET | `/api/bookings/:bookingId/payments` | chủ đơn / admin | Các lần thanh toán của đơn |
| GET | `/api/payments/:id` | chủ đơn / admin | Chi tiết giao dịch |
| POST/PUT/DELETE | `/api/admin/events[/:id]` | ADMIN | Quản lý sự kiện |
| POST | `/api/admin/events/:eventId/showtimes` | ADMIN | Tạo suất diễn, có thể sinh ghế theo khu (`sections`) |
| POST | `/api/admin/showtimes/:id/seats` | ADMIN | Thêm ghế cho suất diễn |
| DELETE | `/api/admin/showtimes/:id` | ADMIN | Xoá suất diễn chưa có đơn |
| GET | `/api/admin/bookings?status=&q=` | ADMIN | Mọi đơn kèm thông tin khách |
| POST | `/api/admin/bookings/check-in` | ADMIN | Soát vé: body `{"ticketCode":"..."}` (mã trong QR), quét lại trả `ALREADY_CHECKED_IN` |
| GET | `/api/admin/users?q=&role=&status=` | ADMIN | Người dùng kèm số đơn đã xác nhận và tổng chi tiêu |
| PUT | `/api/admin/users/:id/role` | ADMIN | `{"role":"USER"\|"ADMIN"}`, có hiệu lực ngay với token đang dùng |
| PUT | `/api/admin/users/:id/status` | ADMIN | `{"disabled":true}` khoá tài khoản và thu hồi phiên; không tự khoá/đổi quyền chính mình, luôn còn ít nhất một admin |
| GET | `/api/admin/stats` | ADMIN | Doanh thu, ghế đã bán, thống kê 14 ngày, top sự kiện |

### Cập nhật ghế thời gian thực

V6 đặt trigger trên `booking_seats` và `seats` gọi `pg_notify('seat_changes', <showtime_id>)`. Mỗi tiến trình API giữ một kết nối `LISTEN` và đẩy sự kiện tới các client SSE của đúng suất diễn (gộp các thay đổi dồn dập trong 150 ms). Vì nguồn là DB nên mọi thay đổi đều được báo: request của người dùng, job dọn hết hạn, hay một instance API khác. Mất kết nối DB thì tự nối lại và báo client tải lại. Reverse proxy phải tắt buffering cho đường dẫn này (xem nginx của frontend).

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

### Tài khoản và email

- Mật khẩu mới tối thiểu 8 ký tự, tối đa **72 byte UTF-8** để bcrypt không âm thầm cắt mật khẩu có dấu.
- Đổi/đặt lại mật khẩu tăng `token_version`. Guard kiểm tra phiên bản, vai trò và trạng thái khoá từ DB trên mỗi request; token cũ bị từ chối ngay.
- Mã khôi phục ngẫu nhiên, có hạn 30 phút, chỉ lưu SHA-256 trong DB và chỉ dùng một lần. Mỗi tài khoản tối đa một email khôi phục/60 giây, kể cả khi gọi đồng thời. Mã mới hoặc đổi mật khẩu làm mất hiệu lực mã cũ.
- Cấu hình `APP_URL`, `SMTP_URL`, `MAIL_FROM` để gửi email thật. Không có SMTP: dev ghi email giả lập ra log, production cảnh báo và bỏ qua gửi thư. Test luôn dùng hộp thư giả để không gửi email ra ngoài.
- Email vé/hoàn tiền chỉ gửi sau giao dịch thành công, gọi lại không gửi trùng. Gửi thư hiện là best-effort trong tiến trình, chưa có hàng đợi bền vững hay tự thử lại khi SMTP lỗi; lỗi thư không làm thất bại đặt vé/hoàn tiền.

### Hoàn vé

- Khách chỉ hoàn đơn `CONFIRMED`, chưa soát vé, trước `refundableUntil` (mặc định 24 giờ trước giờ diễn). Admin được vượt thời hạn nhưng vẫn không được hoàn vé đã soát.
- Thành công: đơn `CANCELLED`, payment `REFUNDED`, ghế `RELEASED`; `refundedAt` có giá trị. Doanh thu và số ghế bán loại trừ đơn đã hoàn. QR cũ không còn vào cửa được.
- Khoá dòng đơn bảo đảm các yêu cầu đồng thời chỉ gọi cổng một lần. Cổng nhận khoá cố định theo payment; khi tích hợp cổng thật cần hỗ trợ idempotency và đối soát kết quả. Cổng từ chối thì giữ nguyên đơn và ghế; gọi lại sau khi đã hoàn trả kết quả cũ.
- Thanh toán và hoàn tiền hiện dùng **mock**, không có giao dịch tiền thật. Email chỉ thông báo trạng thái này, không chứng minh đã tích hợp ngân hàng.

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
  auth/       đăng ký, đăng nhập, hồ sơ, khôi phục mật khẩu, JWT guard, phân quyền
  mail/       mẫu email tiếng Việt, SMTP và hộp thư dev/test
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
