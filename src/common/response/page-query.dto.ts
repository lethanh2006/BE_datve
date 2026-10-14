import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQueryDto {
  /** Số trang, bắt đầu từ 0 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(0, { message: 'page không được âm' })
  @Max(100_000, { message: 'page quá lớn' })
  page: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size phải là số nguyên' })
  @Min(1, { message: 'size tối thiểu là 1' })
  @Max(50, { message: 'size tối đa là 50' })
  size: number = 20;
}
