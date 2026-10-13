import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class CreateBookingRequest {
  @IsArray({ message: 'Danh sách ghế không được để trống' })
  @ArrayNotEmpty({ message: 'Danh sách ghế không được để trống' })
  @IsInt({ each: true, message: 'Seat ID phải là số nguyên' })
  seatIds: number[];
}
