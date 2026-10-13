import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BookingSeatStatus } from './booking-status.enum';

@Entity('booking_seats')
export class BookingSeat {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id: string;

  @Column({ name: 'booking_id', type: 'bigint' })
  bookingId: string;

  @Column({ name: 'showtime_id', type: 'bigint' })
  showtimeId: string;

  @Column({ name: 'seat_id', type: 'bigint' })
  seatId: string;

  @Column({ name: 'reservation_status', type: 'varchar', length: 20 })
  reservationStatus: BookingSeatStatus;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2 })
  unitPrice: string;
}
