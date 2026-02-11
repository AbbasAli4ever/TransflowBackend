import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
