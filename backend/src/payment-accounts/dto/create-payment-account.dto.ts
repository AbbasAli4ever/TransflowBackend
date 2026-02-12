import { IsString, IsNotEmpty, IsOptional, Length, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentAccountDto {
  @ApiProperty({ example: 'Main Cash' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ enum: ['CASH', 'BANK', 'WALLET', 'CARD'] })
  @IsIn(['CASH', 'BANK', 'WALLET', 'CARD'])
  type!: 'CASH' | 'BANK' | 'WALLET' | 'CARD';

  @ApiPropertyOptional({ example: 25000, default: 0, description: 'Opening balance in PKR (integer)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  openingBalance?: number = 0;
}
