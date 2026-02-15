-- Wave 3 Task 3.1: Enforce case-insensitive name uniqueness per tenant
-- for suppliers and customers, and case-insensitive SKU uniqueness for products.

CREATE UNIQUE INDEX suppliers_tenant_name_ci_unique
  ON suppliers(tenant_id, lower(name));

CREATE UNIQUE INDEX customers_tenant_name_ci_unique
  ON customers(tenant_id, lower(name));

-- Products already have @@unique([tenantId, sku]) (case-sensitive B-tree).
-- Add a functional index to also enforce case-insensitive SKU uniqueness.
CREATE UNIQUE INDEX products_tenant_sku_ci_unique
  ON products(tenant_id, lower(sku));
