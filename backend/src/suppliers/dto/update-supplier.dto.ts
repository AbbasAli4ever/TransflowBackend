import { IsString, IsOptional, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Transform(({ value }) => value?.trim())
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
