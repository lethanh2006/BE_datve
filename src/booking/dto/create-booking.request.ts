import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';

export const MAX_SEATS_PER_BOOKING = 10;

export class CreateBookingRequest {
  @IsArray({ message: 'Danh sách ghế không được để trống' })
  @ArrayNotEmpty({ message: 'Danh sách ghế không được để trống' })
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING, {
    message: `Mỗi lần đặt tối đa ${MAX_SEATS_PER_BOOKING} ghế`,
  })
  @IsInt({ each: true, message: 'Seat ID phải là số nguyên' })
  @Min(1, { each: true, message: 'Seat ID không hợp lệ' })
  @Max(Number.MAX_SAFE_INTEGER, { each: true, message: 'Seat ID không hợp lệ' })
  seatIds: number[];
}
