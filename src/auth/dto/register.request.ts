import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim, trimLowercase } from '../../common/transforms';
import { ValidPassword } from './password.decorator';

export class RegisterRequest {
  @Transform(trimLowercase)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(255, { message: 'Email tối đa 255 ký tự' })
  email: string;

  @ValidPassword()
  password: string;

  @Transform(trim)
  @IsString({ message: 'Họ tên không hợp lệ' })
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @MaxLength(255, { message: 'Họ tên tối đa 255 ký tự' })
  fullName: string;
}
