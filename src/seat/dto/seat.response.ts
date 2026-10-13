import { SeatStatus } from '../seat-status.enum';

export class SeatResponse {
  id: number;
  seatCode: string;
  category: string;
  faceValue: number;
  status: SeatStatus;
}
