import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TenantSummaryDto {
  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2' })
  id!: string;

  @ApiProperty({ example: 'Acme Trading Co.' })
  name!: string;

  @ApiProperty({ example: 'PKR' })
  baseCurrency!: string;

  @ApiProperty({ example: 'Asia/Karachi' })
  timezone!: string;
}

export class AuthUserDto {
  @ApiProperty({ example: 'd2f2c7b5-0c2a-4aa2-9c60-6b3f94b7e8d4' })
  id!: string;

  @ApiProperty({ example: '6c6f7f48-3d5b-4a3f-9b1d-9c0d73b0c3d2' })
  tenantId!: string;

  @ApiProperty({ example: 'Zaeem Hassan' })
  fullName!: string;

  @ApiProperty({ example: 'zaeem@acme.com' })
  email!: string;

  @ApiProperty({ example: 'OWNER' })
  role!: string;

  @ApiPropertyOptional({ type: TenantSummaryDto })
  tenant?: TenantSummaryDto;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}
