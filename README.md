# BE_datve (NestJS)

Backend đặt vé, chuyển đổi từ bản Spring Boot (`BE_Java/dat-ve`) sang NestJS + TypeORM + PostgreSQL.

## Chạy dự án

```bash
cp .env.example .env        # chỉnh thông tin DB nếu cần
docker compose up -d        # PostgreSQL
npm install
npm run migrate             # áp dụng db/migrations/*.sql
npm run start:dev           # http://localhost:8080
```

## API

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/events?page=0&size=20` | Danh sách sự kiện (phân trang) |
| GET | `/api/events/:id` | Chi tiết sự kiện |
| GET | `/api/events/:eventId/showtimes` | Suất diễn của sự kiện |
| GET | `/api/showtimes/:showtimeId/seats` | Ghế + trạng thái (AVAILABLE/HELD/BOOKED) |
| POST | `/api/showtimes/:showtimeId/bookings` | Giữ ghế 5 phút, body `{"seatIds":[1,2]}` |

Lỗi trả về dạng `{ code, message, timestamp }`.

## Ghi chú

- Schema giữ nguyên từ Flyway `V1__init_schema.sql`; `synchronize` của TypeORM luôn tắt.
- Đặt vé dùng transaction + `SELECT ... FOR UPDATE` để chống đặt trùng ghế.
- `userId` tạm cố định bằng 1 (chưa làm JWT, giống bản Java).
