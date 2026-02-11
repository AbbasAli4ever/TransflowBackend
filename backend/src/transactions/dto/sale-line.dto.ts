import { IsUUID, IsInt, Min, IsOptional } from 'class-validator';

export class SaleLineDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;
}
