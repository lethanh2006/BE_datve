import { applyDecorators } from '@nestjs/common';
import { IsString, MinLength, ValidateBy } from 'class-validator';

/** Mật khẩu mới: tối thiểu 8 ký tự; bcrypt chỉ xét 72 byte đầu nên giới hạn độ dài để tránh hiểu nhầm. */
export const ValidPassword = () =>
  applyDecorators(
    IsString({ message: 'Mật khẩu không hợp lệ' }),
    MinLength(8, { message: 'Mật khẩu tối thiểu 8 ký tự' }),
    ValidateBy({
      name: 'passwordByteLength',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
        defaultMessage: () =>
          'Mật khẩu tối đa 72 byte UTF-8 (ký tự có dấu có thể chiếm nhiều byte)',
      },
    }),
  );
