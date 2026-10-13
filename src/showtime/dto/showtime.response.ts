import { Showtime } from '../showtime.entity';

export class ShowtimeResponse {
  id: number;
  eventId: number;
  startTime: Date;
  endTime: Date;

  static from(s: Showtime): ShowtimeResponse {
    return {
      id: Number(s.id),
      eventId: Number(s.eventId),
      startTime: s.startTime,
      endTime: s.endTime,
    };
  }
}
