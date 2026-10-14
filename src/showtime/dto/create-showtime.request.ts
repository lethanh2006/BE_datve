import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsISO8601,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { SeatSectionRequest } from './seat-section.request';

const WITH_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/;
const TZ_MESSAGE = 'Thời gian phải có múi giờ, ví dụ 2026-12-01T19:00:00+07:00';

export class CreateShowtimeRequest {
  @IsISO8601({ strict: true }, { message: 'Giờ bắt đầu không hợp lệ' })
  @Matches(WITH_TIMEZONE, { message: TZ_MESSAGE })
  startTime: string;

  @IsISO8601({ strict: true }, { message: 'Giờ kết thúc không hợp lệ' })
  @Matches(WITH_TIMEZONE, { message: TZ_MESSAGE })
  endTime: string;

  /** Tạo luôn ghế cho suất diễn (có thể bỏ trống rồi thêm ghế sau) */
  @IsOptional()
  @ArrayMaxSize(10, { message: 'Tối đa 10 khu ghế' })
  @ValidateNested({ each: true })
  @Type(() => SeatSectionRequest)
  sections?: SeatSectionRequest[];
}
