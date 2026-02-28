import { IsOptional, IsEnum, IsDateString, IsUUID, IsIn, IsString, registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

function IsNotBefore(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotBefore',
      target: (object as any).constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedProp] = args.constraints;
          const relatedValue = (args.object as any)[relatedProp];
          if (typeof value !== 'string' || typeof relatedValue !== 'string') return true;
          return value >= relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be on or after ${args.constraints[0]}`;
        },
      },
    });
  };
}

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ example: '2026-02-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-02-11' })
  @IsOptional()
  @IsDateString()
  @IsNotBefore('dateFrom', { message: 'dateTo must be on or after dateFrom' })
  dateTo?: string;

  @ApiPropertyOptional({ example: 'supplier-uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'customer-uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: ['transactionDate', 'createdAt', 'totalAmount'] })
  @IsOptional()
  @IsIn(['transactionDate', 'createdAt', 'totalAmount'])
  sortBy?: 'transactionDate' | 'createdAt' | 'totalAmount';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: 'Acme', description: 'Search by supplier or customer name (case-insensitive)' })
  @IsOptional()
  @IsString()
  partySearch?: string;

  @ApiPropertyOptional({ example: 'product-uuid', description: 'Filter transactions that contain this product in any line' })
  @IsOptional()
  @IsUUID()
  productId?: string;
}
