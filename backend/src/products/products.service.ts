import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    const {
      page,
      limit,
      search,
      status = 'ACTIVE',
      category,
      sortBy = 'name',
      sortOrder = 'asc',
    } = query;
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
        orderBy: { [sortBy]: sortOrder },
        include: { variants: { orderBy: { size: 'asc' } } },
      }),
      this.prisma.product.count({ where }),
    ]);

    if (products.length === 0) return paginateResponse(products, total, page, limit);

    const allVariantIds = products.flatMap((p) => (p.variants ?? []).map((v) => v.id));

    if (allVariantIds.length === 0) return paginateResponse(products, total, page, limit);

    const idsFragment = Prisma.join(allVariantIds.map((id) => Prisma.sql`${id}::uuid`));
    const stockRows = await this.prisma.$queryRaw<
      Array<{ variant_id: string; stock: bigint }>
    >`
      SELECT
        im.variant_id::text AS variant_id,
        COALESCE(SUM(CASE
          WHEN im.movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN')
            THEN im.quantity
          ELSE -im.quantity
        END), 0)::bigint AS stock
      FROM inventory_movements im
      WHERE im.tenant_id = ${tenantId}::uuid
        AND im.variant_id IN (${idsFragment})
      GROUP BY im.variant_id
    `;
    const stockMap = new Map(stockRows.map((r) => [r.variant_id, safeMoney(r.stock)]));

    const data = products.map((p) => {
      const variants = (p.variants ?? []).map((v) => ({
        ...v,
        currentStock: stockMap.get(v.id) ?? 0,
      }));
      const totalStock = variants.reduce((sum, v) => sum + v.currentStock, 0);
      return { ...p, variants, totalStock };
    });

    return paginateResponse(data, total, page, limit);
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

    // Per-variant stock — one batch query instead of N per-variant queries
    if (product.variants.length === 0) {
      return { productId: id, productName: product.name, totalStock: 0, variants: [] };
    }

    const idsFragment = Prisma.join(product.variants.map((v) => Prisma.sql`${v.id}::uuid`));
    const stockRows = await this.prisma.$queryRaw<
      Array<{ variant_id: string; stock: bigint }>
    >`
      SELECT
        variant_id::text AS variant_id,
        COALESCE(SUM(CASE
          WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN') THEN quantity
          ELSE -quantity
        END), 0)::bigint AS stock
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}::uuid
        AND variant_id IN (${idsFragment})
      GROUP BY variant_id
    `;
    const stockMap = new Map(stockRows.map((r) => [r.variant_id, safeMoney(r.stock)]));

    const variantStocks = product.variants.map((v) => ({
      variantId: v.id,
      size: v.size,
      sku: v.sku ?? null,
      currentStock: stockMap.get(v.id) ?? 0,
      avgCost: v.avgCost,
    }));

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

  async getMovements(productId: string, query: { page: number; limit: number }) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');

    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const IN_TYPES = new Set(['PURCHASE_IN', 'ADJUSTMENT_IN', 'CUSTOMER_RETURN_IN']);

    const [countRows, stockBeforeRows, pageRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*)::bigint AS total
        FROM inventory_movements im
        JOIN product_variants pv ON pv.id = im.variant_id
        WHERE im.tenant_id = ${tenantId}::uuid AND pv.product_id = ${productId}::uuid
      `,
      this.prisma.$queryRaw<Array<{ stock_before: bigint }>>`
        SELECT COALESCE(SUM(
          CASE WHEN sub.movement_type IN ('PURCHASE_IN', 'ADJUSTMENT_IN', 'CUSTOMER_RETURN_IN')
               THEN sub.quantity ELSE -sub.quantity END
        ), 0)::bigint AS stock_before
        FROM (
          SELECT im.movement_type, im.quantity
          FROM inventory_movements im
          JOIN product_variants pv ON pv.id = im.variant_id
          WHERE im.tenant_id = ${tenantId}::uuid AND pv.product_id = ${productId}::uuid
          ORDER BY im.transaction_date ASC, im.created_at ASC
          LIMIT ${skip}
        ) sub
      `,
      this.prisma.$queryRaw<
        Array<{ date: Date; documentNumber: string | null; type: string; variantSize: string; quantity: number; movementType: string }>
      >`
        SELECT
          im.transaction_date           AS date,
          t.document_number             AS "documentNumber",
          t.type,
          pv.size                       AS "variantSize",
          im.quantity,
          im.movement_type              AS "movementType"
        FROM inventory_movements im
        JOIN transactions t ON t.id = im.transaction_id
        JOIN product_variants pv ON pv.id = im.variant_id
        WHERE im.tenant_id = ${tenantId}::uuid AND pv.product_id = ${productId}::uuid
        ORDER BY im.transaction_date ASC, im.created_at ASC
        LIMIT ${limit} OFFSET ${skip}
      `,
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    let running = Number(stockBeforeRows[0]?.stock_before ?? 0);

    const data = pageRows.map((row) => {
      const qIn = IN_TYPES.has(row.movementType) ? row.quantity : 0;
      const qOut = IN_TYPES.has(row.movementType) ? 0 : row.quantity;
      running += qIn - qOut;
      return {
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
        documentNumber: row.documentNumber ?? null,
        type: row.type,
        variantSize: row.variantSize,
        quantityIn: qIn,
        quantityOut: qOut,
        runningStock: running,
      };
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async updateVariant(productId: string, variantId: string, dto: { size?: string; sku?: string | null }) {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    const fields = Object.keys(dto).filter((k) => (dto as any)[k] !== undefined);
    if (fields.length === 0) throw new BadRequestException('At least one field must be provided');

    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');

    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, tenantId } });
    if (!variant) throw new NotFoundException('Variant not found');

    try {
      return await this.prisma.productVariant.update({
        where: { id: variantId },
        data: dto,
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
