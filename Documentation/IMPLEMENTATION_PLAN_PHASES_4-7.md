# IMPLEMENTATION PLAN - PHASES 4-7 (CONTINUATION)

**This document continues from IMPLEMENTATION_PLAN.md**

---

## PHASE 4: POSTING ENGINE CORE (PURCHASE + SALE)

### Objective
Build the heart of the accounting system: the posting engine that converts business transactions into immutable entries. This phase proves the entire accounting architecture end-to-end.

### Scope

#### Included in Phase 4
1. Transaction creation (draft mode)
2. Transaction posting engine
3. PURCHASE transaction type (with partial payment)
4. SALE transaction type (with partial payment)
5. Inventory movement generation
6. Ledger entry generation
7. Payment entry generation
8. Allocation logic (auto-allocate to same document)
9. Stock availability checks
10. Concurrency control for stock
11. Weighted average cost calculation
12. Document number generation
13. Idempotency handling
14. Atomic transaction posting

#### Explicitly Excluded from Phase 4
- Standalone payments (Phase 5)
- Returns (Phase 6)
- Internal transfers (Phase 6)
- Adjustments (Phase 6)
- Manual allocation to multiple documents (Phase 5)
- Multi-document payment settlement (Phase 5)

### Critical Business Rules (Non-Negotiable)

#### Rule 1: Posting is Atomic
- All posting operations run in a single database transaction
- If ANY step fails, entire posting rolls back
- Transaction status remains DRAFT if posting fails
- No partial posting allowed

#### Rule 2: Posting is Idempotent
- Every post request must include idempotency_key
- Same idempotency_key returns same result
- Already-posted transaction returns 200 (not 409)
- Idempotency key format: `tenant_id:endpoint:client_request_id`

#### Rule 3: Posted Transactions are Immutable
- Cannot edit posted transaction header
- Cannot edit posted transaction lines
- Cannot delete posted transactions
- Cannot change document_number after posting
- Only correction: void (V1.1) or new reversal transaction

#### Rule 4: No Negative Stock (Default)
- Before posting SALE or SUPPLIER_RETURN, check stock
- Stock check must be concurrency-safe
- Use row-level locks: `SELECT ... FOR UPDATE`
- If insufficient stock: Return 422 with details

#### Rule 5: Balances are Derived
- Never store supplier/customer/account balances directly
- Always compute from entries
- Cache balances in read models (optional, V2)
- Any mismatch between cache and entries: entries win

#### Rule 6: Every Entry References Transaction
- All inventory_movements have transaction_id
- All ledger_entries have transaction_id
- All payment_entries have transaction_id
- All allocations reference transaction_id
- Enable full audit trail

#### Rule 7: Money and Quantity Validations
- All amounts must be positive integers (PKR)
- All quantities must be positive integers
- Calculations must avoid floating point errors
- Rounding: banker's rounding (round half to even)

### Detailed Implementation

#### 4.1 Transaction Draft Creation

**POST /api/v1/transactions/purchases/draft**

Request:
```json
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-02",
  "lines": [
    {
      "productId": "uuid",
      "quantity": 10,
      "unitCost": 5000,
      "discountAmount": 0
    },
    {
      "productId": "uuid",
      "quantity": 5,
      "unitCost": 8000,
      "discountAmount": 500
    }
  ],
  "deliveryFee": 200,
  "notes": "Monthly stock purchase"
}
```

**Validations:**
- supplierId: required, must exist and be ACTIVE
- transactionDate: required, must be valid date, cannot be future date
- lines: required, min 1 line, max 100 lines per transaction
- Each line:
  - productId: required, must exist and be ACTIVE
  - quantity: required, integer > 0
  - unitCost: required, integer >= 0
  - discountAmount: optional, integer >= 0, must be <= line total
- deliveryFee: optional, integer >= 0
- notes: optional, max 1000 chars

**Edge Cases:**
- Future date: Return 400 "Cannot create transaction with future date"
- Inactive supplier: Return 422 "Supplier is inactive"
- Inactive product: Return 422 "Product {name} is inactive"
- Line total calculation overflow: Validate line_total fits in INT
- Duplicate product in lines: Allowed (different batches/prices)
- Zero unit cost: Allowed (free samples)
- Discount > line total: Return 400 "Discount cannot exceed line total"

**Process:**
1. Validate DTO
2. Verify supplier exists and is active
3. Verify all products exist and are active
4. Calculate totals:
   ```typescript
   for each line:
     line.lineTotal = (line.quantity * line.unitCost) - line.discountAmount
     line.costTotal = line.quantity * line.unitCost

   subtotal = SUM(lines.lineTotal)
   discountTotal = SUM(lines.discountAmount)
   totalAmount = subtotal + deliveryFee
   ```
5. Create transaction record (status = DRAFT)
6. Create transaction_lines records
7. Return draft transaction

Response (201):
```json
{
  "id": "uuid",
  "type": "PURCHASE",
  "status": "DRAFT",
  "documentNumber": null,
  "supplierId": "uuid",
  "transactionDate": "2026-02-02",
  "subtotal": 89500,
  "discountTotal": 500,
  "deliveryFee": 200,
  "totalAmount": 89700,
  "paidNow": 0,
  "lines": [
    {
      "id": "uuid",
      "productId": "uuid",
      "productName": "Men Suit - Black",
      "quantity": 10,
      "unitCost": 5000,
      "discountAmount": 0,
      "lineTotal": 50000,
      "costTotal": 50000
    },
    {
      "id": "uuid",
      "productId": "uuid",
      "productName": "Men Suit - Navy",
      "quantity": 5,
      "unitCost": 8000,
      "discountAmount": 500,
      "lineTotal": 39500,
      "costTotal": 40000
    }
  ],
  "notes": "Monthly stock purchase",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z"
}
```

---

#### 4.2 Transaction Posting Engine

**POST /api/v1/transactions/:id/post**

Request:
```json
{
  "idempotencyKey": "tenant-123:post-purchase:client-uuid-456",
  "paidNow": 50000,
  "paymentAccountId": "uuid"
}
```

**Validations:**
- idempotencyKey: required, max 200 chars, unique per tenant
- paidNow: optional, integer >= 0, must be <= totalAmount
- paymentAccountId: required if paidNow > 0
- Transaction must be in DRAFT status
- Transaction must belong to authenticated tenant

**Edge Cases:**
- Already posted: Return 200 with existing posted transaction (idempotent)
- Different idempotencyKey for same transaction: Return 409 "Transaction already posted with different key"
- paidNow > totalAmount: Return 400 "Payment cannot exceed total amount"
- Payment account inactive: Return 422 "Payment account is inactive"
- Concurrent posting attempts: One succeeds, others wait then return 200 (idempotent)

**Posting Process for PURCHASE:**

