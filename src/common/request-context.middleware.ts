import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const logger = new Logger('HTTP');
/** Chỉ nhận X-Request-Id do client/proxy gửi nếu đủ ngắn và an toàn để ghi log, tránh chèn ký tự lạ vào log. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Gắn mã yêu cầu (X-Request-Id) vào response để đối chiếu log với báo lỗi của người dùng,
 * và ghi một dòng log truy cập mỗi request: phương thức, đường dẫn (không kèm query), mã trạng thái, thời gian xử lý.
 */
export function requestContext(options: { logAccess: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id =
      incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);

    if (options.logAccess) {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const path = req.originalUrl.split('?')[0];
        const line = `${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms id=${id}`;
        if (res.statusCode >= 500) logger.error(line);
        else logger.log(line);
      });
    }
    next();
  };
}
