import { BookingStatus } from '../booking/booking-status.enum';

export class DailyStat {
  /** Ngày theo múi giờ cấu hình (yyyy-mm-dd) */
  date: string;
  confirmedBookings: number;
  revenue: number;
}

export class TopEventStat {
  eventId: number;
  name: string;
  seatsSold: number;
  revenue: number;
}

export class StatsResponse {
  events: number;
  upcomingShowtimes: number;
  users: number;
  bookingsByStatus: Record<BookingStatus, number>;
  seatsSold: number;
  revenue: number;
  /** 14 ngày gần nhất, ngày cũ trước */
  daily: DailyStat[];
  topEvents: TopEventStat[];
}