```typescript
async function postPurchase(transactionId: string, dto: PostPurchaseDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    // 1. Lock transaction for update
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { lines: true },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status === 'POSTED') {
      // Idempotency: already posted
      return transaction;
    }

    if (transaction.status !== 'DRAFT') {
      throw new BadRequestException('Only draft transactions can be posted');
    }

    // 2. Check idempotency key
    const existingPosted = await tx.transaction.findFirst({
      where: {
        tenantId: transaction.tenantId,
        idempotencyKey: dto.idempotencyKey,
        status: 'POSTED',
      },
    });

    if (existingPosted && existingPosted.id !== transactionId) {
      throw new ConflictException('Idempotency key already used for different transaction');
    }

    // 3. Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'PURCHASE',
      new Date().getFullYear().toString()
    );

    // 4. Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        paidNow: dto.paidNow || 0,
        postedAt: new Date(),
      },
    });

    // 5. Create inventory movements (one per line)
    const movements = transaction.lines.map(line => ({
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      transactionLineId: line.id,
      productId: line.productId,
      movementType: 'PURCHASE_IN',
      quantity: line.quantity,
      unitCostAtTime: line.unitCost,
      transactionDate: transaction.transactionDate,
      createdBy: this.getTenantContext().userId,
    }));

    await tx.inventoryMovement.createMany({
      data: movements,
    });

    // 6. Update product average costs
    for (const line of transaction.lines) {
      await this.updateProductAverageCost(
        tx,
        transaction.tenantId,
        line.productId,
        line.quantity,
        line.unitCost
      );
    }

    // 7. Create ledger entry: AP_INCREASE (you owe supplier)
    await tx.ledgerEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        entryType: 'AP_INCREASE',
        supplierId: transaction.supplierId,
        amount: transaction.totalAmount,
        transactionDate: transaction.transactionDate,
        notes: `Purchase ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 8. If payment made now: create payment entries and ledger decrease
    if (dto.paidNow && dto.paidNow > 0) {
      // 8a. Create payment entry: MONEY_OUT
      await tx.paymentEntry.create({
        data: {
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
          paymentAccountId: dto.paymentAccountId,
          entryType: 'MONEY_OUT',
          direction: 'OUT',
          amount: dto.paidNow,
          transactionDate: transaction.transactionDate,
          supplierId: transaction.supplierId,
          notes: `Payment for ${documentNumber}`,
          createdBy: this.getTenantContext().userId,
        },
      });

      // 8b. Create ledger entry: AP_DECREASE (paid portion)
      await tx.ledgerEntry.create({
        data: {
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
          entryType: 'AP_DECREASE',
          supplierId: transaction.supplierId,
          amount: dto.paidNow,
          transactionDate: transaction.transactionDate,
          notes: `Payment for ${documentNumber}`,
          createdBy: this.getTenantContext().userId,
        },
      });

      // 8c. Create allocation (payment applied to this document)
      await tx.allocation.create({
        data: {
          tenantId: transaction.tenantId,
          paymentTransactionId: transaction.id,
          appliesToTransactionId: transaction.id,
          amountApplied: dto.paidNow,
          notes: `Auto-allocation: paid at purchase`,
          createdBy: this.getTenantContext().userId,
        },
      });
    }

    // 9. Log event
    this.logger.info('Purchase posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      totalAmount: transaction.totalAmount,
      paidNow: dto.paidNow,
    });

    // 10. Return full transaction with entries
    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: { include: { product: true } },
        inventoryMovements: true,
        ledgerEntries: true,
        paymentEntries: true,
        allocations: true,
      },
    });
  }, {
    isolationLevel: 'Serializable', // Highest isolation to prevent concurrency issues
    timeout: 10000, // 10 second timeout
  });
}
```

**Document Number Generation:**

```typescript
async function generateDocumentNumber(
  tx: PrismaTransaction,
  tenantId: string,
  type: TransactionType,
  series: string
): Promise<string> {
  // 1. Find last document number for this tenant+type+series
  const lastTransaction = await tx.transaction.findFirst({
    where: {
      tenantId,
      type,
      series,
      documentNumber: { not: null },
      status: 'POSTED',
    },
    orderBy: { documentNumber: 'desc' },
    select: { documentNumber: true },
  });

  // 2. Extract sequence number
  let sequence = 1;
  if (lastTransaction?.documentNumber) {
    // Format: PUR-2026-0001
    const parts = lastTransaction.documentNumber.split('-');
    sequence = parseInt(parts[parts.length - 1], 10) + 1;
  }

  // 3. Generate new number
  const prefix = this.getDocumentPrefix(type);
  const documentNumber = `${prefix}-${series}-${sequence.toString().padStart(4, '0')}`;

  // 4. Verify uniqueness (should be guaranteed by DB constraint)
  const exists = await tx.transaction.findFirst({
    where: {
      tenantId,
      type,
      series,
      documentNumber,
    },
  });

  if (exists) {
    throw new ConflictException('Document number collision detected');
  }

  return documentNumber;
}

function getDocumentPrefix(type: TransactionType): string {
  const prefixes = {
    PURCHASE: 'PUR',
    SALE: 'SAL',
    SUPPLIER_PAYMENT: 'SPY',
    CUSTOMER_PAYMENT: 'CPY',
    SUPPLIER_RETURN: 'SRN',
    CUSTOMER_RETURN: 'CRN',
    INTERNAL_TRANSFER: 'TRF',
  };
  return prefixes[type];
}
```

**Weighted Average Cost Calculation:**

```typescript
async function updateProductAverageCost(
  tx: PrismaTransaction,
  tenantId: string,
  productId: string,
  purchaseQty: number,
  purchaseCost: number
): Promise<void> {
  // 1. Get current stock and avg cost
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { avgCost: true },
  });

  // 2. Calculate current stock from movements
  const currentStock = await this.calculateProductStock(tx, tenantId, productId);

  // 3. Calculate new weighted average
  const oldValue = currentStock * product.avgCost;
  const newValue = purchaseQty * purchaseCost;
  const newQty = currentStock + purchaseQty;

  const newAvgCost = newQty > 0 ? Math.round((oldValue + newValue) / newQty) : 0;

  // 4. Update product
  await tx.product.update({
    where: { id: productId },
    data: { avgCost: newAvgCost },
  });

  this.logger.debug('Product average cost updated', {
    productId,
    oldAvgCost: product.avgCost,
    newAvgCost,
    oldStock: currentStock,
    newStock: newQty,
  });
}

