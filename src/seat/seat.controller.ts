import { Controller, Get, MessageEvent, Param, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Observable } from 'rxjs';
import { SeatService } from './seat.service';

@ApiTags('Ghế')
@Public()
@Controller()
export class SeatController {
  constructor(private readonly seatService: SeatService) {}

  // danh sách ghế của 1 suất
  @Get('api/showtimes/:showtimeId/seats')
  listSeats(@Param('showtimeId', ParseIdPipe) showtimeId: number) {
    return this.seatService.findByShowtimeId(showtimeId);
  }

  /**
   * Server-Sent Events: nhận sự kiện `seats` mỗi khi ghế của suất diễn đổi (có người giữ, huỷ, hết hạn, thanh toán...).
   * Sự kiện không mang dữ liệu ghế, client gọi lại API danh sách ghế; nhờ vậy không lộ thêm thông tin và luôn nhất quán.
   */
  @Sse('api/showtimes/:showtimeId/seats/events')
  events(
    @Param('showtimeId', ParseIdPipe) showtimeId: number,
  ): Promise<Observable<MessageEvent>> {
    return this.seatService.streamChanges(showtimeId);
  }
}
