import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ImportModule } from '@prisma/client';

export class CreateImportDto {
  @ApiProperty({ enum: ImportModule, description: 'Target module for the import' })
  @IsEnum(ImportModule)
  module!: ImportModule;
}
