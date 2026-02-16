import { IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.validator';

export class DashboardQueryDto {
  @ApiPropertyOptional({ example: '2026-02-15', description: 'Point-in-time date (defaults to today)' })
  @IsOptional()
  @IsCalendarDate()
  asOfDate?: string;
}
