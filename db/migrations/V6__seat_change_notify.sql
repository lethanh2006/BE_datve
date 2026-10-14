-- Báo cho các kết nối đang nghe (LISTEN seat_changes) khi ghế của một suất diễn thay đổi,
-- để giao diện cập nhật sơ đồ ghế ngay thay vì chờ chu kỳ làm mới.
-- pg_notify chỉ được phát khi giao dịch COMMIT, và nhiều thông báo giống nhau trong cùng
-- một giao dịch được gộp thành một, nên đặt trigger theo dòng vẫn rẻ.
CREATE FUNCTION notify_seat_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('seat_changes', COALESCE(NEW.showtime_id, OLD.showtime_id)::text);
    RETURN NULL;
END
$$;

CREATE TRIGGER booking_seats_notify_change
    AFTER INSERT OR DELETE ON booking_seats
    FOR EACH ROW EXECUTE FUNCTION notify_seat_change();

-- Chỉ khi trạng thái giữ chỗ đổi (HELD -> BOOKED/RELEASED)
CREATE TRIGGER booking_seats_notify_status
    AFTER UPDATE ON booking_seats
    FOR EACH ROW WHEN (OLD.reservation_status IS DISTINCT FROM NEW.reservation_status)
    EXECUTE FUNCTION notify_seat_change();

-- Admin thêm/xoá ghế của suất diễn
CREATE TRIGGER seats_notify_change
    AFTER INSERT OR DELETE ON seats
    FOR EACH ROW EXECUTE FUNCTION notify_seat_change();
