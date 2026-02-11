import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSupplierDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const duplicate = await this.prisma.supplier.findFirst({
      where: { tenantId, name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException('Supplier name already exists');

    const supplier = await this.prisma.supplier.create({
      data: { tenantId, createdBy, ...dto },
    });

    return this.withComputed(supplier);
  }

  async findAll(query: ListSuppliersQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const { page, limit, search, status = 'ACTIVE', sortBy = 'name', sortOrder = 'asc' } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (status !== 'ALL') {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginateResponse(suppliers.map(s => this.withComputed(s)), total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    return this.withComputed(supplier);
  }

  async update(id: string, dto: UpdateSupplierDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Supplier not found');

    if (dto.name && dto.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.prisma.supplier.findFirst({
        where: { tenantId, name: { equals: dto.name, mode: 'insensitive' }, NOT: { id } },
      });
      if (duplicate) throw new ConflictException('Supplier name already exists');
    }

    const updated = await this.prisma.supplier.update({
      where: { id, tenantId },
      data: dto,
    });

    return this.withComputed(updated);
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Supplier not found');

    const updated = await this.prisma.supplier.update({
      where: { id, tenantId },
      data: { status: dto.status },
    });

    return this.withComputed(updated);
  }

  async getBalance(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const result = await this.prisma.$queryRaw<
      Array<{ ap_increase: bigint; ap_decrease: bigint }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END), 0) AS ap_increase,
        COALESCE(SUM(CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END), 0) AS ap_decrease
      FROM ledger_entries
      WHERE tenant_id = ${tenantId}::uuid AND supplier_id = ${id}::uuid
    `;

    const apIncrease = Number(result[0]?.ap_increase ?? 0);
    const apDecrease = Number(result[0]?.ap_decrease ?? 0);

    return {
      supplierId: id,
      totalPurchases: apIncrease,
      totalPaid: apDecrease,
      currentBalance: apIncrease - apDecrease,
    };
  }

  private withComputed(supplier: any) {
    return {
      ...supplier,
      _computed: {
        totalPurchases: 0,
        currentBalance: 0,
        lastPurchaseDate: null,
      },
    };
  }
}
