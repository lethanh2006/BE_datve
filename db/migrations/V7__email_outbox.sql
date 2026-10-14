-- Hàng đợi email bền vững: thư được ghi vào DB trước, rồi worker gửi và tự thử lại khi SMTP lỗi.
-- Nội dung thư bị xoá ngay khi gửi xong (thư đặt lại mật khẩu chứa mã dùng một lần, không nên nằm lại trong DB).
CREATE TABLE email_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    to_address VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    CONSTRAINT email_outbox_status_check CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);

CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX email_outbox_created_idx ON email_outbox (created_at DESC);
