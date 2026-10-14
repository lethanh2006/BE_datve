import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trim, trimUppercaseEach } from '../../common/transforms';

/** Một khu ghế: nhiều hàng, mỗi hàng cùng số ghế và cùng giá. Mã ghế sinh ra dạng A1, A2, ... */
export class SeatSectionRequest {
  @Transform(trim)
  @IsString({ message: 'Hạng ghế không hợp lệ' })
  @IsNotEmpty({ message: 'Hạng ghế không được để trống' })
  @MaxLength(30, { message: 'Hạng ghế tối đa 30 ký tự' })
  category: string;

  @IsArray({ message: 'Danh sách hàng ghế không hợp lệ' })
  @ArrayMinSize(1, { message: 'Cần ít nhất 1 hàng ghế' })
  @ArrayMaxSize(26, { message: 'Tối đa 26 hàng ghế mỗi khu' })
  @Transform(trimUppercaseEach)
  @Matches(/^[A-Z]{1,2}$/, {
    each: true,
    message: 'Tên hàng ghế gồm 1-2 chữ cái, ví dụ A hoặc AA',
  })
  rows: string[];

  @IsInt({ message: 'Số ghế mỗi hàng phải là số nguyên' })
  @Min(1, { message: 'Mỗi hàng cần ít nhất 1 ghế' })
  @Max(100, { message: 'Mỗi hàng tối đa 100 ghế' })
  seatsPerRow: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Giá vé không hợp lệ' })
  @Min(0, { message: 'Giá vé không được âm' })
  @Max(999_999_999, { message: 'Giá vé quá lớn' })
  faceValue: number;
}
