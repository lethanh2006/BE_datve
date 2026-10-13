import { Event } from '../event.entity';

export class EventResponse {
  id: number;
  name: string;
  description: string | null;
  venue: string;

  static from(e: Event): EventResponse {
    return {
      id: Number(e.id),
      name: e.name,
      description: e.description,
      venue: e.venue,
    };
  }
}
