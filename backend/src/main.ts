import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { buildValidationPipe } from './common/pipes/validation.pipe';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('app.apiPrefix');
  const corsOrigin = config.get<string>('app.corsOrigin');
  const rateWindowMs = config.get<number>('app.rateLimitWindowMs');
  const rateMax = config.get<number>('app.rateLimitMaxRequests');

  app.setGlobalPrefix(apiPrefix ?? 'api/v1');

  app.enableCors({
    origin: corsOrigin?.split(',').map((value) => value.trim()),
    credentials: true,
  });

  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: rateWindowMs ?? 15 * 60 * 1000,
      max: rateMax ?? 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.useGlobalPipes(buildValidationPipe());

  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
}

bootstrap();
