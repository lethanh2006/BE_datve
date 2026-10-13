import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('showtimes')
export class Showtime {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id: string;

  @Column({ name: 'event_id', type: 'bigint' })
  eventId: string;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;
}
