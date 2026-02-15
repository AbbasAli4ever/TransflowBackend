import { IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardQueryDto {
  @ApiPropertyOptional({ example: '2026-02-15', description: 'Point-in-time date (defaults to today)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOfDate must be in YYYY-MM-DD format' })
  asOfDate?: string;
}
