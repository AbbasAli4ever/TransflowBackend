import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
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
