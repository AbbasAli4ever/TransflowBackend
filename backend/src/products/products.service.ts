import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../common/request-context';
import { paginateResponse } from '../common/utils/paginate';
import { safeMoney } from '../common/utils/money';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateStatusDto } from '../common/dto/update-status.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    try {
      const product = await this.prisma.product.create({
        data: {
          tenantId,
          createdBy,
          ...dto,
          variants: { create: [{ tenantId, size: 'one-size', createdBy }] },
        },
        include: { variants: { orderBy: { size: 'asc' } } },
      });
      return product;
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
        include: { variants: { orderBy: { size: 'asc' } } },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginateResponse(products, total, page, limit);
  }

  async findOne(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: { variants: { orderBy: { size: 'asc' } } },
    });
    if (!product) throw new NotFoundException('Product not found');

    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    if (Object.keys(dto).filter((k) => (dto as any)[k] !== undefined).length === 0) {
      throw new BadRequestException('At least one field must be provided for update');
    }

    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Product not found');

    try {
      const updated = await this.prisma.product.update({
        where: { id, tenantId },
        data: dto,
        include: { variants: { orderBy: { size: 'asc' } } },
      });
      return updated;
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

    // Block deactivation when product has positive stock (across any variant)
    if (dto.status === 'INACTIVE') {
      const stockRows = await this.prisma.$queryRaw<Array<{ stock: bigint }>>`
        SELECT COALESCE(SUM(CASE
          WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
          ELSE -quantity
        END), 0)::bigint AS stock
        FROM inventory_movements im
        JOIN product_variants pv ON pv.id = im.variant_id
        WHERE pv.tenant_id = ${tenantId}::uuid AND pv.product_id = ${id}::uuid
      `;
      if (safeMoney(stockRows[0]?.stock) > 0) {
        throw new BadRequestException('Cannot deactivate product with positive stock');
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.product.update({ where: { id, tenantId }, data: { status: dto.status } }),
      this.prisma.statusChangeLog.create({
        data: {
          tenantId,
          entityType: 'PRODUCT',
          entityId: id,
          actorUserId: getContext()?.userId ?? null,
          previousStatus: existing.status,
          newStatus: dto.status,
          reason: dto.reason ?? null,
        },
      }),
    ]);

    return updated;
  }

  async getStock(id: string) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: { variants: { where: { status: 'ACTIVE' }, orderBy: { size: 'asc' } } },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Per-variant stock
    const variantStocks = await Promise.all(
      product.variants.map(async (v) => {
        const result = await this.prisma.$queryRaw<Array<{ stock: bigint }>>`
          SELECT COALESCE(SUM(CASE
            WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
            ELSE -quantity
          END), 0) AS stock
          FROM inventory_movements
          WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${v.id}::uuid
        `;
        return {
          variantId: v.id,
          size: v.size,
          sku: v.sku ?? null,
          currentStock: safeMoney(result[0]?.stock),
          avgCost: v.avgCost,
        };
      }),
    );

    const totalStock = variantStocks.reduce((sum, v) => sum + v.currentStock, 0);

    return {
      productId: id,
      productName: product.name,
      totalStock,
      variants: variantStocks,
    };
  }

  // ─── Variant management ───────────────────────────────────────────────────

  async addVariant(productId: string, dto: CreateProductVariantDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    const createdBy = getContext()?.userId;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    try {
      return await this.prisma.productVariant.create({
        data: {
          tenantId,
          productId,
          size: dto.size,
          sku: dto.sku,
          createdBy,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new ConflictException('A variant with this size already exists for this product');
      throw err;
    }
  }

  async updateVariantStatus(productId: string, variantId: string, dto: UpdateStatusDto) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, tenantId },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    if (dto.status === 'INACTIVE') {
      const stockRows = await this.prisma.$queryRaw<Array<{ stock: bigint }>>`
        SELECT COALESCE(SUM(CASE
          WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
          ELSE -quantity
        END), 0)::bigint AS stock
        FROM inventory_movements
        WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${variantId}::uuid
      `;
      if (safeMoney(stockRows[0]?.stock) > 0) {
        throw new BadRequestException('Cannot deactivate variant with positive stock');
      }
    }

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { status: dto.status },
    });
  }
}