async function calculateProductStock(
  tx: PrismaTransaction,
  tenantId: string,
  productId: string
): Promise<number> {
  // Sum all inventory movements
  const movements = await tx.inventoryMovement.findMany({
    where: {
      tenantId,
      productId,
    },
    select: {
      movementType: true,
      quantity: true,
    },
  });

  let stock = 0;
  for (const movement of movements) {
    switch (movement.movementType) {
      case 'PURCHASE_IN':
      case 'CUSTOMER_RETURN_IN':
      case 'ADJUSTMENT_IN':
        stock += movement.quantity;
        break;
      case 'SALE_OUT':
      case 'SUPPLIER_RETURN_OUT':
      case 'ADJUSTMENT_OUT':
        stock -= movement.quantity;
        break;
    }
  }

  return stock;
}
```

Response (200):
```json
{
  "id": "uuid",
  "type": "PURCHASE",
  "status": "POSTED",
  "documentNumber": "PUR-2026-0001",
  "supplierId": "uuid",
  "supplier": {
    "id": "uuid",
    "name": "ABC Textiles"
  },
  "transactionDate": "2026-02-02",
  "subtotal": 89500,
  "discountTotal": 500,
  "deliveryFee": 200,
  "totalAmount": 89700,
  "paidNow": 50000,
  "outstandingAmount": 39700,
  "lines": [...],
  "inventoryMovements": [
    {
      "id": "uuid",
      "productId": "uuid",
      "movementType": "PURCHASE_IN",
      "quantity": 10,
      "unitCostAtTime": 5000
    },
    {
      "id": "uuid",
      "productId": "uuid",
      "movementType": "PURCHASE_IN",
      "quantity": 5,
      "unitCostAtTime": 8000
    }
  ],
  "ledgerEntries": [
    {
      "id": "uuid",
      "entryType": "AP_INCREASE",
      "amount": 89700,
      "notes": "Purchase PUR-2026-0001"
    },
    {
      "id": "uuid",
      "entryType": "AP_DECREASE",
      "amount": 50000,
      "notes": "Payment for PUR-2026-0001"
    }
  ],
  "paymentEntries": [
    {
      "id": "uuid",
      "paymentAccountId": "uuid",
      "entryType": "MONEY_OUT",
      "amount": 50000
    }
  ],
  "postedAt": "2026-02-02T10:35:00.000Z",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z"
}
```

---

#### 4.3 SALE Transaction with Stock Check

**POST /api/v1/transactions/sales/draft**

Request:
```json
{
  "customerId": "uuid",
  "transactionDate": "2026-02-02",
  "deliveryType": "HOME_DELIVERY",
  "deliveryAddress": "123 Customer Street",
  "deliveryFee": 300,
  "lines": [
    {
      "productId": "uuid",
      "quantity": 2,
      "unitPrice": 7000,
      "discountAmount": 200
    }
  ],
  "notes": "Customer requested urgent delivery"
}
```

**Validations:**
- Similar to purchase
- deliveryType: optional, enum: STORE_PICKUP, HOME_DELIVERY
- deliveryAddress: required if deliveryType = HOME_DELIVERY
- unitPrice (not unitCost): the selling price

**Process:** Same as purchase draft creation

---

**POST /api/v1/transactions/:id/post (SALE)**

Request:
```json
{
  "idempotencyKey": "tenant-123:post-sale:client-uuid-789",
  "receivedNow": 10000,
  "paymentAccountId": "uuid"
}
```

**Posting Process for SALE:**

```typescript
async function postSale(transactionId: string, dto: PostSaleDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    // 1-3. Lock transaction, check status, check idempotency (same as purchase)

    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { lines: { include: { product: true } } },
    });

    // ... status checks ...

    // 4. CRITICAL: Check stock availability with row locks
    for (const line of transaction.lines) {
      // Lock product row to prevent concurrent sales
      const product = await tx.product.findUnique({
        where: { id: line.productId },
      });

      // Calculate current stock
      const currentStock = await this.calculateProductStock(
        tx,
        transaction.tenantId,
        line.productId
      );

      if (currentStock < line.quantity) {
        throw new UnprocessableEntityException({
          message: 'Insufficient stock',
          productId: line.productId,
          productName: product.name,
          requested: line.quantity,
          available: currentStock,
        });
      }
    }

    // 5. Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'SALE',
      new Date().getFullYear().toString()
    );

    // 6. Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        paidNow: dto.receivedNow || 0,
        postedAt: new Date(),
      },
    });

    // 7. Create inventory movements: SALE_OUT
    const movements = transaction.lines.map(line => ({
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      transactionLineId: line.id,
      productId: line.productId,
      movementType: 'SALE_OUT',
      quantity: line.quantity,
      unitCostAtTime: line.product.avgCost, // Record cost for profit calc
      transactionDate: transaction.transactionDate,
      createdBy: this.getTenantContext().userId,
    }));

    await tx.inventoryMovement.createMany({ data: movements });

    // 8. Create ledger entry: AR_INCREASE (customer owes you)
    await tx.ledgerEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        entryType: 'AR_INCREASE',
        customerId: transaction.customerId,
        amount: transaction.totalAmount,
        transactionDate: transaction.transactionDate,
        notes: `Sale ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 9. If payment received now: create payment entries and ledger decrease
    if (dto.receivedNow && dto.receivedNow > 0) {
      // Payment entry: MONEY_IN
      await tx.paymentEntry.create({
        data: {
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
          paymentAccountId: dto.paymentAccountId,
          entryType: 'MONEY_IN',
          direction: 'IN',
          amount: dto.receivedNow,
          transactionDate: transaction.transactionDate,
          customerId: transaction.customerId,
          notes: `Payment for ${documentNumber}`,
          createdBy: this.getTenantContext().userId,
        },
      });

      // Ledger entry: AR_DECREASE
      await tx.ledgerEntry.create({
        data: {
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
          entryType: 'AR_DECREASE',
          customerId: transaction.customerId,
          amount: dto.receivedNow,
          transactionDate: transaction.transactionDate,
          notes: `Payment for ${documentNumber}`,
          createdBy: this.getTenantContext().userId,
        },
      });

      // Allocation
      await tx.allocation.create({
        data: {
          tenantId: transaction.tenantId,
          paymentTransactionId: transaction.id,
          appliesToTransactionId: transaction.id,
          amountApplied: dto.receivedNow,
          notes: `Auto-allocation: received at sale`,
          createdBy: this.getTenantContext().userId,
        },
      });
    }

    // 10. Log event
    this.logger.info('Sale posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      totalAmount: transaction.totalAmount,
      receivedNow: dto.receivedNow,
    });

    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: { include: { product: true } },
        inventoryMovements: true,
        ledgerEntries: true,
        paymentEntries: true,
        allocations: true,
      },
    });
  }, {
    isolationLevel: 'Serializable',
    timeout: 10000,
  });
}
```

**Concurrency Handling:**

To prevent race conditions where two sales try to sell the same stock:

```typescript
// Option 1: Use database row-level locks
const product = await tx.$queryRaw`
  SELECT * FROM products
  WHERE id = ${productId} AND tenant_id = ${tenantId}
  FOR UPDATE
`;

// Option 2: Optimistic locking with version field
// Add version field to products table
// Increment on every update
// Retry transaction if version mismatch

// Option 3: Serializable isolation level (already using)
// Postgres will detect conflicts and abort one transaction
```

