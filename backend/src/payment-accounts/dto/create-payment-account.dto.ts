import { IsString, IsNotEmpty, IsOptional, Length, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentAccountDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  name!: string;

  @IsIn(['CASH', 'BANK', 'WALLET', 'CARD'])
  type!: 'CASH' | 'BANK' | 'WALLET' | 'CARD';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  openingBalance?: number = 0;
}
