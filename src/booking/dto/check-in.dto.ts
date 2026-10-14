import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimLowercase } from '../../common/transforms';
import { BookingResponse } from './booking.response';

export class CheckInRequest {
  /** Mã vé đọc từ QR trên vé điện tử */
  @Transform(trimLowercase)
  @IsString({ message: 'Mã vé không hợp lệ' })
  @IsNotEmpty({ message: 'Mã vé không được để trống' })
  @MaxLength(64, { message: 'Mã vé không hợp lệ' })
  ticketCode: string;
}

export type CheckInResult = 'CHECKED_IN' | 'ALREADY_CHECKED_IN';

export class CheckInResponse {
  /** CHECKED_IN: vào cửa lần đầu; ALREADY_CHECKED_IN: vé này đã được quét trước đó */
  result: CheckInResult;
  booking: BookingResponse;
}
