import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('events')
export class Event {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column()
  venue: string;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    insert: false,
    update: false,
  })
  createdAt: Date;
}
