import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ApiException } from '../exception/api.exception';

/** Chỉ nhận số nguyên dương nằm trong vùng an toàn của JS (tối đa 15 chữ số). */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[1-9]\d{0,14}$/.test(value)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_ID',
        'ID không hợp lệ',
      );
    }
    return Number(value);
  }
}
