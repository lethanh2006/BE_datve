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

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

/** Lấy message từ body của HttpException (có thể là chuỗi, đối tượng, hoặc mảng message của ValidationPipe). */
function messageOf(body: string | object, fallback: string): string {
  if (typeof body === 'string') return body;
  const message = (body as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.join('; ');
  return message ?? fallback;
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
      code = CODE_BY_STATUS[status] ?? `HTTP_${status}`;
      message =
        status === HttpStatus.TOO_MANY_REQUESTS
          ? 'Bạn thao tác quá nhanh, vui lòng thử lại sau'
          : messageOf(body, exception.message);
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
