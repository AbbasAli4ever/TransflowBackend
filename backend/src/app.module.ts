import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { CustomersModule } from './customers/customers.module';
import { ProductsModule } from './products/products.module';
import { PaymentAccountsModule } from './payment-accounts/payment-accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ImportsModule } from './imports/imports.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantScopeGuard } from './common/guards/tenant-scope.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { AppConfigModule } from './config/config.module';
import { createLoggerOptions } from './common/logger.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    AppConfigModule,
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLoggerOptions(config.get<string>('app.logFormat') ?? 'json'),
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    SuppliersModule,
    CustomersModule,
    ProductsModule,
    PaymentAccountsModule,
    TransactionsModule,
    ReportsModule,
    DashboardModule,
    ImportsModule,
  ],
  providers: [
    RequestContextMiddleware,
    TenantContextMiddleware,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantScopeGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware, TenantContextMiddleware).forRoutes('*path');
  }
}
