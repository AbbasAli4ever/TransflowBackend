import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ImportsService } from './imports.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { CreateImportDto } from './dto/create-import.dto';
import { ColumnMappingDto } from './dto/column-mapping.dto';
import { CommitImportDto } from './dto/commit-import.dto';
import { ListImportsQueryDto } from './dto/list-imports-query.dto';
import {
  ImportBatchDetailResponseDto,
  ImportCommitResponseDto,
  ImportListResponseDto,
  ImportMapResponseDto,
  ImportRollbackResponseDto,
  ImportUploadResponseDto,
} from './dto/import-response.dto';

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
  @ApiCreatedResponse({ description: 'Import batch created with PENDING_MAPPING status', type: ImportUploadResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateImportDto,
  ) {
    return this.importsService.uploadFile(file, dto);
  }

  @Post(':id/map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Map CSV/XLSX columns to system fields and validate all rows' })
  @ApiOkResponse({ description: 'Rows validated; batch moved to VALIDATED status', type: ImportMapResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Batch status conflict', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Import batch not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
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
  @ApiOkResponse({ description: 'Import committed; records created', type: ImportCommitResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Batch status conflict', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Import batch not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
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
  @ApiOkResponse({ description: 'Import rolled back', type: ImportRollbackResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Cannot rollback due to dependencies', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Import batch not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  rollback(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.rollbackImport(id);
  }

  @Get()
  @ApiOperation({ summary: 'List import batches for the current tenant' })
  @ApiOkResponse({ description: 'Import batches list', type: ImportListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  list(@Query() query: ListImportsQueryDto) {
    return this.importsService.listBatches(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import batch detail including paginated rows' })
  @ApiOkResponse({ description: 'Import batch detail', type: ImportBatchDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiNotFoundResponse({ description: 'Import batch not found', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    if (page < 1) throw new BadRequestException('page must be >= 1');
    if (limit < 1 || limit > 100) throw new BadRequestException('limit must be between 1 and 100');
    return this.importsService.getBatchDetail(id, page, limit);
  }
}
