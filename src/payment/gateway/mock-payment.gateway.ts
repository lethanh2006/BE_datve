import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ChargeRequest,
  ChargeResult,
  PaymentGateway,
  RefundRequest,
  RefundResult,
} from './payment-gateway';

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'MOCK';
  private readonly delayMs: number;

  constructor(config: ConfigService) {
    this.delayMs = Number(config.get('PAYMENT_MOCK_DELAY_MS', 400));
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (this.delayMs > 0) await sleep(this.delayMs);
    const status = request.simulate ?? 'SUCCESS';
    return {
      status,
      providerReference: status === 'SUCCESS' ? `MOCK-${randomUUID()}` : null,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    if (this.delayMs > 0) await sleep(this.delayMs);
    const status = request.simulate ?? 'SUCCESS';
    return {
      status,
      providerReference:
        status === 'SUCCESS' ? `MOCK-REFUND-${randomUUID()}` : null,
    };
  }
}
