-- Huỷ suất diễn: đánh dấu suất bị huỷ (ngừng bán, tự hoàn tiền các đơn đã thanh toán)
ALTER TABLE showtimes
    ADD COLUMN cancelled_at TIMESTAMPTZ,
    ADD COLUMN cancel_reason VARCHAR(500);

-- Theo dõi việc hoàn tiền hàng loạt: số lần thử, lỗi gần nhất và lần thử kế tiếp của từng đơn
ALTER TABLE bookings
    ADD COLUMN refund_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN refund_error TEXT,
    ADD COLUMN refund_retry_at TIMESTAMPTZ;
