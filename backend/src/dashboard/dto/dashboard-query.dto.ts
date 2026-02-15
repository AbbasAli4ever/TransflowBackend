import { IsDateString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DashboardQueryDto {
  @ApiProperty({ required: false, example: '2026-02-15', description: 'Point-in-time date (defaults to today)' })
  @IsOptional()
  @IsDateString()
  asOfDate?: string;
}