**Error Response for Insufficient Stock (422):**

```json
{
  "statusCode": 422,
  "message": "Insufficient stock",
  "errors": [
    {
      "productId": "uuid",
      "productName": "Men Suit - Black",
      "requested": 5,
      "available": 3
    }
  ],
  "timestamp": "2026-02-02T10:40:00.000Z",
  "path": "/api/v1/transactions/abc-123/post"
}
```

---

#### 4.4 Query Endpoints (Read Operations)

**GET /api/v1/transactions**

Query Parameters:
- type: PURCHASE | SALE | ALL
- status: DRAFT | POSTED | ALL
- dateFrom: date
- dateTo: date
- supplierId: uuid
- customerId: uuid
- page, limit, sortBy, sortOrder

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "PURCHASE",
      "status": "POSTED",
      "documentNumber": "PUR-2026-0001",
      "supplier": { "id": "uuid", "name": "ABC Textiles" },
      "transactionDate": "2026-02-02",
      "totalAmount": 89700,
      "paidNow": 50000,
      "outstandingAmount": 39700,
      "createdAt": "2026-02-02T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

**GET /api/v1/transactions/:id**

Response:
```json
{
  "id": "uuid",
  "type": "PURCHASE",
  "status": "POSTED",
  "documentNumber": "PUR-2026-0001",
  "supplier": {
    "id": "uuid",
    "name": "ABC Textiles",
    "phone": "+92-300-1234567"
  },
  "transactionDate": "2026-02-02",
  "subtotal": 89500,
  "discountTotal": 500,
  "deliveryFee": 200,
  "totalAmount": 89700,
  "paidNow": 50000,
  "outstandingAmount": 39700,
  "lines": [
    {
      "id": "uuid",
      "product": {
        "id": "uuid",
        "name": "Men Suit - Black",
        "sku": "SUIT-BLK-001"
      },
      "quantity": 10,
      "unitCost": 5000,
      "discountAmount": 0,
      "lineTotal": 50000
    },
    {
      "id": "uuid",
      "product": {
        "id": "uuid",
        "name": "Men Suit - Navy",
        "sku": "SUIT-NAV-001"
      },
      "quantity": 5,
      "unitCost": 8000,
      "discountAmount": 500,
      "lineTotal": 39500
    }
  ],
  "inventoryMovements": [
    {
      "id": "uuid",
      "product": { "name": "Men Suit - Black" },
      "movementType": "PURCHASE_IN",
      "quantity": 10,
      "unitCostAtTime": 5000,
      "createdAt": "2026-02-02T10:35:00.000Z"
    }
  ],
  "ledgerEntries": [
    {
      "id": "uuid",
      "entryType": "AP_INCREASE",
      "amount": 89700,
      "notes": "Purchase PUR-2026-0001",
      "createdAt": "2026-02-02T10:35:00.000Z"
    },
    {
      "id": "uuid",
      "entryType": "AP_DECREASE",
      "amount": 50000,
      "notes": "Payment for PUR-2026-0001",
      "createdAt": "2026-02-02T10:35:00.000Z"
    }
  ],
  "paymentEntries": [
    {
      "id": "uuid",
      "paymentAccount": { "name": "Cash" },
      "entryType": "MONEY_OUT",
      "amount": 50000,
      "createdAt": "2026-02-02T10:35:00.000Z"
    }
  ],
  "notes": "Monthly stock purchase",
  "postedAt": "2026-02-02T10:35:00.000Z",
  "createdBy": "uuid",
  "createdAt": "2026-02-02T10:30:00.000Z"
}
```

---

**GET /api/v1/products/:id/stock**

Response:
```json
{
  "productId": "uuid",
  "productName": "Men Suit - Black",
  "sku": "SUIT-BLK-001",
  "currentStock": 23,
  "avgCost": 5200,
  "movements": [
    {
      "date": "2026-02-02",
      "type": "PURCHASE_IN",
      "quantity": 10,
      "documentNumber": "PUR-2026-0001",
      "balance": 10
    },
    {
      "date": "2026-02-03",
      "type": "SALE_OUT",
      "quantity": 2,
      "documentNumber": "SAL-2026-0001",
      "balance": 8
    },
    {
      "date": "2026-02-04",
      "type": "PURCHASE_IN",
      "quantity": 15,
      "documentNumber": "PUR-2026-0002",
      "balance": 23
    }
  ]
}
```

---

**GET /api/v1/suppliers/:id/balance**

Response:
```json
{
  "supplierId": "uuid",
  "supplierName": "ABC Textiles",
  "balance": 39700,
  "balanceType": "PAYABLE",
  "breakdown": {
    "totalPurchases": 89700,
    "totalPayments": 50000,
    "totalReturns": 0,
    "netPayable": 39700
  },
  "openDocuments": [
    {
      "documentNumber": "PUR-2026-0001",
      "date": "2026-02-02",
      "totalAmount": 89700,
      "paidAmount": 50000,
      "outstandingAmount": 39700
    }
  ]
}
```

Calculation:
```sql
SELECT
  SUM(CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END) -
  SUM(CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END) as balance
FROM ledger_entries
WHERE tenant_id = ? AND supplier_id = ?
```

---

**GET /api/v1/customers/:id/balance**

Similar to supplier balance, but for AR (receivables).

---

**GET /api/v1/payment-accounts/:id/balance**

Response:
```json
{
  "accountId": "uuid",
  "accountName": "Cash",
  "accountType": "CASH",
  "balance": 450000,
  "breakdown": {
    "openingBalance": 0,
    "totalIn": 500000,
    "totalOut": 50000,
    "currentBalance": 450000
  }
}
```

Calculation:
```sql
SELECT
  opening_balance +
  SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END) -
  SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END) as balance
FROM payment_accounts pa
LEFT JOIN payment_entries pe ON pe.payment_account_id = pa.id
WHERE pa.id = ? AND pa.tenant_id = ?
GROUP BY pa.id
```

### Testing Strategy - Phase 4

#### Integration Test: Full Purchase Flow

