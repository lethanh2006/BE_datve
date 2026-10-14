import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Cho phép truy cập không cần đăng nhập (mặc định mọi route đều yêu cầu JWT). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
