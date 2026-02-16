import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VersionResponseDto {
  @ApiProperty({ example: '1.0.0' })
  version!: string;

  @ApiProperty({ example: 'development' })
  environment!: string;

  @ApiProperty({ example: 'v20.10.0' })
  nodeVersion!: string;

  @ApiPropertyOptional({ type: String, example: '2026-02-11T10:00:00.000Z', nullable: true, format: 'date-time' })
  buildDate?: string | null;

  @ApiPropertyOptional({ type: String, example: 'a1b2c3d4', nullable: true })
  gitCommit?: string | null;
}