```typescript
describe('Purchase Flow (Integration)', () => {
  it('should complete full purchase with partial payment', async () => {
    // Setup
    const { token, tenant } = await createTestTenantAndUser(app);
    const supplier = await createTestSupplier(tenant.id);
    const product = await createTestProduct(tenant.id);
    const cashAccount = await createTestPaymentAccount(tenant.id, 'CASH');

    // 1. Create draft purchase
    const draftResponse = await request(app.getHttpServer())
      .post('/api/v1/transactions/purchases/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        transactionDate: '2026-02-02',
        lines: [
          {
            productId: product.id,
            quantity: 10,
            unitCost: 5000,
          },
        ],
      })
      .expect(201);

    expect(draftResponse.body.status).toBe('DRAFT');
    expect(draftResponse.body.totalAmount).toBe(50000);

    // 2. Post the transaction
    const postResponse = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftResponse.body.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: `test-${Date.now()}`,
        paidNow: 30000,
        paymentAccountId: cashAccount.id,
      })
      .expect(200);

    expect(postResponse.body.status).toBe('POSTED');
    expect(postResponse.body.documentNumber).toMatch(/PUR-2026-\d{4}/);
    expect(postResponse.body.paidNow).toBe(30000);
    expect(postResponse.body.outstandingAmount).toBe(20000);

    // 3. Verify inventory movements created
    expect(postResponse.body.inventoryMovements).toHaveLength(1);
    expect(postResponse.body.inventoryMovements[0]).toMatchObject({
      productId: product.id,
      movementType: 'PURCHASE_IN',
      quantity: 10,
      unitCostAtTime: 5000,
    });

    // 4. Verify ledger entries created
    expect(postResponse.body.ledgerEntries).toHaveLength(2);
    const apIncrease = postResponse.body.ledgerEntries.find(e => e.entryType === 'AP_INCREASE');
    const apDecrease = postResponse.body.ledgerEntries.find(e => e.entryType === 'AP_DECREASE');
    expect(apIncrease.amount).toBe(50000);
    expect(apDecrease.amount).toBe(30000);

    // 5. Verify payment entry created
    expect(postResponse.body.paymentEntries).toHaveLength(1);
    expect(postResponse.body.paymentEntries[0]).toMatchObject({
      paymentAccountId: cashAccount.id,
      entryType: 'MONEY_OUT',
      amount: 30000,
    });

    // 6. Verify supplier balance
    const balanceResponse = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(balanceResponse.body.balance).toBe(20000);

    // 7. Verify payment account balance
    const accountBalanceResponse = await request(app.getHttpServer())
      .get(`/api/v1/payment-accounts/${cashAccount.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(accountBalanceResponse.body.balance).toBe(-30000); // Money went out

    // 8. Verify product stock
    const stockResponse = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(stockResponse.body.currentStock).toBe(10);

    // 9. Verify product avg cost updated
    const productResponse = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(productResponse.body.avgCost).toBe(5000);
  });
});
```

#### Integration Test: Full Sale Flow with Stock Check

```typescript
describe('Sale Flow (Integration)', () => {
  it('should complete full sale with stock validation', async () => {
    // Setup
    const { token, tenant } = await createTestTenantAndUser(app);
    const customer = await createTestCustomer(tenant.id);
    const product = await createTestProduct(tenant.id);
    const cashAccount = await createTestPaymentAccount(tenant.id, 'CASH');

    // Add stock first (via purchase)
    await createAndPostPurchase(tenant.id, product.id, 10, 5000);

    // Create and post sale
    const draftResponse = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer.id,
        transactionDate: '2026-02-02',
        deliveryType: 'HOME_DELIVERY',
        deliveryAddress: '123 Test St',
        deliveryFee: 200,
        lines: [
          {
            productId: product.id,
            quantity: 3,
            unitPrice: 7000,
          },
        ],
      })
      .expect(201);

    expect(draftResponse.body.totalAmount).toBe(21200); // 3*7000 + 200

    const postResponse = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftResponse.body.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: `test-${Date.now()}`,
        receivedNow: 20000,
        paymentAccountId: cashAccount.id,
      })
      .expect(200);

    expect(postResponse.body.status).toBe('POSTED');

    // Verify stock reduced
    const stockResponse = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(stockResponse.body.currentStock).toBe(7); // 10 - 3

    // Verify customer balance
    const balanceResponse = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customer.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(balanceResponse.body.balance).toBe(1200); // 21200 - 20000
  });

  it('should reject sale with insufficient stock', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const customer = await createTestCustomer(tenant.id);
    const product = await createTestProduct(tenant.id);

    // Add only 5 units of stock
    await createAndPostPurchase(tenant.id, product.id, 5, 5000);

    // Attempt to sell 10 units
    const draftResponse = await request(app.getHttpServer())
      .post('/api/v1/transactions/sales/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: customer.id,
        transactionDate: '2026-02-02',
        lines: [
          {
            productId: product.id,
            quantity: 10, // More than available
            unitPrice: 7000,
          },
        ],
      })
      .expect(201);

    const postResponse = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draftResponse.body.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: `test-${Date.now()}`,
        receivedNow: 0,
      })
      .expect(422);

    expect(postResponse.body.message).toBe('Insufficient stock');
    expect(postResponse.body.errors[0]).toMatchObject({
      productId: product.id,
      requested: 10,
      available: 5,
    });
  });
});
```

#### Concurrency Test

```typescript
describe('Concurrent Sales (Stock Safety)', () => {
  it('should prevent overselling with concurrent requests', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const customer1 = await createTestCustomer(tenant.id, 'Customer 1');
    const customer2 = await createTestCustomer(tenant.id, 'Customer 2');
    const product = await createTestProduct(tenant.id);

    // Add 10 units of stock
    await createAndPostPurchase(tenant.id, product.id, 10, 5000);

    // Create two draft sales for 6 units each
    const draft1 = await createSaleDraft(token, customer1.id, product.id, 6);
    const draft2 = await createSaleDraft(token, customer2.id, product.id, 6);

    // Post both simultaneously
    const [result1, result2] = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft1.id}/post`)
        .set('Authorization', `Bearer ${token}`)
        .send({ idempotencyKey: `test-1-${Date.now()}` }),
      request(app.getHttpServer())
        .post(`/api/v1/transactions/${draft2.id}/post`)
        .set('Authorization', `Bearer ${token}`)
        .send({ idempotencyKey: `test-2-${Date.now()}` }),
    ]);

    // One should succeed, one should fail
    const succeeded = [result1, result2].filter(r => r.status === 'fulfilled' && r.value.status === 200);
    const failed = [result1, result2].filter(r => r.status === 'fulfilled' && r.value.status === 422);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // Verify final stock is 4 (10 - 6)
    const stock = await getProductStock(token, product.id);
    expect(stock).toBe(4);
  });
});
```

#### Idempotency Test

```typescript
describe('Posting Idempotency', () => {
  it('should return same result for duplicate post requests', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const supplier = await createTestSupplier(tenant.id);
    const product = await createTestProduct(tenant.id);

    const draft = await createPurchaseDraft(token, supplier.id, product.id, 10, 5000);

    const idempotencyKey = `test-idem-${Date.now()}`;

    // Post first time
    const response1 = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draft.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey })
      .expect(200);

    const documentNumber1 = response1.body.documentNumber;

    // Post second time with same idempotency key
    const response2 = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draft.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey })
      .expect(200);

    // Should return same transaction
    expect(response2.body.id).toBe(response1.body.id);
    expect(response2.body.documentNumber).toBe(documentNumber1);

    // Verify only one set of entries created
    const movements = await prisma.inventoryMovement.findMany({
      where: { transactionId: draft.id },
    });
    expect(movements).toHaveLength(1);
  });

  it('should reject posting with different idempotency key', async () => {
    const { token } = await createTestTenantAndUser(app);
    const draft = await createPurchaseDraft(token, ...);

    // Post first time
    await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draft.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'key-1' })
      .expect(200);

    // Attempt to post with different key
    await request(app.getHttpServer())
      .post(`/api/v1/transactions/${draft.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: 'key-2' })
      .expect(409);
  });
});
```

### Deliverables - Phase 4

#### Code Artifacts
- [ ] Transaction service with posting engine
- [ ] Purchase posting implementation
- [ ] Sale posting implementation with stock check
- [ ] Document number generation service
- [ ] Weighted average cost calculation
- [ ] Stock calculation service
- [ ] Balance calculation services (supplier/customer/account)
- [ ] Idempotency middleware
- [ ] Concurrency control implementation
- [ ] Transaction query endpoints
- [ ] Balance query endpoints

#### Documentation
- [ ] Posting patterns documented
- [ ] Stock calculation formula documented
- [ ] Weighted average cost formula documented
- [ ] Idempotency behavior documented
- [ ] Error handling for posting failures
- [ ] Concurrency handling strategy

#### Tests
- [ ] Purchase posting integration tests
- [ ] Sale posting integration tests
- [ ] Stock check validation tests
- [ ] Concurrency safety tests
- [ ] Idempotency tests
- [ ] Balance calculation tests
- [ ] Document number generation tests
- [ ] Edge case tests (zero cost, zero payment, etc.)

### Acceptance Criteria - Phase 4

**Must Pass:**
- [ ] Can create and post purchase with partial payment
- [ ] Can create and post sale with partial payment
- [ ] Stock increases on purchase
- [ ] Stock decreases on sale
- [ ] Cannot sell more than available stock
- [ ] Weighted average cost updates correctly
- [ ] Supplier balance calculates correctly
- [ ] Customer balance calculates correctly
- [ ] Payment account balance calculates correctly
- [ ] Document numbers are unique and sequential
- [ ] Idempotency prevents duplicate posting
- [ ] Concurrent sales don't oversell
- [ ] All entries reference transaction
- [ ] Posted transactions cannot be edited
- [ ] All timestamps recorded correctly
- [ ] All error messages are clear
- [ ] All integration tests passing
- [ ] No data corruption under concurrent load

**Performance Benchmarks:**
- [ ] Post purchase transaction < 500ms
- [ ] Post sale transaction < 500ms (including stock check)
- [ ] Balance calculation < 100ms
- [ ] Stock calculation < 50ms
- [ ] Concurrent posting handles 10 simultaneous requests

---

## PHASE 5: STANDALONE PAYMENTS + ALLOCATIONS (Settlement Engine)

### Objective
Implement the ability to make payments independently of purchases/sales, and properly allocate those payments to outstanding documents. This enables flexible payment terms and installment payments.

### Scope

#### Included in Phase 5
1. Supplier payment transaction (standalone)
2. Customer payment transaction (standalone)
3. Manual allocation to specific documents
4. Auto-allocation (oldest-first)
5. Overpayment handling (credit balance)
6. Underpayment tracking
7. Payment allocation constraints
8. Open documents query (pending invoices/bills)
9. Allocation history query
10. Settlement reports

#### Explicitly Excluded from Phase 5
- Returns (Phase 6)
- Internal transfers (Phase 6)
- Void/reversal transactions (V1.1)
- Multi-currency payments (V2)

### Critical Business Rules

#### Rule 1: Allocation Constraints
- Total amount allocated from a payment ≤ payment amount
- Total amount allocated to a document ≤ document total
- Cannot allocate to fully paid document
- Cannot allocate negative amounts

#### Rule 2: Credit Handling
- If payment > total allocated: Remaining = credit balance
- Credit balance appears as negative AR (for customers) or negative AP (for suppliers)
- Credit can be used for future documents

#### Rule 3: Settlement Logic
- User can manually select which documents to pay
- Or system can auto-allocate to oldest unpaid documents first
- Partial allocation allowed (pay part of a document)
- Allocation can be across multiple documents

#### Rule 4: Outstanding Calculation
```
Document Outstanding =
  Document Total Amount -
  SUM(all allocations to this document)
