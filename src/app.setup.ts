import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/exception/all-exceptions.filter';
import { requestContext } from './common/request-context.middleware';

function flattenErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...flattenErrors(e.children ?? []),
  ]);
}

/** Cấu hình dùng chung cho app thật (main.ts) và app trong e2e test. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);

  if (config.get('TRUST_PROXY') === 'true') app.set('trust proxy', 1);

  // Mã yêu cầu luôn có; log truy cập tắt khi test hoặc đặt LOG_REQUESTS=false
  app.use(
    requestContext({
      logAccess:
        config.get('LOG_REQUESTS') !== 'false' &&
        process.env.NODE_ENV !== 'test',
    }),
  );

  // Swagger UI cần inline script nên bỏ CSP riêng cho /api/docs
  const strict = helmet();
  const relaxed = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/api/docs') ? relaxed : strict)(req, res, next),
  );

  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    // Cho trình duyệt đọc header Date để FE bù lệch đồng hồ khi đếm ngược thời gian giữ ghế
    exposedHeaders: ['Date', 'X-Request-Id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) =>
        new BadRequestException(flattenErrors(errors).join('; ')),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

export function setupSwagger(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const enabled =
    config.get('SWAGGER_ENABLED') === 'true' ||
    (config.get('SWAGGER_ENABLED') === undefined &&
      process.env.NODE_ENV !== 'production');
  if (!enabled) return;

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Đặt vé API')
      .setDescription('API đặt vé sự kiện (NestJS)')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
