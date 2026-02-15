import { Injectable, BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

@Injectable()
export class CsvParserService {
  parse(buffer: Buffer): ParsedFile {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: false,
      }) as Record<string, string>[];
    } catch (err: any) {
      throw new BadRequestException(`Failed to parse CSV: ${err.message}`);
    }

    if (records.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = Object.keys(records[0]);
    return { headers, rows: records };
  }
}
