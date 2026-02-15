import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { XlsxParserService } from './parsers/xlsx-parser.service';
import { RowValidatorService } from './validators/row-validator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ImportsController],
  providers: [ImportsService, CsvParserService, XlsxParserService, RowValidatorService],
})
export class ImportsModule {}
