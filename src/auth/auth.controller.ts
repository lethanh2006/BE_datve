import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  UpdateProfileRequest,
} from './dto/account.request';
import { LoginRequest } from './dto/login.request';
import { RegisterRequest } from './dto/register.request';

// Giới hạn chặt hơn cho các thao tác nhạy cảm để chống dò mật khẩu và spam email
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const MAIL_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterRequest) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginRequest) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }

  @ApiBearerAuth()
  @Put('me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileRequest,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  /** Đổi mật khẩu, thu hồi các phiên khác và trả token mới cho phiên hiện tại. */
  @ApiBearerAuth()
  @Throttle(AUTH_THROTTLE)
  @Put('password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordRequest,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  /** Luôn trả 202 dù email có tồn tại hay không. */
  @Public()
  @Throttle(MAIL_THROTTLE)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordRequest) {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'Nếu email đã đăng ký, chúng tôi vừa gửi hướng dẫn đặt lại mật khẩu',
    };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordRequest) {
    return this.authService.resetPassword(dto.token, dto.password);
  }
}
