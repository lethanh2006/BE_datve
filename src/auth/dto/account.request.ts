import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim, trimLowercase } from '../../common/transforms';
import { ValidPassword } from './password.decorator';

export class UpdateProfileRequest {
  @Transform(trim)
  @IsString({ message: 'Họ tên không hợp lệ' })
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @MaxLength(255, { message: 'Họ tên tối đa 255 ký tự' })
  fullName: string;
}

export class ChangePasswordRequest {
  @IsString({ message: 'Mật khẩu hiện tại không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu hiện tại' })
  @MaxLength(72, { message: 'Mật khẩu hiện tại không hợp lệ' })
  currentPassword: string;

  @ValidPassword()
  newPassword: string;
}

export class ForgotPasswordRequest {
  @Transform(trimLowercase)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(255, { message: 'Email tối đa 255 ký tự' })
  email: string;
}

export class ResetPasswordRequest {
  @Transform(trim)
  @IsString({ message: 'Mã đặt lại mật khẩu không hợp lệ' })
  @IsNotEmpty({ message: 'Mã đặt lại mật khẩu không hợp lệ' })
  @MaxLength(200, { message: 'Mã đặt lại mật khẩu không hợp lệ' })
  token: string;

  @ValidPassword()
  password: string;
}
