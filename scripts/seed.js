// Tạo dữ liệu mẫu để dev/demo: 1 admin, 1 khách, và vài sự kiện kèm suất diễn + ghế.
// Chạy lại nhiều lần an toàn: tài khoản và sự kiện đã có (theo email/tên) sẽ được bỏ qua.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { hashSync } = require('bcryptjs');

if (process.env.NODE_ENV === 'production') {
  console.error('Không chạy seed trên môi trường production.');
  process.exit(1);
}

const ADMIN = { email: 'admin@datve.local', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345', fullName: 'Quản trị viên', role: 'ADMIN' };
const USER = { email: 'user@datve.local', password: process.env.SEED_USER_PASSWORD || 'User@12345', fullName: 'Nguyễn Văn Khách', role: 'USER' };

const img = (seed) => `https://picsum.photos/seed/${seed}/800/450`;

// basePrice là giá hạng phổ thông; VIP gấp 3, tiết kiệm bằng một nửa
const EVENTS = [
  { name: 'Đêm nhạc Trịnh Công Sơn', category: 'Âm nhạc', venue: 'Nhà hát Hòa Bình, TP.HCM', basePrice: 350000, days: [3, 4, 10], image: img('trinh'),
    description: 'Những ca khúc bất hủ của nhạc sĩ Trịnh Công Sơn qua giọng hát của các nghệ sĩ hàng đầu, cùng dàn nhạc giao hưởng sống.' },
  { name: 'Hà Nội Jazz Night', category: 'Âm nhạc', venue: 'Nhà hát Lớn Hà Nội', basePrice: 450000, days: [5, 12], image: img('jazz'),
    description: 'Một đêm jazz đầy cảm xúc với các nghệ sĩ trong nước và quốc tế, không gian sang trọng giữa lòng thủ đô.' },
  { name: 'Hồ Thiên Nga - Ballet', category: 'Sân khấu', venue: 'Nhà hát Thành phố, TP.HCM', basePrice: 500000, days: [7, 8, 14], image: img('ballet'),
    description: 'Vở ballet kinh điển của Tchaikovsky do đoàn ballet quốc gia trình diễn trên sân khấu lộng lẫy.' },
  { name: 'Kịch nói: Hồn Trương Ba, da hàng thịt', category: 'Sân khấu', venue: 'Nhà hát Kịch Sài Gòn', basePrice: 250000, days: [4, 11], image: img('kich'),
    description: 'Tác phẩm kinh điển của Lưu Quang Vũ được dàn dựng mới với góc nhìn đương đại.' },
  { name: 'Giải Cầu lông Mở rộng 2026', category: 'Thể thao', venue: 'Nhà thi đấu Phú Thọ, TP.HCM', basePrice: 150000, days: [6, 7], image: img('caulong'),
    description: 'Giải đấu quy tụ các tay vợt hàng đầu khu vực, các trận bán kết và chung kết hấp dẫn.' },
  { name: 'Hội thảo Công nghệ AI Việt Nam 2026', category: 'Hội thảo', venue: 'Trung tâm Hội nghị GEM Center', basePrice: 200000, days: [9], image: img('ai'),
    description: 'Một ngày với các diễn giả đến từ các công ty công nghệ, workshop thực hành và kết nối cộng đồng.' },
  { name: 'Lễ hội ẩm thực đường phố', category: 'Lễ hội', venue: 'Công viên Tao Đàn, TP.HCM', basePrice: 80000, days: [2, 3, 9, 10], image: img('amthuc'),
    description: 'Hàng trăm gian hàng ẩm thực ba miền, biểu diễn nhạc sống và khu vui chơi cho cả gia đình.' },
  { name: 'Stand-up Comedy: Cười Xuyên Việt', category: 'Hài kịch', venue: 'Nhà hát Bến Thành, TP.HCM', basePrice: 220000, days: [5, 13], image: img('standup'),
    description: 'Đêm diễn tập hợp những gương mặt stand-up được yêu thích nhất, đảm bảo bạn cười không ngớt.' },
];

// Khu ghế: hàng A-B VIP, C-F tiêu chuẩn, G-H tiết kiệm
const sections = (base) => [
  { category: 'VIP', rows: ['A', 'B'], seatsPerRow: 10, price: base * 3 },
  { category: 'STANDARD', rows: ['C', 'D', 'E', 'F'], seatsPerRow: 12, price: base * 2 },
  { category: 'ECONOMY', rows: ['G', 'H'], seatsPerRow: 14, price: base },
];

(async () => {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'datve_db',
    user: process.env.DB_USERNAME || 'datve_user',
    password: process.env.DB_PASSWORD || 'local_dev_only_12345',
  });
  await client.connect();
  try {
    await client.query('BEGIN');

    for (const u of [ADMIN, USER]) {
      const res = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [u.email, hashSync(u.password, 10), u.fullName, u.role],
      );
      console.log(res.rowCount ? `Đã tạo tài khoản ${u.role}: ${u.email} / ${u.password}` : `Đã có tài khoản ${u.email}, bỏ qua`);
    }

    for (const ev of EVENTS) {
      const exists = await client.query('SELECT 1 FROM events WHERE name = $1', [ev.name]);
      if (exists.rowCount) {
        console.log(`Đã có sự kiện "${ev.name}", bỏ qua`);
        continue;
      }
      const { rows: [{ id: eventId }] } = await client.query(
        `INSERT INTO events (name, description, venue, image_url, category) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ev.name, ev.description, ev.venue, ev.image, ev.category],
      );
      for (const day of ev.days) {
        // 19:30 giờ Việt Nam của ngày hôm nay + day, kéo dài 2 tiếng
        const { rows: [{ id: showtimeId }] } = await client.query(
          `INSERT INTO showtimes (event_id, start_time, end_time)
           SELECT $1, t, t + interval '2 hours'
           FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                         + make_interval(days => $2, hours => 19, mins => 30)) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS t) x
           RETURNING id`,
          [eventId, day],
        );
        for (const sec of sections(ev.basePrice)) {
          await client.query(
            `INSERT INTO seats (showtime_id, seat_code, category, face_value)
             SELECT $1, r || n, $2, $3
             FROM unnest($4::text[]) AS r, generate_series(1, $5::int) AS n`,
            [showtimeId, sec.category, sec.price, sec.rows, sec.seatsPerRow],
          );
        }
      }
      console.log(`Đã tạo sự kiện "${ev.name}" với ${ev.days.length} suất diễn`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