```

### Detailed Implementation

#### 5.1 Supplier Payment (Standalone)

**POST /api/v1/transactions/supplier-payments/draft**

Request:
```json
{
  "supplierId": "uuid",
  "amount": 50000,
  "paymentAccountId": "uuid",
  "transactionDate": "2026-02-05",
  "allocations": [
    {
      "purchaseId": "uuid",
      "amount": 30000
    },
    {
      "purchaseId": "uuid",
      "amount": 20000
    }
  ],
  "notes": "Monthly supplier payment"
}
```

**Validations:**
- supplierId: required, must exist and be ACTIVE
- amount: required, integer > 0
- paymentAccountId: required, must exist and be ACTIVE
- transactionDate: required, valid date, not future
- allocations: optional array
  - Each allocation:
    - purchaseId: must be PURCHASE type, POSTED status, same supplier
    - amount: integer > 0, <= outstanding amount of that purchase
- Total allocation amounts <= payment amount

**Edge Cases:**
- Payment without allocations: Allowed (creates supplier credit)
- Payment exceeds outstanding: Allowed (creates supplier credit)
- Allocate to already paid document: Return 422 "Document fully paid"
- Allocate to wrong supplier: Return 400 "Document belongs to different supplier"
- Multiple allocations to same document: Allowed (cumulative)

**Process:**
1. Validate DTO
2. Verify supplier active
3. Verify payment account active
4. If allocations provided:
   - Verify each purchase belongs to this supplier
   - Verify each purchase is posted
   - Calculate outstanding for each purchase
   - Verify allocation amount <= outstanding
   - Verify SUM(allocations) <= payment amount
5. Create transaction (type = SUPPLIER_PAYMENT, status = DRAFT)
6. Return draft

---

**POST /api/v1/transactions/:id/post (SUPPLIER_PAYMENT)**

**Posting Process:**

```typescript
async function postSupplierPayment(transactionId: string, dto: PostPaymentDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { supplier: true },
    });

    // Standard checks: status, idempotency

    // 1. Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'SUPPLIER_PAYMENT',
      new Date().getFullYear().toString()
    );

    // 2. Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        postedAt: new Date(),
      },
    });

    // 3. Create payment entry: MONEY_OUT
    await tx.paymentEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        paymentAccountId: transaction.paymentAccountId,
        entryType: 'MONEY_OUT',
        direction: 'OUT',
        amount: transaction.totalAmount,
        transactionDate: transaction.transactionDate,
        supplierId: transaction.supplierId,
        notes: `Supplier payment ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 4. Create ledger entry: AP_DECREASE
    await tx.ledgerEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        entryType: 'AP_DECREASE',
        supplierId: transaction.supplierId,
        amount: transaction.totalAmount,
        transactionDate: transaction.transactionDate,
        notes: `Supplier payment ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 5. Create allocations
    const allocations = await this.getAllocationsForTransaction(
      tx,
      transaction.id
    );

    if (allocations && allocations.length > 0) {
      // Manual allocations provided
      for (const alloc of allocations) {
        await tx.allocation.create({
          data: {
            tenantId: transaction.tenantId,
            paymentTransactionId: transaction.id,
            appliesToTransactionId: alloc.purchaseId,
            amountApplied: alloc.amount,
            notes: 'Manual allocation',
            createdBy: this.getTenantContext().userId,
          },
        });
      }
    } else {
      // Auto-allocate to oldest unpaid purchases
      await this.autoAllocateSupplierPayment(
        tx,
        transaction.tenantId,
        transaction.supplierId,
        transaction.id,
        transaction.totalAmount,
        transaction.transactionDate
      );
    }

    // 6. Log event
    this.logger.info('Supplier payment posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      amount: transaction.totalAmount,
    });

    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        supplier: true,
        paymentEntries: true,
        ledgerEntries: true,
        allocations: {
          include: {
            appliesToTransaction: {
              select: {
                id: true,
                documentNumber: true,
                totalAmount: true,
              },
            },
          },
        },
      },
    });
  });
}
```

**Auto-Allocation Logic:**

```typescript
async function autoAllocateSupplierPayment(
  tx: PrismaTransaction,
  tenantId: string,
  supplierId: string,
  paymentTransactionId: string,
  paymentAmount: number,
  paymentDate: Date
): Promise<void> {
  // 1. Find all unpaid/partially paid purchases for this supplier
  const openPurchases = await this.getOpenPurchasesForSupplier(
    tx,
    tenantId,
    supplierId,
    paymentDate
  );

  // openPurchases = [
  //   { id, documentNumber, totalAmount, paidAmount, outstanding, transactionDate },
  //   ...
  // ]

  // Sort by date (oldest first)
  openPurchases.sort((a, b) =>
    a.transactionDate.getTime() - b.transactionDate.getTime()
  );

  // 2. Allocate payment to documents (oldest first)
  let remainingPayment = paymentAmount;

  for (const purchase of openPurchases) {
    if (remainingPayment <= 0) break;

    const amountToAllocate = Math.min(remainingPayment, purchase.outstanding);

    await tx.allocation.create({
      data: {
        tenantId,
        paymentTransactionId,
        appliesToTransactionId: purchase.id,
        amountApplied: amountToAllocate,
        notes: `Auto-allocation (oldest first)`,
        createdBy: this.getTenantContext().userId,
      },
    });

    remainingPayment -= amountToAllocate;

    this.logger.debug('Auto-allocated payment', {
      purchaseId: purchase.id,
      documentNumber: purchase.documentNumber,
      allocated: amountToAllocate,
      remaining: remainingPayment,
    });
  }

  // 3. If remaining payment > 0, it becomes supplier credit
  if (remainingPayment > 0) {
    this.logger.info('Supplier overpayment (credit created)', {
      supplierId,
      creditAmount: remainingPayment,
    });
  }
}
```

**Get Open Purchases Query:**

```typescript
async function getOpenPurchasesForSupplier(
  tx: PrismaTransaction,
  tenantId: string,
  supplierId: string,
  asOfDate: Date
): Promise<OpenPurchase[]> {
  // Complex query to calculate outstanding per purchase
  const purchases = await tx.$queryRaw<OpenPurchase[]>`
    SELECT
      t.id,
      t.document_number,
      t.transaction_date,
      t.total_amount,
      COALESCE(SUM(a.amount_applied), 0) as paid_amount,
      t.total_amount - COALESCE(SUM(a.amount_applied), 0) as outstanding
    FROM transactions t
    LEFT JOIN allocations a ON a.applies_to_transaction_id = t.id
    WHERE
      t.tenant_id = ${tenantId}
      AND t.supplier_id = ${supplierId}
      AND t.type = 'PURCHASE'
      AND t.status = 'POSTED'
      AND t.transaction_date <= ${asOfDate}
    GROUP BY t.id, t.document_number, t.transaction_date, t.total_amount
    HAVING t.total_amount - COALESCE(SUM(a.amount_applied), 0) > 0
    ORDER BY t.transaction_date ASC
  `;

  return purchases;
}
```

Response (200):
```json
{
  "id": "uuid",
  "type": "SUPPLIER_PAYMENT",
  "status": "POSTED",
  "documentNumber": "SPY-2026-0001",
  "supplier": {
    "id": "uuid",
    "name": "ABC Textiles"
  },
  "totalAmount": 50000,
  "transactionDate": "2026-02-05",
  "paymentEntries": [
    {
      "paymentAccount": { "name": "Cash" },
      "amount": 50000,
      "direction": "OUT"
    }
  ],
  "ledgerEntries": [
    {
      "entryType": "AP_DECREASE",
      "amount": 50000
    }
  ],
  "allocations": [
    {
      "id": "uuid",
      "appliesToTransaction": {
        "id": "uuid",
        "documentNumber": "PUR-2026-0001",
        "totalAmount": 89700
      },
      "amountApplied": 30000
    },
    {
      "id": "uuid",
      "appliesToTransaction": {
        "id": "uuid",
        "documentNumber": "PUR-2026-0002",
        "totalAmount": 45000
      },
      "amountApplied": 20000
    }
  ],
  "postedAt": "2026-02-05T14:00:00.000Z"
}
```

---

#### 5.2 Customer Payment (Standalone)

**POST /api/v1/transactions/customer-payments/draft**

Identical structure to supplier payment, but:
- customerId instead of supplierId
- Allocations to SALE transactions (not PURCHASE)
- Creates AR_DECREASE (not AP_DECREASE)
- MONEY_IN (not MONEY_OUT)

---

#### 5.3 Open Documents Query

**GET /api/v1/suppliers/:id/open-documents**

Query Parameters:
- asOfDate: date (default: today)
- includeFullyPaid: boolean (default: false)

Response:
```json
{
  "supplierId": "uuid",
  "supplierName": "ABC Textiles",
  "totalOutstanding": 59700,
  "documents": [
    {
      "id": "uuid",
      "documentNumber": "PUR-2026-0001",
      "transactionDate": "2026-02-02",
      "totalAmount": 89700,
      "paidAmount": 30000,
      "outstanding": 59700,
      "allocations": [
        {
          "paymentDocumentNumber": "SPY-2026-0001",
          "amount": 30000,
          "paymentDate": "2026-02-05"
        }
      ]
    }
  ]
}
```

---

**GET /api/v1/customers/:id/open-documents**

Similar to supplier open documents.

---

#### 5.4 Allocation History

**GET /api/v1/allocations**

Query Parameters:
- supplierId: uuid
- customerId: uuid
- purchaseId: uuid
- saleId: uuid
- dateFrom: date
- dateTo: date
- page, limit

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "paymentTransaction": {
        "id": "uuid",
        "documentNumber": "SPY-2026-0001",
        "transactionDate": "2026-02-05",
        "totalAmount": 50000
      },
      "appliesToTransaction": {
        "id": "uuid",
        "documentNumber": "PUR-2026-0001",
        "transactionDate": "2026-02-02",
        "totalAmount": 89700
      },
      "amountApplied": 30000,
      "notes": "Manual allocation",
      "createdAt": "2026-02-05T14:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 15
  }
}
```

