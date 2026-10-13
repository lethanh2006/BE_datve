import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiException } from './api.exception';

export interface ApiErrorResponse {
  code: string;
  message: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Lỗi hệ thống';

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = status === HttpStatus.NOT_FOUND ? 'NOT_FOUND' : 'BAD_REQUEST';
      message =
        typeof body === 'string'
          ? body
          : String(
              (body as { message?: unknown }).message ?? exception.message,
            );
    } else {
      this.logger.error(exception);
    }

    const body: ApiErrorResponse = {
      code,
      message,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }
}
