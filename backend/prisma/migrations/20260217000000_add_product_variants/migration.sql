-- CreateTable: product_variants
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "size" TEXT NOT NULL DEFAULT 'one-size',
    "sku" TEXT,
    "avg_cost" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: product_variants → tenants
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: product_variants → products
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: product_variants → users
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: unique (tenant_id, product_id, size)
CREATE UNIQUE INDEX "product_variants_tenant_id_product_id_size_key"
    ON "product_variants"("tenant_id", "product_id", "size");

-- CreateIndex: (tenant_id, product_id)
CREATE INDEX "product_variants_tenant_id_product_id_idx"
    ON "product_variants"("tenant_id", "product_id");

-- DataMigration: seed one default variant per existing product
INSERT INTO "product_variants" ("id", "tenant_id", "product_id", "size", "sku", "avg_cost", "status", "created_by", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    p."tenant_id",
    p."id",
    'one-size',
    p."sku",
    p."avg_cost",
    p."status",
    p."created_by",
    p."created_at",
    NOW()
FROM "products" p;

-- Add variant_id to transaction_lines (nullable first for backfill)
ALTER TABLE "transaction_lines" ADD COLUMN "variant_id" UUID;

-- Backfill: match via product_id → the one-size variant we just created
UPDATE "transaction_lines" tl
SET "variant_id" = pv."id"
FROM "product_variants" pv
WHERE pv."product_id" = tl."product_id";

-- Make variant_id NOT NULL
ALTER TABLE "transaction_lines" ALTER COLUMN "variant_id" SET NOT NULL;

-- AddForeignKey: transaction_lines → product_variants
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop old product FK and column from transaction_lines
ALTER TABLE "transaction_lines" DROP CONSTRAINT "transaction_lines_product_id_fkey";
ALTER TABLE "transaction_lines" DROP COLUMN "product_id";

-- Add variant_id to inventory_movements (nullable first for backfill)
ALTER TABLE "inventory_movements" ADD COLUMN "variant_id" UUID;

-- Backfill: match via product_id → the one-size variant we just created
UPDATE "inventory_movements" im
SET "variant_id" = pv."id"
FROM "product_variants" pv
WHERE pv."product_id" = im."product_id";

-- Make variant_id NOT NULL
ALTER TABLE "inventory_movements" ALTER COLUMN "variant_id" SET NOT NULL;

-- AddForeignKey: inventory_movements → product_variants
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop old index, product FK and column from inventory_movements
DROP INDEX IF EXISTS "inventory_movements_tenant_id_product_id_transaction_date_idx";
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_product_id_fkey";
ALTER TABLE "inventory_movements" DROP COLUMN "product_id";

-- CreateIndex: new variant-based index on inventory_movements
CREATE INDEX "inventory_movements_tenant_id_variant_id_transaction_date_idx"
    ON "inventory_movements"("tenant_id", "variant_id", "transaction_date");

-- Drop avg_cost from products (now lives on product_variants)
ALTER TABLE "products" DROP COLUMN "avg_cost";
