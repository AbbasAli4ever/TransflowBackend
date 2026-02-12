import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

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
  @ApiUnauthorizedResponse({ description: 'Invalid credentials', type: ApiErrorResponse })
  @ApiForbiddenResponse({ description: 'Account or tenant inactive', type: ApiErrorResponse })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
