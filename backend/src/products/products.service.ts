import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    try {
      const product = await this.prisma.product.create({
        data: { tenantId, createdBy, ...dto },
      });
      return this.withComputed(product);
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('SKU already exists for this tenant');
      throw err;
    }
  }

  async findAll(query: ListProductsQueryDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const { page, limit, search, status = 'ACTIVE', category } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (status !== 'ALL') {
      where.status = status;
    }

    if (category) {
      where.category = { equals: category, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginateResponse(products.map(p => this.withComputed(p)), total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.withComputed(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Product not found');

    try {
      const updated = await this.prisma.product.update({
        where: { id, tenantId },
        data: dto,
      });
      return this.withComputed(updated);
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('SKU already exists for this tenant');
      throw err;
    }
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id, tenantId },
      data: { status: dto.status },
    });

    return this.withComputed(updated);
  }

  async getStock(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const result = await this.prisma.$queryRaw<Array<{ stock: bigint }>>`
      SELECT COALESCE(SUM(CASE
        WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
        ELSE -quantity
      END), 0) AS stock
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}::uuid AND product_id = ${id}::uuid
    `;

    return {
      productId: id,
      productName: product.name,
      currentStock: Number(result[0]?.stock ?? 0),
      avgCost: product.avgCost,
    };
  }

  private withComputed(product: any) {
    return {
      ...product,
      _computed: {
        currentStock: 0,
        totalPurchased: 0,
        totalSold: 0,
        lastPurchaseDate: null,
        lastSaleDate: null,
      },
    };
  }
}
