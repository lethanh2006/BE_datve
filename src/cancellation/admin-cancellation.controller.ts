import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { CancelShowtimeRequest } from './dto/cancel-showtime.dto';
import { ShowtimeCancellationService } from './showtime-cancellation.service';

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin/showtimes')
export class AdminCancellationController {
  constructor(private readonly cancellation: ShowtimeCancellationService) {}

  /**
   * Huỷ suất diễn: ngừng bán, nhả ghế đơn chưa thanh toán và tự hoàn tiền các đơn đã thanh toán (chạy nền).
   * Trả 202 kèm tiến độ; gọi lại an toàn (idempotent) và dùng để kích hoạt lại việc hoàn tiền.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(
    @Param('id', ParseIdPipe) id: number,
    @Body() dto: CancelShowtimeRequest,
  ) {
    return this.cancellation.cancel(id, dto.reason);
  }

  /** Tiến độ hoàn tiền của suất diễn đã huỷ. */
  @Get(':id/cancellation')
  status(@Param('id', ParseIdPipe) id: number) {
    return this.cancellation.status(id);
  }
}
