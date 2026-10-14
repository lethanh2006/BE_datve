import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { ApiException } from '../common/exception/api.exception';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { PageQueryDto } from '../common/response/page-query.dto';
import { PageResponse } from '../common/response/page-response';
import { MailService } from './mail.service';
import type { EmailStatus } from './mail.service';

export class EmailListQuery extends PageQueryDto {
  @IsOptional()
  @IsEnum(['PENDING', 'SENT', 'FAILED'], {
    message: 'Trạng thái chỉ nhận PENDING, SENT hoặc FAILED',
  })
  status?: EmailStatus;
}

@ApiTags('Quản trị')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/admin/emails')
export class AdminMailController {
  constructor(private readonly mail: MailService) {}

  /** Hàng đợi email (không kèm nội dung thư): để biết thư nào đã gửi, đang thử lại hay thất bại. */
  @Get()
  async list(@Query() query: EmailListQuery) {
    const { content, totalElements } = await this.mail.list(query);
    return PageResponse.of(content, query.page, query.size, totalElements);
  }

  /** Gửi lại một thư đã thất bại hẳn. */
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(@Param('id', ParseIdPipe) id: number) {
    if (!(await this.mail.retry(id))) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'EMAIL_NOT_RETRYABLE',
        'Chỉ gửi lại được thư đã thất bại',
      );
    }
    return { message: 'Đã đưa thư vào hàng đợi gửi lại' };
  }
}
