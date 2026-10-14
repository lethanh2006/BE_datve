import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/response/page-query.dto';
import { trimToUndefined } from '../../common/transforms';

export class EventListQuery extends PageQueryDto {
  /** Tìm theo tên sự kiện hoặc địa điểm */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(50)
  category?: string;
}
