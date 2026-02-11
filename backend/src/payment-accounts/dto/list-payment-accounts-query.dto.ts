import { IsOptional, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPaymentAccountsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['CASH', 'BANK', 'WALLET', 'CARD'])
  type?: 'CASH' | 'BANK' | 'WALLET' | 'CARD';

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ACTIVE';
}
