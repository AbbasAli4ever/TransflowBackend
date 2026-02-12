import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';
import { VersionResponseDto } from './dto/version-response.dto';

@ApiTags('Health')
@Controller()
export class VersionController {
  constructor(private config: ConfigService) {}

  @Public()
  @Get('version')
  @ApiOperation({ summary: 'Build and runtime version info' })
  @ApiOkResponse({ description: 'Version information', type: VersionResponseDto })
  getVersion() {
    return {
      version: this.config.get<string>('app.version') ?? '1.0.0',
      environment: this.config.get<string>('app.nodeEnv') ?? 'development',
      nodeVersion: process.version,
      buildDate: process.env.BUILD_DATE ?? null,
      gitCommit: process.env.GIT_COMMIT ?? null,
    };
  }
}
