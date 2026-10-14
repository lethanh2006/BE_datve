import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/response/page-query.dto';
import { trimToUndefined } from '../../common/transforms';
import { BookingStatus } from '../booking-status.enum';

export class BookingListQuery extends PageQueryDto {
  @IsOptional()
  @Transform(trimToUndefined)
  @IsEnum(BookingStatus, { message: 'Trạng thái đơn không hợp lệ' })
  status?: BookingStatus;
}

export class AdminBookingListQuery extends BookingListQuery {
  /** Tìm theo email hoặc họ tên khách hàng */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(100)
  q?: string;
}
