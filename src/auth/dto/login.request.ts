import { Transform } from 'class-transformer';
import { trimLowercase } from '../../common/transforms';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginRequest {
  @Transform(trimLowercase)
  @IsString({ message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString({ message: 'Mật khẩu không hợp lệ' })
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
}
