-- Bảo mật tài khoản
--  * token_version: tăng lên khi đổi/đặt lại mật khẩu để thu hồi mọi phiên đăng nhập cũ
--  * disabled_at: khoá tài khoản
--  * password_reset_tokens: mã đặt lại mật khẩu (chỉ lưu băm SHA-256, dùng một lần, có hạn)
ALTER TABLE users
    ADD COLUMN token_version INT NOT NULL DEFAULT 0,
    ADD COLUMN disabled_at TIMESTAMPTZ;

CREATE TABLE password_reset_tokens (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
