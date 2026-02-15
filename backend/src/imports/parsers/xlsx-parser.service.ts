import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ParsedFile } from './csv-parser.service';

@Injectable()
export class XlsxParserService {
  parse(buffer: Buffer): ParsedFile {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err: any) {
      throw new BadRequestException(`Failed to parse XLSX: ${err.message}`);
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { headers: [], rows: [] };
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];

    if (rawRows.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = rawRows[0].map(String);
    const dataRows = rawRows.slice(1);

    const rows: Record<string, string>[] = dataRows
      .filter((row) => row.some((cell) => cell !== undefined && cell !== null && cell !== ''))
      .map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((header, idx) => {
          obj[header] = row[idx] !== undefined && row[idx] !== null ? String(row[idx]) : '';
        });
        return obj;
      });

    return { headers, rows };
  }
}
