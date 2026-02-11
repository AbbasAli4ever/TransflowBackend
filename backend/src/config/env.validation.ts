import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  DATABASE_POOL_MIN?: number;

  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  DATABASE_POOL_MAX?: number;

  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  API_PREFIX!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRATION!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRATION!: string;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN!: string;

  @IsInt()
  @Min(1000)
  @IsOptional()
  RATE_LIMIT_WINDOW_MS?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  RATE_LIMIT_MAX_REQUESTS?: number;

  @IsString()
  @IsNotEmpty()
  LOG_LEVEL!: string;

  @IsString()
  @IsNotEmpty()
  LOG_FORMAT!: string;

  @IsString()
  @IsNotEmpty()
  DEFAULT_TIMEZONE!: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Config validation error: ${messages}`);
  }

  return validatedConfig;
}