### Testing Strategy - Phase 5

#### Integration Test: Supplier Payment with Manual Allocation

```typescript
describe('Supplier Payment Flow', () => {
  it('should create payment and allocate to specific purchases', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const supplier = await createTestSupplier(tenant.id);
    const product = await createTestProduct(tenant.id);
    const cashAccount = await createTestPaymentAccount(tenant.id);

    // Create two purchases
    const purchase1 = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      product.id,
      10,
      5000,
      0 // No payment
    );

    const purchase2 = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      product.id,
      5,
      8000,
      0 // No payment
    );

    // Total outstanding: 50000 + 40000 = 90000

    // Create supplier payment for 60000
    const paymentDraft = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-payments/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        amount: 60000,
        paymentAccountId: cashAccount.id,
        transactionDate: '2026-02-05',
        allocations: [
          {
            purchaseId: purchase1.id,
            amount: 50000, // Fully pay first purchase
          },
          {
            purchaseId: purchase2.id,
            amount: 10000, // Partially pay second
          },
        ],
      })
      .expect(201);

    // Post the payment
    const payment = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${paymentDraft.body.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: `test-${Date.now()}`,
      })
      .expect(200);

    // Verify allocations created
    expect(payment.body.allocations).toHaveLength(2);

    // Verify supplier balance
    const balance = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(balance.body.balance).toBe(30000); // 90000 - 60000

    // Verify open documents
    const openDocs = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/open-documents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(openDocs.body.documents).toHaveLength(1); // Only purchase2
    expect(openDocs.body.documents[0].outstanding).toBe(30000);
  });
});
```

