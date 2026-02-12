import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPaymentAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['CASH', 'BANK', 'WALLET', 'CARD'] })
  @IsOptional()
  @IsIn(['CASH', 'BANK', 'WALLET', 'CARD'])
  type?: 'CASH' | 'BANK' | 'WALLET' | 'CARD';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ACTIVE';
}
