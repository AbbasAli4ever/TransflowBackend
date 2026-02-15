import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class ColumnMappingDto {
  @ApiProperty({
    description: 'Maps system field names to detected column headers. Key = system field, value = CSV/XLSX column header.',
    example: { name: 'Company Name', phone: 'Phone Number' },
  })
  @IsObject()
  columnMappings!: Record<string, string>;
}
