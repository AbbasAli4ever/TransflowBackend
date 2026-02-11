import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { buildValidationPipe } from './common/pipes/validation.pipe';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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

// Swagger UI — development only
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Persona Finance API')
      .setDescription('Multi-tenant finance system — Phase 1: Authentication & Tenant Management')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
}

bootstrap();
