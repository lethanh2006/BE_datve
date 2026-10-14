import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id: string;

  @Column()
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ type: 'varchar', length: 20, default: Role.USER })
  role: Role;

  /** Tăng lên khi đổi/đặt lại mật khẩu để thu hồi các token cũ */
  @Column({ name: 'token_version', type: 'int', default: 0 })
  tokenVersion: number;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    insert: false,
    update: false,
  })
  createdAt: Date;
}
