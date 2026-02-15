import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ImportsService } from './imports.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateImportDto } from './dto/create-import.dto';
import { ColumnMappingDto } from './dto/column-mapping.dto';
import { CommitImportDto } from './dto/commit-import.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';

@ApiTags('imports')
@ApiBearerAuth('bearer')
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a CSV or XLSX file to create an import batch' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'module'],
      properties: {
        file: { type: 'string', format: 'binary' },
        module: { type: 'string', enum: ['SUPPLIERS', 'CUSTOMERS', 'PRODUCTS', 'OPENING_BALANCES'] },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Import batch created with PENDING_MAPPING status' })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateImportDto,
  ) {
    return this.importsService.uploadFile(file, dto);
  }

  @Post(':id/map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Map CSV/XLSX columns to system fields and validate all rows' })
  @ApiOkResponse({ description: 'Rows validated; batch moved to VALIDATED status' })
  @ApiNotFoundResponse({ description: 'Import batch not found' })
  mapColumns(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ColumnMappingDto,
  ) {
    return this.importsService.mapColumns(id, dto);
  }

  @Post(':id/commit')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Commit a validated import batch to create records' })
  @ApiOkResponse({ description: 'Import committed; records created' })
  @ApiNotFoundResponse({ description: 'Import batch not found' })
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitImportDto,
  ) {
    return this.importsService.commitImport(id, dto);
  }

  @Post(':id/rollback')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rollback a completed import batch (deletes created records if no dependencies)' })
  @ApiOkResponse({ description: 'Import rolled back' })
  @ApiNotFoundResponse({ description: 'Import batch not found' })
  rollback(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.rollbackImport(id);
  }

  @Get()
  @ApiOperation({ summary: 'List import batches for the current tenant' })
  @ApiOkResponse({ description: 'Import batches list' })
  list(@Query() query: ListImportsQueryDto) {
    return this.importsService.listBatches(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import batch detail including paginated rows' })
  @ApiOkResponse({ description: 'Import batch detail' })
  @ApiNotFoundResponse({ description: 'Import batch not found' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.importsService.getBatchDetail(id, page, limit);
  }
}
