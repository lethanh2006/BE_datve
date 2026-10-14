import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { trim, trimToUndefined } from '../../common/transforms';

export class UpsertEventRequest {
  @Transform(trim)
  @IsString({ message: 'Tên sự kiện không hợp lệ' })
  @IsNotEmpty({ message: 'Tên sự kiện không được để trống' })
  @MaxLength(255, { message: 'Tên sự kiện tối đa 255 ký tự' })
  name: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString({ message: 'Mô tả không hợp lệ' })
  @MaxLength(5000, { message: 'Mô tả tối đa 5000 ký tự' })
  description?: string;

  @Transform(trim)
  @IsString({ message: 'Địa điểm không hợp lệ' })
  @IsNotEmpty({ message: 'Địa điểm không được để trống' })
  @MaxLength(255, { message: 'Địa điểm tối đa 255 ký tự' })
  venue: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Ảnh bìa phải là đường dẫn http(s) hợp lệ' },
  )
  @MaxLength(2048, { message: 'Đường dẫn ảnh tối đa 2048 ký tự' })
  imageUrl?: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString({ message: 'Thể loại không hợp lệ' })
  @MaxLength(50, { message: 'Thể loại tối đa 50 ký tự' })
  category?: string;
}
