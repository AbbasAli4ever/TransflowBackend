import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ImportModule, ImportStatus } from '@prisma/client';

export class ListImportsQueryDto {
  @ApiPropertyOptional({ enum: ImportModule })
  @IsOptional()
  @IsEnum(ImportModule)
  module?: ImportModule;

  @ApiPropertyOptional({ enum: ImportStatus })
  @IsOptional()
  @IsEnum(ImportStatus)
  status?: ImportStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