#### Test: Auto-Allocation (Oldest First)

```typescript
describe('Auto-Allocation', () => {
  it('should allocate payment to oldest purchases first', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const supplier = await createTestSupplier(tenant.id);

    // Create 3 purchases on different dates
    const purchase1 = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      productId,
      10,
      5000,
      0,
      '2026-02-01' // Oldest
    );

    const purchase2 = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      productId,
      5,
      8000,
      0,
      '2026-02-03'
    );

    const purchase3 = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      productId,
      8,
      6000,
      0,
      '2026-02-05' // Newest
    );

    // Total outstanding: 50000 + 40000 + 48000 = 138000

    // Make payment of 70000 with NO allocations (auto-allocate)
    const payment = await createAndPostSupplierPayment(
      token,
      supplier.id,
      70000,
      null // No manual allocations
    );

    // Verify auto-allocation
    expect(payment.allocations).toHaveLength(2);

    // Should fully pay purchase1 (50000) and partially pay purchase2 (20000)
    const alloc1 = payment.allocations.find(a => a.appliesToTransactionId === purchase1.id);
    const alloc2 = payment.allocations.find(a => a.appliesToTransactionId === purchase2.id);

    expect(alloc1.amountApplied).toBe(50000);
    expect(alloc2.amountApplied).toBe(20000);

    // Verify outstanding amounts
    const openDocs = await getOpenDocuments(token, supplier.id);

    const doc1 = openDocs.documents.find(d => d.id === purchase1.id);
    const doc2 = openDocs.documents.find(d => d.id === purchase2.id);
    const doc3 = openDocs.documents.find(d => d.id === purchase3.id);

    expect(doc1).toBeUndefined(); // Fully paid
    expect(doc2.outstanding).toBe(20000); // 40000 - 20000
    expect(doc3.outstanding).toBe(48000); // Untouched
  });
});
```

#### Test: Overpayment (Credit Balance)

```typescript
describe('Overpayment Handling', () => {
  it('should create credit balance when payment exceeds outstanding', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const supplier = await createTestSupplier(tenant.id);

    // Create purchase for 50000
    const purchase = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      productId,
      10,
      5000,
      0
    );

    // Make payment of 70000 (20000 overpayment)
    await createAndPostSupplierPayment(token, supplier.id, 70000);

    // Verify supplier balance is -20000 (credit)
    const balance = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(balance.body.balance).toBe(-20000);
    expect(balance.body.balanceType).toBe('CREDIT');

    // Create another purchase for 30000
    const purchase2 = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      productId,
      6,
      5000,
      0
    );

    // New balance should be 10000 payable (30000 - 20000 credit)
    const newBalance = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplier.id}/balance`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(newBalance.body.balance).toBe(10000);
    expect(newBalance.body.balanceType).toBe('PAYABLE');
  });
});
```

### Deliverables - Phase 5

#### Code Artifacts
- [ ] Supplier payment transaction type
- [ ] Customer payment transaction type
- [ ] Manual allocation logic
- [ ] Auto-allocation logic (oldest first)
- [ ] Open documents query
- [ ] Allocation history query
- [ ] Overpayment/credit handling
- [ ] Allocation constraint validations

#### Documentation
- [ ] Allocation logic documented
- [ ] Auto-allocation algorithm documented
- [ ] Credit balance handling documented
- [ ] Settlement workflow guide

#### Tests
- [ ] Manual allocation tests
- [ ] Auto-allocation tests
- [ ] Overpayment tests
- [ ] Allocation constraint tests
- [ ] Open documents query tests
- [ ] Edge case tests

### Acceptance Criteria - Phase 5

**Must Pass:**
- [ ] Can create standalone supplier payment
- [ ] Can create standalone customer payment
- [ ] Can manually allocate to specific documents
- [ ] Auto-allocation works (oldest first)
- [ ] Cannot over-allocate to document
- [ ] Cannot allocate more than payment amount
- [ ] Overpayment creates credit balance
- [ ] Open documents query accurate
- [ ] Allocation history complete
- [ ] All tests passing

---

## PHASE 6: RETURNS + ADJUSTMENTS + INTERNAL TRANSFER

[Content continues with detailed specs for Phase 6...]

## PHASE 7: CANONICAL QUERIES + DASHBOARDS + IMPORT + HARDENING

[Content continues with detailed specs for Phase 7...]

---

**END OF PHASES 4-7 DETAILED PLAN**

This continuation covers the most complex phases (4-5) in extreme detail. Phases 6-7 would follow the same level of rigor. The complete plan with all phases would be approximately 25,000-30,000 lines.

Would you like me to complete Phases 6-7 as well, or focus on any specific aspect in more detail?
