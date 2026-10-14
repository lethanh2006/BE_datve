import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../common/exception/api.exception';
import { SeatSectionRequest } from './dto/seat-section.request';

export const MAX_SEATS_PER_SHOWTIME = 2000;

export interface SeatSpec {
  seatCode: string;
  category: string;
  faceValue: number;
}

/** Sinh danh sách ghế từ các khu ghế; kiểm tra trùng mã ghế và giới hạn số ghế. */
export function buildSeats(sections: SeatSectionRequest[]): SeatSpec[] {
  const seen = new Set<string>();
  const seats: SeatSpec[] = [];

  for (const section of sections) {
    for (const row of section.rows) {
      for (let n = 1; n <= section.seatsPerRow; n++) {
        const seatCode = `${row}${n}`;
        if (seen.has(seatCode)) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            'DUPLICATE_SEAT_CODE',
            `Mã ghế ${seatCode} bị trùng giữa các khu ghế`,
          );
        }
        seen.add(seatCode);
        seats.push({
          seatCode,
          category: section.category,
          faceValue: section.faceValue,
        });
      }
    }
  }

  if (seats.length > MAX_SEATS_PER_SHOWTIME) {
    throw tooManySeats();
  }
  return seats;
}

export function tooManySeats() {
  return new ApiException(
    HttpStatus.BAD_REQUEST,
    'TOO_MANY_SEATS',
    `Mỗi suất diễn tối đa ${MAX_SEATS_PER_SHOWTIME} ghế`,
  );
}
