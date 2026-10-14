import { EntityManager } from 'typeorm';
import { BookingSeatStatus, BookingStatus } from './booking-status.enum';
import { BookingResponse } from './dto/booking.response';

/** Đơn PENDING đã quá hạn được coi là EXPIRED ngay cả khi job dọn chưa chạy. */
export const effectiveStatusSql = (alias: string) => `CASE
  WHEN ${alias}.status = 'PENDING' AND ${alias}.expires_at <= now() THEN 'EXPIRED'
  ELSE ${alias}.status END`;

interface BookingRow {
  id: string;
  showtimeId: string;
  eventId: string;
  eventName: string;
  venue: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  totalAmount: string;
  expiresAt: Date | null;
  createdAt: Date;
  userId: string;
  userEmail: string;
  userFullName: string;
}

interface BookingSeatRow {
  bookingId: string;
  seatId: string;
  seatCode: string;
  category: string;
  unitPrice: string;
  reservationStatus: BookingSeatStatus;
}

/** Nạp đầy đủ thông tin các đơn theo đúng thứ tự `ids` (đơn không tồn tại sẽ bị bỏ qua). */
export async function fetchBookings(
  em: EntityManager,
  ids: number[],
  includeCustomer = false,
): Promise<BookingResponse[]> {
  if (!ids.length) return [];

  const [rows, seatRows] = await Promise.all([
    em.query<BookingRow[]>(
      `SELECT b.id, b.showtime_id AS "showtimeId", e.id AS "eventId", e.name AS "eventName", e.venue,
              s.start_time AS "startTime", s.end_time AS "endTime",
              ${effectiveStatusSql('b')} AS status,
              b.total_amount AS "totalAmount", b.expires_at AS "expiresAt", b.created_at AS "createdAt",
              u.id AS "userId", u.email AS "userEmail", u.full_name AS "userFullName"
       FROM bookings b
       JOIN showtimes s ON s.id = b.showtime_id
       JOIN events e ON e.id = s.event_id
       JOIN users u ON u.id = b.user_id
       WHERE b.id = ANY($1::bigint[])`,
      [ids],
    ),
    em.query<BookingSeatRow[]>(
      `SELECT bs.booking_id AS "bookingId", se.id AS "seatId", se.seat_code AS "seatCode",
              se.category, bs.unit_price AS "unitPrice", bs.reservation_status AS "reservationStatus"
       FROM booking_seats bs
       JOIN seats se ON se.id = bs.seat_id
       WHERE bs.booking_id = ANY($1::bigint[])
       ORDER BY se.id`,
      [ids],
    ),
  ]);

  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const seatsByBooking = new Map<string, BookingSeatRow[]>();
  for (const seat of seatRows) {
    const list = seatsByBooking.get(seat.bookingId) ?? [];
    list.push(seat);
    seatsByBooking.set(seat.bookingId, list);
  }

  const result: BookingResponse[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const booking: BookingResponse = {
      id: Number(r.id),
      showtimeId: Number(r.showtimeId),
      eventId: Number(r.eventId),
      eventName: r.eventName,
      venue: r.venue,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status,
      seats: (seatsByBooking.get(r.id) ?? []).map((s) => ({
        seatId: Number(s.seatId),
        seatCode: s.seatCode,
        category: s.category,
        unitPrice: Number(s.unitPrice),
        reservationStatus: s.reservationStatus,
      })),
      totalAmount: Number(r.totalAmount),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    };
    if (includeCustomer) {
      booking.customer = {
        id: Number(r.userId),
        email: r.userEmail,
        fullName: r.userFullName,
      };
    }
    result.push(booking);
  }
  return result;
}
