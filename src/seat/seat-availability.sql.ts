/**
 * Các đoạn SQL dùng chung để xác định ghế đang bị giữ/đã bán, tránh lệch logic giữa
 * danh sách ghế, thống kê suất diễn và kiểm tra khi đặt vé.
 *
 * Một ghế đang bị GIỮ khi booking còn PENDING và chưa hết hạn, hoặc đang thanh toán
 * (PAYMENT_PROCESSING không hết hạn theo giờ cho tới khi thanh toán có kết quả).
 * Chỉ nhận alias do code truyền vào, không bao giờ nối dữ liệu người dùng.
 */
export const seatBookedSql = (seatAlias: string) => `EXISTS (
  SELECT 1 FROM booking_seats bs
  WHERE bs.seat_id = ${seatAlias}.id AND bs.reservation_status = 'BOOKED')`;

export const seatHeldSql = (seatAlias: string) => `EXISTS (
  SELECT 1 FROM booking_seats bs
  JOIN bookings b ON b.id = bs.booking_id
  WHERE bs.seat_id = ${seatAlias}.id
    AND bs.reservation_status = 'HELD'
    AND (b.status = 'PAYMENT_PROCESSING' OR (b.status = 'PENDING' AND b.expires_at > now())))`;

export const seatTakenSql = (seatAlias: string) =>
  `(${seatBookedSql(seatAlias)} OR ${seatHeldSql(seatAlias)})`;
