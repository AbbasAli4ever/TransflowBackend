import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class VersionController {
  constructor(private config: ConfigService) {}

  @Public()
  @Get('version')
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
