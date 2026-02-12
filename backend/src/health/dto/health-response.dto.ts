import { ApiProperty } from '@nestjs/swagger';

export class HealthComponentStatusDto {
  @ApiProperty({ example: 'up' })
  status!: string;

  @ApiProperty({ example: '12ms', required: false })
  responseTime?: string;

  @ApiProperty({ example: 'Connection timeout', required: false })
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
