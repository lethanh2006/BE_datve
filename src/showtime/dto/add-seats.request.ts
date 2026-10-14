import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { SeatSectionRequest } from './seat-section.request';

export class AddSeatsRequest {
  @IsArray({ message: 'Danh sách khu ghế không hợp lệ' })
  @ArrayMinSize(1, { message: 'Cần ít nhất 1 khu ghế' })
  @ArrayMaxSize(10, { message: 'Tối đa 10 khu ghế' })
  @ValidateNested({ each: true })
  @Type(() => SeatSectionRequest)
  sections: SeatSectionRequest[];
}
