CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
                       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                       email VARCHAR(255) NOT NULL UNIQUE,
                       password_hash VARCHAR(255) NOT NULL,
                       full_name VARCHAR(255) NOT NULL,
                       role VARCHAR(20) NOT NULL DEFAULT 'USER',
                       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                       CONSTRAINT users_role_check CHECK (role IN ('USER', 'ADMIN'))
);

CREATE TABLE events (
                        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        description TEXT,
                        venue VARCHAR(255) NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE showtimes (
                           id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                           event_id BIGINT NOT NULL REFERENCES events(id),
                           start_time TIMESTAMPTZ NOT NULL,
                           end_time TIMESTAMPTZ NOT NULL,
                           created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                           CONSTRAINT showtimes_valid_time_check CHECK (end_time > start_time),
                           CONSTRAINT showtimes_no_overlap
                               EXCLUDE USING gist (
            event_id WITH =,
            tstzrange(start_time, end_time, '[)') WITH &&
        )
);

CREATE TABLE seats (
                       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                       showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
                       seat_code VARCHAR(12) NOT NULL,
                       category VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
                       face_value NUMERIC(12, 2) NOT NULL,
                       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                       CONSTRAINT seats_nonnegative_price_check CHECK (face_value >= 0),
                       CONSTRAINT seats_showtime_code_unique UNIQUE (showtime_id, seat_code),
                       CONSTRAINT seats_showtime_id_unique UNIQUE (showtime_id, id)
);

CREATE TABLE bookings (
                          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                          user_id BIGINT NOT NULL REFERENCES users(id),
                          showtime_id BIGINT NOT NULL REFERENCES showtimes(id),
                          status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
                          total_amount NUMERIC(12, 2) NOT NULL,
                          expires_at TIMESTAMPTZ,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          CONSTRAINT bookings_status_check
                              CHECK (status IN ('PENDING', 'PAYMENT_PROCESSING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
                          CONSTRAINT bookings_id_showtime_unique UNIQUE (id, showtime_id),
                          CONSTRAINT bookings_nonnegative_amount_check CHECK (total_amount >= 0)
);

CREATE INDEX bookings_user_created_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_status_expiry_idx ON bookings (status, expires_at);

CREATE TABLE booking_seats (
                               id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                               booking_id BIGINT NOT NULL,
                               showtime_id BIGINT NOT NULL,
                               seat_id BIGINT NOT NULL,
                               reservation_status VARCHAR(20) NOT NULL,
                               unit_price NUMERIC(12, 2) NOT NULL,
                               created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                               CONSTRAINT booking_seats_status_check
                                   CHECK (reservation_status IN ('HELD', 'BOOKED', 'RELEASED')),
                               CONSTRAINT booking_seats_nonnegative_price_check CHECK (unit_price >= 0),
                               CONSTRAINT booking_seats_booking_seat_unique UNIQUE (booking_id, seat_id),
                               CONSTRAINT booking_seats_booking_same_showtime_fk
                                   FOREIGN KEY (booking_id, showtime_id) REFERENCES bookings (id, showtime_id),
                               CONSTRAINT booking_seats_seat_same_showtime_fk
                                   FOREIGN KEY (showtime_id, seat_id) REFERENCES seats (showtime_id, id)
);

CREATE INDEX booking_seats_booking_idx ON booking_seats (booking_id);
CREATE INDEX booking_seats_showtime_seat_idx ON booking_seats (showtime_id, seat_id);

CREATE UNIQUE INDEX booking_seats_one_active_reservation_per_seat
    ON booking_seats (seat_id)
    WHERE reservation_status IN ('HELD', 'BOOKED');

CREATE TABLE payments (
                          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                          booking_id BIGINT NOT NULL REFERENCES bookings(id),
                          idempotency_key VARCHAR(100) NOT NULL UNIQUE,
                          provider VARCHAR(50) NOT NULL DEFAULT 'MOCK',
                          provider_reference VARCHAR(255),
                          status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                          amount NUMERIC(12, 2) NOT NULL,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          CONSTRAINT payments_status_check
                              CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')),
                          CONSTRAINT payments_nonnegative_amount_check CHECK (amount >= 0)
);

CREATE INDEX payments_booking_idx ON payments (booking_id);