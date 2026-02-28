import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'Acme Trading Co.', description: 'Business display name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Asia/Karachi', description: 'IANA timezone identifier' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'PKR', description: 'ISO 4217 currency code' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  baseCurrency?: string;
}
