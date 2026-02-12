import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorField {
  @ApiProperty({ example: 'name' })
  field!: string;

  @ApiProperty({ example: 'must not be empty' })
  message!: string;
}

export class ApiErrorResponse {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({ type: [ApiErrorField] })
  errors?: ApiErrorField[];

  @ApiProperty({ example: '2026-02-11T12:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/customers' })
  path!: string;

  @ApiPropertyOptional({ example: 'req_123' })
  requestId?: string;
}
