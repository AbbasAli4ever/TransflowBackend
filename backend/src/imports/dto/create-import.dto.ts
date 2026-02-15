import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ImportModule } from '@prisma/client';

const SUPPORTED_MODULES: ImportModule[] = ['SUPPLIERS', 'CUSTOMERS', 'PRODUCTS', 'OPENING_BALANCES'];

export class CreateImportDto {
  @ApiProperty({ enum: SUPPORTED_MODULES, description: 'Target module for the import' })
  @IsIn(SUPPORTED_MODULES, { message: `module must be one of: ${SUPPORTED_MODULES.join(', ')}` })
  module!: ImportModule;
}
