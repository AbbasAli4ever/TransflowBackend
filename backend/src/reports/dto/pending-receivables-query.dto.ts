import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PendingReceivablesQueryDto {
  @ApiPropertyOptional({ example: '2026-02-20', description: 'Point-in-time date (defaults to today)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOfDate must be in YYYY-MM-DD format' })
  asOfDate?: string;

  @ApiPropertyOptional({ description: 'Filter to a single customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 0, description: 'Minimum balance threshold (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAmount?: number;
}
