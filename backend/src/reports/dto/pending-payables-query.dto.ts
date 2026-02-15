import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PendingPayablesQueryDto {
  @ApiPropertyOptional({ example: '2026-02-20', description: 'Point-in-time date (defaults to today)' })
  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @ApiPropertyOptional({ description: 'Filter to a single supplier' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: 0, description: 'Minimum balance threshold (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAmount?: number;
}
