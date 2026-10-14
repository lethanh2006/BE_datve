import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { effectiveStatusSql } from '../booking/booking-queries';
import { BookingStatus } from '../booking/booking-status.enum';
import { StatsResponse } from './stats.response';

@Injectable()
export class StatsService {
  private readonly timeZone: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.timeZone = config.get('STATS_TIME_ZONE', 'Asia/Ho_Chi_Minh');
  }

  async getStats(): Promise<StatsResponse> {
    const q = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
      this.dataSource.query(sql, params);

    const [totals, statusRows, sold, daily, top] = await Promise.all([
      q<{ events: number; upcomingShowtimes: number; users: number }>(
        `SELECT (SELECT count(*) FROM events)::int AS events,
                (SELECT count(*) FROM showtimes WHERE start_time > now())::int AS "upcomingShowtimes",
                (SELECT count(*) FROM users)::int AS users`,
      ),
      q<{ status: BookingStatus; count: number }>(
        `SELECT ${effectiveStatusSql('b')} AS status, count(*)::int AS count FROM bookings b GROUP BY 1`,
      ),
      q<{ seatsSold: number; revenue: string }>(
        `SELECT (SELECT count(*) FROM booking_seats WHERE reservation_status = 'BOOKED')::int AS "seatsSold",
                coalesce((SELECT sum(total_amount) FROM bookings WHERE status = 'CONFIRMED'), 0) AS revenue`,
      ),
      q<{ date: string; confirmedBookings: number; revenue: string }>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                count(b.id)::int AS "confirmedBookings",
                coalesce(sum(b.total_amount), 0) AS revenue
         FROM generate_series((now() AT TIME ZONE $1)::date - 13, (now() AT TIME ZONE $1)::date, interval '1 day') AS d
         LEFT JOIN payments p ON p.status = 'SUCCESS' AND (p.updated_at AT TIME ZONE $1)::date = d::date
         LEFT JOIN bookings b ON b.id = p.booking_id AND b.status = 'CONFIRMED'
         GROUP BY d ORDER BY d`,
        [this.timeZone],
      ),
      q<{ eventId: string; name: string; seatsSold: number; revenue: string }>(
        `SELECT e.id AS "eventId", e.name, count(bs.id)::int AS "seatsSold", sum(bs.unit_price) AS revenue
         FROM booking_seats bs
         JOIN showtimes s ON s.id = bs.showtime_id
         JOIN events e ON e.id = s.event_id
         WHERE bs.reservation_status = 'BOOKED'
         GROUP BY e.id, e.name
         ORDER BY revenue DESC, e.id
         LIMIT 5`,
      ),
    ]);

    const bookingsByStatus = Object.fromEntries(
      Object.values(BookingStatus).map((s) => [s, 0]),
    ) as Record<BookingStatus, number>;
    for (const row of statusRows) bookingsByStatus[row.status] = row.count;

    return {
      ...totals[0],
      bookingsByStatus,
      seatsSold: sold[0].seatsSold,
      revenue: Number(sold[0].revenue),
      daily: daily.map((d) => ({ ...d, revenue: Number(d.revenue) })),
      topEvents: top.map((t) => ({
        ...t,
        eventId: Number(t.eventId),
        revenue: Number(t.revenue),
      })),
    };
  }
}
