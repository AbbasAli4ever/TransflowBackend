import { IsString, IsOptional, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePaymentAccountDto {
  @ApiPropertyOptional({ example: 'Main Cash' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;
}
