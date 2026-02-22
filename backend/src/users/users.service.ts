import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: ListUsersQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const { page, limit, status = 'ACTIVE' } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status !== 'ALL') where.status = status;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          tenantId: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginateResponse(users, total, page, limit);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const actorUserId = getContext()?.userId;

    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('User not found');

    // OWNER cannot change their own role
    if (id === actorUserId) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { role: dto.role },
        select: { id: true, tenantId: true, fullName: true, email: true, role: true, status: true, createdAt: true },
      }),
      this.prisma.statusChangeLog.create({
        data: {
          tenantId,
          entityType: 'USER',
          entityId: id,
          actorUserId: actorUserId ?? null,
          previousStatus: existing.role,
          newStatus: dto.role,
          reason: dto.reason ?? null,
        },
      }),
    ]);

    return updated;
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const actorUserId = getContext()?.userId;

    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('User not found');

    if (id === actorUserId) {
      throw new ForbiddenException('Cannot change your own status');
    }

    // Prevent removing the last active OWNER
    if (dto.status === 'INACTIVE' && existing.role === 'OWNER') {
      const otherActiveOwners = await this.prisma.user.count({
        where: { tenantId, role: 'OWNER', status: 'ACTIVE', id: { not: id } },
      });
      if (otherActiveOwners === 0) {
        throw new BadRequestException('Cannot deactivate the last active OWNER');
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { status: dto.status },
        select: { id: true, tenantId: true, fullName: true, email: true, role: true, status: true, createdAt: true },
      }),
      this.prisma.statusChangeLog.create({
        data: {
          tenantId,
          entityType: 'USER',
          entityId: id,
          actorUserId: actorUserId ?? null,
          previousStatus: existing.status,
          newStatus: dto.status,
          reason: dto.reason ?? null,
        },
      }),
    ]);

    return updated;
  }
}
