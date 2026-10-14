import { Transform } from 'class-transformer';
import { trim, trimLowercase } from '../../common/transforms';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterRequest {
  @Transform(trimLowercase)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(255, { message: 'Email tối đa 255 ký tự' })
  email: string;

  // bcrypt chỉ xét 72 byte đầu nên giới hạn độ dài để tránh hiểu nhầm
  @IsString({ message: 'Mật khẩu không hợp lệ' })
  @MinLength(8, { message: 'Mật khẩu tối thiểu 8 ký tự' })
  @MaxLength(72, { message: 'Mật khẩu tối đa 72 ký tự' })
  password: string;

  @Transform(trim)
  @IsString({ message: 'Họ tên không hợp lệ' })
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @MaxLength(255, { message: 'Họ tên tối đa 255 ký tự' })
  fullName: string;
}
