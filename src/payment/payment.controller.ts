import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { PayRequest } from './dto/pay.request';
import { PaymentService } from './payment.service';

@ApiTags('Thanh toán')
@ApiBearerAuth()
@Controller('api')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /** 201 khi tạo giao dịch mới, 200 khi gọi lại với cùng Idempotency-Key. */
  @Post('bookings/:bookingId/payments')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Chuỗi duy nhất cho mỗi lần thử thanh toán (vd UUID)',
  })
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', ParseIdPipe) bookingId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PayRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { payment, replayed } = await this.paymentService.pay(
      user,
      bookingId,
      idempotencyKey,
      dto,
    );
    res.status(replayed ? 200 : 201);
    return payment;
  }

  @Get('bookings/:bookingId/payments')
  listForBooking(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', ParseIdPipe) bookingId: number,
  ) {
    return this.paymentService.listForBooking(user, bookingId);
  }

  @Get('payments/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.paymentService.getForUser(user, id);
  }
}
