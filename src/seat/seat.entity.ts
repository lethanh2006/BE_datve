import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('seats')
export class Seat {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id: string;

  @Column({ name: 'showtime_id', type: 'bigint' })
  showtimeId: string;

  @Column({ name: 'seat_code' })
  seatCode: string;

  @Column()
  category: string;

  @Column({ name: 'face_value', type: 'numeric', precision: 12, scale: 2 })
  faceValue: string;
}
