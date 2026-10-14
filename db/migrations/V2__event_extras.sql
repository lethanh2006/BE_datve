-- Thông tin hiển thị cho sự kiện: ảnh bìa và thể loại
ALTER TABLE events
    ADD COLUMN image_url TEXT,
    ADD COLUMN category VARCHAR(50);

CREATE INDEX events_category_idx ON events (category);
CREATE INDEX showtimes_start_time_idx ON showtimes (start_time);
