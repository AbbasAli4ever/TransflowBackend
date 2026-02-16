import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthComponentStatusDto {
  @ApiProperty({ example: 'up' })
  status!: string;

  @ApiPropertyOptional({ type: String, example: '12ms' })
  responseTime?: string;

  @ApiPropertyOptional({ type: String, example: 'Connection timeout' })
  message?: string;
}

export class HealthInfoDto {
  @ApiProperty({ type: HealthComponentStatusDto })
  database!: HealthComponentStatusDto;

  @ApiProperty({ type: HealthComponentStatusDto })
  memory!: HealthComponentStatusDto;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ type: HealthInfoDto })
  info!: HealthInfoDto;

  @ApiProperty({ example: {} })
  error!: Record<string, unknown>;

  @ApiProperty({ type: HealthInfoDto })
  details!: HealthInfoDto;
}
