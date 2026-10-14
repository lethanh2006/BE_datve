-- Hoàn tiền: giao dịch có thêm trạng thái REFUNDED và thời điểm hoàn
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
        CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED')),
    ADD COLUMN refunded_at TIMESTAMPTZ;
