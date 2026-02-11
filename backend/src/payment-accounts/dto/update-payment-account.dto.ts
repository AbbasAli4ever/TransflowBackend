import { IsString, IsOptional, Length } from 'class-validator';

export class UpdatePaymentAccountDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;
}
