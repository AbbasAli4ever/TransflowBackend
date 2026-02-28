import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiProperty({ enum: ['OWNER', 'ADMIN'] })
  @IsIn(['OWNER', 'ADMIN'])
  role!: string;

  @ApiPropertyOptional({ example: 'Promoted to admin' })
  @IsOptional()
  @IsString()
  reason?: string;
}
