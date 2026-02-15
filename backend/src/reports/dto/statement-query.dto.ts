import { IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StatementQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Start date (inclusive)' })
  @IsNotEmpty()
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ example: '2026-02-20', description: 'End date (inclusive)' })
  @IsNotEmpty()
  @IsDateString()
  dateTo!: string;
}
