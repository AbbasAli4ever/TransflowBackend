import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class CommitImportDto {
  @ApiPropertyOptional({ default: true, description: 'Skip invalid rows instead of aborting' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  skipInvalidRows?: boolean = true;
}
