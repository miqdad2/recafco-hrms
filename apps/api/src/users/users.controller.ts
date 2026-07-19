import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':id/reset-password')
  @Permissions('users.resetPassword')
  resetPassword(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.usersService.resetPassword(id, dto, user.userId, getRequestContext(req));
  }
}
