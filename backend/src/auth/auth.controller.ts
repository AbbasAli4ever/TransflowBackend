import { Body, Controller, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { AuthResponseDto, LogoutResponseDto, RefreshTokenResponseDto } from './dto/auth-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new tenant and owner user' })
  @ApiCreatedResponse({ description: 'Tenant and owner created', type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiConflictResponse({ description: 'Email already exists', type: ApiErrorResponse })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user and return tokens' })
  @ApiOkResponse({ description: 'Login successful', type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication failed', type: ApiErrorResponse })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiOkResponse({ description: 'New access token issued', type: RefreshTokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token', type: ApiErrorResponse })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiOkResponse({ description: 'Token revoked', type: LogoutResponseDto })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Logged out' };
  }

  @Patch('tenant')
  @Roles('OWNER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tenant settings (name, timezone, baseCurrency)' })
  @ApiOkResponse({ description: 'Tenant updated', schema: { example: { id: 'uuid', name: 'Acme', baseCurrency: 'PKR', timezone: 'Asia/Karachi' } } })
  @ApiBadRequestResponse({ description: 'No fields provided', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  updateTenant(@Body() dto: UpdateTenantDto) {
    return this.authService.updateTenant(dto);
  }
}
