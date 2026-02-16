import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardSummaryResponseDto } from './dto/dashboard-response.dto';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Dashboard summary — tenant-wide financial snapshot' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String, example: '2026-02-15' })
  @ApiOkResponse({
    description: 'Dashboard summary with cash, inventory, receivables, payables, and recent activity',
    type: DashboardSummaryResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  getSummary(@Query() query: DashboardQueryDto) {
    return this.dashboardService.getSummary(query);
  }
}
