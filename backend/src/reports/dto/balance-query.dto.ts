import { IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BalanceQueryDto {
  @ApiPropertyOptional({ example: '2026-02-20', description: 'Point-in-time date (defaults to today)' })
  @IsOptional()
  @IsDateString()
  asOfDate?: string;
}
