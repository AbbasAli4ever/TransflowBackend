import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Service health check' })
  @ApiOkResponse({ description: 'Service is healthy', type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'Database is unavailable',
    type: ApiErrorResponse,
  })
  async getHealth() {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - start;
      const memory = process.memoryUsage();

      const databaseInfo = {
        status: 'up',
        responseTime: `${responseTime}ms`,
      };

      const memoryInfo = {
        status: 'ok',
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
      };

      return {
        status: 'ok',
        info: {
          database: databaseInfo,
          memory: memoryInfo,
        },
        error: {},
        details: {
          database: databaseInfo,
          memory: memoryInfo,
        },
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        info: {},
        error: {
          database: {
            status: 'down',
            message: 'Connection timeout',
          },
        },
        details: {
          database: {
            status: 'down',
            message: 'Connection timeout',
          },
        },
      });
    }
  }

}
