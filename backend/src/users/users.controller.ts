import { Body, Controller, Get, Param, Patch, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';
import { UserListResponseDto, UserResponseDto } from './dto/user-response.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'List users in the tenant' })
  @ApiOkResponse({ description: 'Paginated user list', type: UserListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Patch(':id/role')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Change user role (OWNER only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiOkResponse({ description: 'Role updated', type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found', type: ApiErrorResponse })
  @ApiForbiddenResponse({ description: 'Cannot change own role', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(id, dto);
  }

  @Patch(':id/status')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Activate or deactivate a user (OWNER only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiOkResponse({ description: 'Status updated', type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found', type: ApiErrorResponse })
  @ApiBadRequestResponse({ description: 'Cannot deactivate last active OWNER', type: ApiErrorResponse })
  @ApiForbiddenResponse({ description: 'Cannot change own status', type: ApiErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ApiErrorResponse })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.usersService.updateStatus(id, dto);
  }
}
