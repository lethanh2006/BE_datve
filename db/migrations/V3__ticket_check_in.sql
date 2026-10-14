-- Mã vé (nội dung QR) và thời điểm soát vé tại cửa
ALTER TABLE bookings
    ADD COLUMN ticket_code VARCHAR(32),
    ADD COLUMN checked_in_at TIMESTAMPTZ;

CREATE UNIQUE INDEX bookings_ticket_code_key ON bookings (ticket_code) WHERE ticket_code IS NOT NULL;

-- Đơn đã xác nhận từ trước khi có cột này cũng cần có mã vé
UPDATE bookings
SET ticket_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
WHERE status = 'CONFIRMED' AND ticket_code IS NULL;
