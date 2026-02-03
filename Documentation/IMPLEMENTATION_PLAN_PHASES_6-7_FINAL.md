# IMPLEMENTATION PLAN - PHASES 6-7 + CROSS-PHASE CONCERNS (FINAL)

**This document completes the implementation plan series**

---

## PHASE 6: RETURNS + ADJUSTMENTS + INTERNAL TRANSFER

### Objective
Complete the operational transaction types that handle corrections, returns, and money transfers between accounts. These transactions maintain referential integrity and enforce strict business rules.

### Scope

#### Included in Phase 6
1. Supplier Return transactions (strict return rules)
2. Customer Return transactions (refund vs credit)
3. Internal Transfer transactions (two-leg transfers)
4. Adjustment transactions (admin corrections - optional for V1)
5. Return quantity validation (cannot exceed original)
6. Return cost/price determination
7. Refund processing
8. Transfer pair validation

#### Explicitly Excluded from Phase 6
- Void/reversal transactions (V1.1)
- Batch returns (V2)
- Return authorizations/RMA system (V2)
- Automated refund approval workflow (V2)

### Critical Business Rules

#### Rule 1: Strict Returns (Non-Negotiable)
- Every return line MUST reference an original purchase/sale line
- Cannot return more than originally purchased/sold
- Must track cumulative returns per original line
- Return valuation uses original cost/price

#### Rule 2: Return Valuation
**Supplier Return:**
- Use original purchase cost from source line
- If no source line: Use current avg_cost (fallback)

**Customer Return:**
- Use original sale price from source line
- If no source line: Require manual price entry (admin approval)

#### Rule 3: Customer Return Options
- **Refund Now**: Immediate cash refund (creates MONEY_OUT)
- **Store Credit**: No cash refund (creates customer credit balance)

#### Rule 4: Internal Transfer
- Always creates TWO payment entries (OUT + IN)
- Both entries linked via transfer_group_id
- from_account != to_account (enforced)
- Transfer amount must match on both legs

#### Rule 5: Adjustment (Optional V1)
- Admin/owner only
- Requires reason (mandatory)
- Creates adjustment inventory movements
- Does NOT affect ledger (no supplier/customer impact)
- Used for: damaged goods, theft, expired stock, count corrections

### Detailed Implementation

#### 6.1 Supplier Return Transaction

**POST /api/v1/transactions/supplier-returns/draft**

Request:
```json
{
  "supplierId": "uuid",
  "transactionDate": "2026-02-10",
  "lines": [
    {
      "sourceTransactionLineId": "uuid",
      "productId": "uuid",
      "quantity": 2,
      "reason": "Defective items"
    }
  ],
  "notes": "Return damaged suits"
}
```

**Validations:**
- supplierId: required, must match supplier from source lines
- Each line:
  - sourceTransactionLineId: REQUIRED (strict returns)
  - productId: must match product from source line
  - quantity: must be > 0 and <= returnable quantity
  - reason: optional, max 200 chars
- All source lines must be from PURCHASE transactions
- All source lines must belong to same supplier

**Edge Cases:**
- Return more than purchased: Return 422 with available quantity
- Multiple partial returns: Track cumulative returns
- Return from different supplier: Return 400
- Source line from draft transaction: Return 400 "Cannot return from draft"
- Source line already fully returned: Return 422

**Returnable Quantity Calculation:**

```typescript
async function getReturnableQuantity(
  tx: PrismaTransaction,
  tenantId: string,
  sourceLineId: string
): Promise<number> {
  // 1. Get original quantity
  const sourceLine = await tx.transactionLine.findUnique({
    where: { id: sourceLineId },
    select: { quantity: true },
  });

  // 2. Calculate already returned quantity
  const returnedQty = await tx.transactionLine.aggregate({
    where: {
      tenantId,
      sourceTransactionLineId: sourceLineId,
      transaction: {
        type: 'SUPPLIER_RETURN',
        status: 'POSTED',
      },
    },
    _sum: {
      quantity: true,
    },
  });

  const alreadyReturned = returnedQty._sum.quantity || 0;
  const returnable = sourceLine.quantity - alreadyReturned;

  return Math.max(0, returnable);
}
```

**Process:**
1. Validate DTO
2. Verify supplier active
3. For each line:
   - Verify sourceTransactionLineId exists
   - Get source line details (transaction, product, supplier)
   - Verify source transaction is PURCHASE and POSTED
   - Verify product matches
   - Calculate returnable quantity
   - Verify return quantity <= returnable quantity
   - Verify supplier matches (all lines same supplier)
4. Calculate line totals using original unit_cost
5. Create transaction (type = SUPPLIER_RETURN, status = DRAFT)
6. Create transaction_lines with sourceTransactionLineId populated
7. Return draft

---

**POST /api/v1/transactions/:id/post (SUPPLIER_RETURN)**

**Posting Process:**

```typescript
async function postSupplierReturn(transactionId: string, dto: PostDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: {
          include: {
            sourceTransactionLine: true,
            product: true,
          },
        },
      },
    });

    // Standard checks...

    // 1. Verify stock availability (can't return what you don't have)
    for (const line of transaction.lines) {
      const currentStock = await this.calculateProductStock(
        tx,
        transaction.tenantId,
        line.productId
      );

      if (currentStock < line.quantity) {
        throw new UnprocessableEntityException({
          message: 'Insufficient stock for return',
          productId: line.productId,
          productName: line.product.name,
          requested: line.quantity,
          available: currentStock,
        });
      }
    }

    // 2. Re-verify returnable quantities (prevent race condition)
    for (const line of transaction.lines) {
      const returnable = await this.getReturnableQuantity(
        tx,
        transaction.tenantId,
        line.sourceTransactionLineId
      );

      if (line.quantity > returnable) {
        throw new UnprocessableEntityException({
          message: 'Return quantity exceeds returnable amount',
          productId: line.productId,
          requested: line.quantity,
          returnable,
        });
      }
    }

    // 3. Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'SUPPLIER_RETURN',
      new Date().getFullYear().toString()
    );

    // 4. Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        postedAt: new Date(),
      },
    });

    // 5. Create inventory movements: SUPPLIER_RETURN_OUT
    const movements = transaction.lines.map(line => ({
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      transactionLineId: line.id,
      productId: line.productId,
      movementType: 'SUPPLIER_RETURN_OUT',
      quantity: line.quantity,
      unitCostAtTime: line.unitCost, // Original purchase cost
      transactionDate: transaction.transactionDate,
      createdBy: this.getTenantContext().userId,
    }));

    await tx.inventoryMovement.createMany({ data: movements });

    // 6. Create ledger entry: AP_DECREASE (reduces what you owe)
    await tx.ledgerEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        entryType: 'AP_DECREASE',
        supplierId: transaction.supplierId,
        amount: transaction.totalAmount,
        transactionDate: transaction.transactionDate,
        notes: `Supplier return ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 7. Log event
    this.logger.info('Supplier return posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      totalAmount: transaction.totalAmount,
    });

    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: {
          include: {
            product: true,
            sourceTransactionLine: {
              include: {
                transaction: { select: { documentNumber: true } },
              },
            },
          },
        },
        inventoryMovements: true,
        ledgerEntries: true,
      },
    });
  });
}
```

Response (200):
```json
{
  "id": "uuid",
  "type": "SUPPLIER_RETURN",
  "status": "POSTED",
  "documentNumber": "SRN-2026-0001",
  "supplier": {
    "id": "uuid",
    "name": "ABC Textiles"
  },
  "transactionDate": "2026-02-10",
  "totalAmount": 10000,
  "lines": [
    {
      "id": "uuid",
      "product": {
        "id": "uuid",
        "name": "Men Suit - Black"
      },
      "quantity": 2,
      "unitCost": 5000,
      "lineTotal": 10000,
      "reason": "Defective items",
      "sourceTransactionLine": {
        "id": "uuid",
        "transaction": {
          "documentNumber": "PUR-2026-0001"
        },
        "quantity": 10,
        "unitCost": 5000
      }
    }
  ],
  "inventoryMovements": [
    {
      "movementType": "SUPPLIER_RETURN_OUT",
      "quantity": 2,
      "unitCostAtTime": 5000
    }
  ],
  "ledgerEntries": [
    {
      "entryType": "AP_DECREASE",
      "amount": 10000
    }
  ],
  "notes": "Return damaged suits",
  "postedAt": "2026-02-10T11:00:00.000Z"
}
```

---

#### 6.2 Customer Return Transaction

**POST /api/v1/transactions/customer-returns/draft**

Request:
```json
{
  "customerId": "uuid",
  "transactionDate": "2026-02-12",
  "returnHandling": "REFUND_NOW",
  "paymentAccountId": "uuid",
  "lines": [
    {
      "sourceTransactionLineId": "uuid",
      "productId": "uuid",
      "quantity": 1,
      "reason": "Customer changed mind"
    }
  ],
  "notes": "Process refund"
}
```

**Validations:**
- customerId: required
- returnHandling: required, enum: REFUND_NOW, STORE_CREDIT
- paymentAccountId: required if returnHandling = REFUND_NOW
- lines: same validations as supplier return
- All source lines must be from SALE transactions
- All source lines must belong to same customer

**Edge Cases:**
- Refund without payment account: Return 400
- Return after 30 days: Business decision (allow or restrict)
- Partial refund: Calculate prorated amount
- Different customer: Return 400

**Process:**
1. Validate DTO
2. Verify customer active
3. If REFUND_NOW: Verify payment account active
4. For each line:
   - Verify sourceTransactionLineId from SALE transaction
   - Calculate returnable quantity
   - Verify return quantity valid
   - Get original unit_price for valuation
5. Calculate totals using original prices
6. Create transaction (type = CUSTOMER_RETURN, status = DRAFT)
7. Store returnHandling and paymentAccountId on transaction
8. Create lines with sourceTransactionLineId
9. Return draft

---

**POST /api/v1/transactions/:id/post (CUSTOMER_RETURN)**

**Posting Process:**

```typescript
async function postCustomerReturn(transactionId: string, dto: PostDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: {
          include: {
            sourceTransactionLine: true,
            product: true,
          },
        },
      },
    });

    // Standard checks...

    // 1. Verify returnable quantities
    for (const line of transaction.lines) {
      const returnable = await this.getReturnableQuantity(
        tx,
        transaction.tenantId,
        line.sourceTransactionLineId
      );

      if (line.quantity > returnable) {
        throw new UnprocessableEntityException({
          message: 'Return quantity exceeds returnable amount',
          productId: line.productId,
          requested: line.quantity,
          returnable,
        });
      }
    }

    // 2. Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'CUSTOMER_RETURN',
      new Date().getFullYear().toString()
    );

    // 3. Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        postedAt: new Date(),
      },
    });

    // 4. Create inventory movements: CUSTOMER_RETURN_IN
    const movements = transaction.lines.map(line => ({
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      transactionLineId: line.id,
      productId: line.productId,
      movementType: 'CUSTOMER_RETURN_IN',
      quantity: line.quantity,
      unitCostAtTime: line.product.avgCost, // Current avg cost for restocking
      transactionDate: transaction.transactionDate,
      createdBy: this.getTenantContext().userId,
    }));

    await tx.inventoryMovement.createMany({ data: movements });

    // 5. Create ledger entry: AR_DECREASE (reduces what customer owes)
    await tx.ledgerEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        entryType: 'AR_DECREASE',
        customerId: transaction.customerId,
        amount: transaction.totalAmount,
        transactionDate: transaction.transactionDate,
        notes: `Customer return ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 6. If REFUND_NOW: create payment entry
    if (transaction.returnHandling === 'REFUND_NOW') {
      await tx.paymentEntry.create({
        data: {
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
          paymentAccountId: transaction.paymentAccountId,
          entryType: 'MONEY_OUT',
          direction: 'OUT',
          amount: transaction.totalAmount,
          transactionDate: transaction.transactionDate,
          customerId: transaction.customerId,
          notes: `Refund for ${documentNumber}`,
          createdBy: this.getTenantContext().userId,
        },
      });
    }
    // If STORE_CREDIT: no payment entry, customer balance goes negative (credit)

    // 7. Log event
    this.logger.info('Customer return posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      returnHandling: transaction.returnHandling,
      totalAmount: transaction.totalAmount,
    });

    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: { include: { product: true, sourceTransactionLine: true } },
        inventoryMovements: true,
        ledgerEntries: true,
        paymentEntries: true,
      },
    });
  });
}
```

Response (200):
```json
{
  "id": "uuid",
  "type": "CUSTOMER_RETURN",
  "status": "POSTED",
  "documentNumber": "CRN-2026-0001",
  "customer": {
    "id": "uuid",
    "name": "Retail Shop A"
  },
  "transactionDate": "2026-02-12",
  "returnHandling": "REFUND_NOW",
  "totalAmount": 7000,
  "lines": [
    {
      "product": { "name": "Men Suit - Black" },
      "quantity": 1,
      "unitPrice": 7000,
      "reason": "Customer changed mind",
      "sourceTransactionLine": {
        "transaction": { "documentNumber": "SAL-2026-0001" },
        "quantity": 2,
        "unitPrice": 7000
      }
    }
  ],
  "inventoryMovements": [
    {
      "movementType": "CUSTOMER_RETURN_IN",
      "quantity": 1
    }
  ],
  "ledgerEntries": [
    {
      "entryType": "AR_DECREASE",
      "amount": 7000
    }
  ],
  "paymentEntries": [
    {
      "paymentAccount": { "name": "Cash" },
      "entryType": "MONEY_OUT",
      "amount": 7000,
      "notes": "Refund for CRN-2026-0001"
    }
  ],
  "postedAt": "2026-02-12T15:30:00.000Z"
}
```

---

#### 6.3 Internal Transfer Transaction

**POST /api/v1/transactions/internal-transfers/draft**

Request:
```json
{
  "fromPaymentAccountId": "uuid",
  "toPaymentAccountId": "uuid",
  "amount": 100000,
  "transactionDate": "2026-02-15",
  "notes": "Transfer cash to bank"
}
```

**Validations:**
- fromPaymentAccountId: required, must exist and be ACTIVE
- toPaymentAccountId: required, must exist and be ACTIVE
- amount: required, integer > 0
- fromPaymentAccountId != toPaymentAccountId
- transactionDate: required, valid date

**Edge Cases:**
- Same account: Return 400 "Cannot transfer to same account"
- Negative amount: Return 400
- From account has insufficient balance: Warning only (allow overdraft)

**Process:**
1. Validate DTO
2. Verify both accounts exist and active
3. Verify accounts are different
4. Create transaction (type = INTERNAL_TRANSFER, status = DRAFT)
5. Set fromPaymentAccountId and toPaymentAccountId on transaction
6. Set totalAmount = amount
7. Return draft

---

**POST /api/v1/transactions/:id/post (INTERNAL_TRANSFER)**

**Posting Process:**

```typescript
async function postInternalTransfer(transactionId: string, dto: PostDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        fromPaymentAccount: true,
        toPaymentAccount: true,
      },
    });

    // Standard checks...

    // 1. Generate transfer_group_id (links the two entries)
    const transferGroupId = uuidv4();

    // 2. Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'INTERNAL_TRANSFER',
      new Date().getFullYear().toString()
    );

    // 3. Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        postedAt: new Date(),
      },
    });

    // 4. Create TWO payment entries (OUT + IN)

    // 4a. Money OUT from source account
    await tx.paymentEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        paymentAccountId: transaction.fromPaymentAccountId,
        entryType: 'TRANSFER',
        direction: 'OUT',
        amount: transaction.totalAmount,
        transferGroupId,
        transactionDate: transaction.transactionDate,
        notes: `Transfer to ${transaction.toPaymentAccount.name} - ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 4b. Money IN to destination account
    await tx.paymentEntry.create({
      data: {
        tenantId: transaction.tenantId,
        transactionId: transaction.id,
        paymentAccountId: transaction.toPaymentAccountId,
        entryType: 'TRANSFER',
        direction: 'IN',
        amount: transaction.totalAmount,
        transferGroupId, // Same group ID
        transactionDate: transaction.transactionDate,
        notes: `Transfer from ${transaction.fromPaymentAccount.name} - ${documentNumber}`,
        createdBy: this.getTenantContext().userId,
      },
    });

    // 5. No ledger entries (no supplier/customer impact)
    // 6. No inventory movements (no stock impact)

    // 7. Validate: Both entries have same transferGroupId
    const entries = await tx.paymentEntry.findMany({
      where: { transferGroupId },
    });

    if (entries.length !== 2) {
      throw new InternalServerErrorException('Transfer entry pair validation failed');
    }

    const totalOut = entries.find(e => e.direction === 'OUT')?.amount || 0;
    const totalIn = entries.find(e => e.direction === 'IN')?.amount || 0;

    if (totalOut !== totalIn) {
      throw new InternalServerErrorException('Transfer amount mismatch');
    }

    // 8. Log event
    this.logger.info('Internal transfer posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      fromAccount: transaction.fromPaymentAccount.name,
      toAccount: transaction.toPaymentAccount.name,
      amount: transaction.totalAmount,
    });

    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        fromPaymentAccount: true,
        toPaymentAccount: true,
        paymentEntries: true,
      },
    });
  });
}
```

Response (200):
```json
{
  "id": "uuid",
  "type": "INTERNAL_TRANSFER",
  "status": "POSTED",
  "documentNumber": "TRF-2026-0001",
  "fromPaymentAccount": {
    "id": "uuid",
    "name": "Cash",
    "type": "CASH"
  },
  "toPaymentAccount": {
    "id": "uuid",
    "name": "HBL Bank",
    "type": "BANK"
  },
  "totalAmount": 100000,
  "transactionDate": "2026-02-15",
  "paymentEntries": [
    {
      "id": "uuid",
      "paymentAccount": { "name": "Cash" },
      "direction": "OUT",
      "amount": 100000,
      "transferGroupId": "uuid"
    },
    {
      "id": "uuid",
      "paymentAccount": { "name": "HBL Bank" },
      "direction": "IN",
      "amount": 100000,
      "transferGroupId": "uuid"
    }
  ],
  "notes": "Transfer cash to bank",
  "postedAt": "2026-02-15T09:00:00.000Z"
}
```

---

#### 6.4 Adjustment Transaction (Optional V1)

**POST /api/v1/transactions/adjustments/draft**

Request:
```json
{
  "transactionDate": "2026-02-20",
  "reason": "Physical stock count correction",
  "lines": [
    {
      "productId": "uuid",
      "adjustmentType": "IN",
      "quantity": 3,
      "notes": "Found 3 missing units during audit"
    },
    {
      "productId": "uuid",
      "adjustmentType": "OUT",
      "quantity": 2,
      "notes": "2 damaged units written off"
    }
  ],
  "notes": "Monthly stock audit adjustments"
}
```

**Validations:**
- reason: REQUIRED, min 10 chars, max 500 chars
- User must have OWNER or ADMIN role
- Each line:
  - productId: required
  - adjustmentType: required, enum: IN, OUT
  - quantity: required, integer > 0
  - notes: optional

**Edge Cases:**
- Non-admin user: Return 403
- Missing reason: Return 400
- Adjustment OUT exceeds stock: Warning but allow (creates negative stock)

**Posting Process:**

```typescript
async function postAdjustment(transactionId: string, dto: PostDto): Promise<Transaction> {
  return await this.prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { lines: { include: { product: true } } },
    });

    // Verify user has admin privileges
    const user = this.getTenantContext();
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can post adjustments');
    }

    // Generate document number
    const documentNumber = await this.generateDocumentNumber(
      tx,
      transaction.tenantId,
      'ADJUSTMENT',
      new Date().getFullYear().toString()
    );

    // Update transaction to POSTED
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'POSTED',
        documentNumber,
        idempotencyKey: dto.idempotencyKey,
        postedAt: new Date(),
      },
    });

    // Create inventory movements
    for (const line of transaction.lines) {
      const movementType = line.adjustmentType === 'IN'
        ? 'ADJUSTMENT_IN'
        : 'ADJUSTMENT_OUT';

      await tx.inventoryMovement.create({
        data: {
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
          transactionLineId: line.id,
          productId: line.productId,
          movementType,
          quantity: line.quantity,
          unitCostAtTime: line.product.avgCost,
          transactionDate: transaction.transactionDate,
          createdBy: user.userId,
        },
      });
    }

    // NO ledger entries (no supplier/customer impact)
    // NO payment entries (no money movement)

    // Log event with reason for audit trail
    this.logger.warn('Stock adjustment posted', {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      documentNumber,
      reason: transaction.reason,
      userId: user.userId,
      userName: user.userName,
    });

    return await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        lines: { include: { product: true } },
        inventoryMovements: true,
      },
    });
  });
}
```

### Testing Strategy - Phase 6

#### Integration Test: Supplier Return Flow

```typescript
describe('Supplier Return Flow', () => {
  it('should process return correctly with source line validation', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const supplier = await createTestSupplier(tenant.id);
    const product = await createTestProduct(tenant.id);

    // Create and post purchase for 10 units
    const purchase = await createAndPostPurchase(
      tenant.id,
      supplier.id,
      product.id,
      10,
      5000
    );

    const purchaseLine = purchase.lines[0];

    // Create return for 3 units
    const returnDraft = await request(app.getHttpServer())
      .post('/api/v1/transactions/supplier-returns/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId: supplier.id,
        transactionDate: '2026-02-10',
        lines: [
          {
            sourceTransactionLineId: purchaseLine.id,
            productId: product.id,
            quantity: 3,
            reason: 'Defective',
          },
        ],
      })
      .expect(201);

    // Post the return
    const returnPosted = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${returnDraft.body.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `test-${Date.now()}` })
      .expect(200);

    // Verify stock reduced by 3
    const stock = await getProductStock(token, product.id);
    expect(stock).toBe(7); // 10 - 3

    // Verify supplier balance reduced
    const balance = await getSupplierBalance(token, supplier.id);
    expect(balance).toBe(35000); // 50000 - 15000

    // Verify returnable quantity updated
    const returnable = await getReturnableQuantity(tenant.id, purchaseLine.id);
    expect(returnable).toBe(7); // 10 - 3
  });

  it('should prevent over-return', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const purchase = await createAndPostPurchase(...);
    const purchaseLine = purchase.lines[0];

    // First return: 8 units
    await createAndPostSupplierReturn(token, purchaseLine.id, 8);

    // Attempt second return: 5 units (total would be 13, exceeds 10)
    const returnDraft = await createSupplierReturnDraft(
      token,
      purchaseLine.id,
      5
    );

    await request(app.getHttpServer())
      .post(`/api/v1/transactions/${returnDraft.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `test-${Date.now()}` })
      .expect(422);
  });
});
```

#### Test: Customer Return with Refund

```typescript
describe('Customer Return with Refund', () => {
  it('should process refund correctly', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const customer = await createTestCustomer(tenant.id);
    const product = await createTestProduct(tenant.id);
    const cashAccount = await createTestPaymentAccount(tenant.id);

    // Create sale
    await createAndPostPurchase(tenant.id, supplierId, product.id, 10, 5000);
    const sale = await createAndPostSale(
      token,
      customer.id,
      product.id,
      3,
      7000,
      21000, // Fully paid
      cashAccount.id
    );

    const saleLine = sale.lines[0];

    // Create return with refund
    const returnDraft = await createCustomerReturnDraft(
      token,
      customer.id,
      saleLine.id,
      1,
      'REFUND_NOW',
      cashAccount.id
    );

    const returnPosted = await postTransaction(token, returnDraft.id);

    // Verify refund payment entry created
    expect(returnPosted.paymentEntries).toHaveLength(1);
    expect(returnPosted.paymentEntries[0]).toMatchObject({
      paymentAccountId: cashAccount.id,
      entryType: 'MONEY_OUT',
      amount: 7000,
    });

    // Verify stock increased
    const stock = await getProductStock(token, product.id);
    expect(stock).toBe(8); // 10 - 3 + 1

    // Verify customer balance
    const balance = await getCustomerBalance(token, customer.id);
    expect(balance).toBe(0); // Was fully paid, now returned 1
  });

  it('should create credit balance for store credit', async () => {
    // Similar setup...

    // Create return with store credit (no refund)
    const returnDraft = await createCustomerReturnDraft(
      token,
      customer.id,
      saleLine.id,
      1,
      'STORE_CREDIT',
      null // No payment account
    );

    const returnPosted = await postTransaction(token, returnDraft.id);

    // Verify NO payment entry
    expect(returnPosted.paymentEntries).toHaveLength(0);

    // Verify customer balance is negative (credit)
    const balance = await getCustomerBalance(token, customer.id);
    expect(balance).toBe(-7000); // Customer has credit
  });
});
```

#### Test: Internal Transfer

```typescript
describe('Internal Transfer', () => {
  it('should create balanced two-leg transfer', async () => {
    const { token, tenant } = await createTestTenantAndUser(app);
    const cashAccount = await createTestPaymentAccount(tenant.id, 'Cash', 'CASH');
    const bankAccount = await createTestPaymentAccount(tenant.id, 'Bank', 'BANK');

    // Add money to cash first
    await createAndPostPurchase(tenant.id, ..., 0); // No payment
    await createAndPostCustomerPayment(token, customerId, 100000, cashAccount.id);

    // Transfer 50000 from cash to bank
    const transferDraft = await createTransferDraft(
      token,
      cashAccount.id,
      bankAccount.id,
      50000
    );

    const transfer = await postTransaction(token, transferDraft.id);

    // Verify two payment entries created
    expect(transfer.paymentEntries).toHaveLength(2);

    const outEntry = transfer.paymentEntries.find(e => e.direction === 'OUT');
    const inEntry = transfer.paymentEntries.find(e => e.direction === 'IN');

    expect(outEntry).toMatchObject({
      paymentAccountId: cashAccount.id,
      amount: 50000,
    });

    expect(inEntry).toMatchObject({
      paymentAccountId: bankAccount.id,
      amount: 50000,
    });

    // Verify same transfer group
    expect(outEntry.transferGroupId).toBe(inEntry.transferGroupId);

    // Verify account balances
    const cashBalance = await getAccountBalance(token, cashAccount.id);
    const bankBalance = await getAccountBalance(token, bankAccount.id);

    expect(cashBalance).toBe(50000); // 100000 - 50000
    expect(bankBalance).toBe(50000); // 0 + 50000
  });
});
```

### Deliverables - Phase 6

#### Code Artifacts
- [ ] Supplier return transaction implementation
- [ ] Customer return transaction implementation
- [ ] Internal transfer transaction implementation
- [ ] Adjustment transaction implementation (optional)
- [ ] Returnable quantity calculation
- [ ] Return validation logic
- [ ] Refund processing
- [ ] Transfer pair validation

#### Documentation
- [ ] Return policies documented
- [ ] Refund vs credit handling
- [ ] Transfer mechanics
- [ ] Adjustment usage guidelines

#### Tests
- [ ] Supplier return tests (full flow + validation)
- [ ] Customer return tests (refund + credit)
- [ ] Internal transfer tests
- [ ] Adjustment tests
- [ ] Over-return prevention tests
- [ ] Transfer validation tests

### Acceptance Criteria - Phase 6

**Must Pass:**
- [ ] Can process supplier returns with source line validation
- [ ] Cannot return more than originally purchased
- [ ] Can process customer returns with refund
- [ ] Can process customer returns with store credit
- [ ] Can transfer money between accounts
- [ ] Transfer creates exactly two entries
- [ ] Transfer entries have matching amounts
- [ ] Adjustments require admin role
- [ ] All return quantities validated
- [ ] All balances calculate correctly
- [ ] All tests passing

---

## PHASE 7: CANONICAL QUERIES + DASHBOARDS + IMPORT + HARDENING

### Objective
Complete the system with production-ready queries, dashboards, Excel import functionality, and operational hardening based on 12-factor app principles.

### Scope

#### Included in Phase 7
1. All canonical queries (balance, stock, pending, statements)
2. Dashboard summary endpoint
3. Excel/CSV import system
4. Column mapping interface
5. Import validation and error handling
6. Batch rollback capability
7. Production hardening (12-factor methodology)
8. Performance optimization
9. Monitoring and observability
10. Deployment automation

### 7.1 Canonical Queries (Proven Schema Validation)

#### Query 1: Supplier Balance

**GET /api/v1/reports/suppliers/:id/balance**

Query Parameters:
- asOfDate: date (default: today)

Response:
```json
{
  "supplierId": "uuid",
  "supplierName": "ABC Textiles",
  "asOfDate": "2026-02-20",
  "balance": 45000,
  "balanceType": "PAYABLE",
  "breakdown": {
    "purchases": {
      "count": 5,
      "totalAmount": 250000
    },
    "payments": {
      "count": 3,
      "totalAmount": 200000
    },
    "returns": {
      "count": 1,
      "totalAmount": 5000
    },
    "netPayable": 45000
  }
}
```

SQL Implementation:
```sql
SELECT
  SUM(CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END) -
  SUM(CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END) as balance
FROM ledger_entries
WHERE tenant_id = $1
  AND supplier_id = $2
  AND transaction_date <= $3
```

#### Query 2: Customer Balance

**GET /api/v1/reports/customers/:id/balance**

Similar to supplier balance, using AR entries.

#### Query 3: Payment Account Balance

**GET /api/v1/reports/payment-accounts/:id/balance**

Response:
```json
{
  "accountId": "uuid",
  "accountName": "Cash",
  "accountType": "CASH",
  "asOfDate": "2026-02-20",
  "balance": 125000,
  "breakdown": {
    "openingBalance": 0,
    "moneyIn": {
      "count": 10,
      "totalAmount": 500000
    },
    "moneyOut": {
      "count": 8,
      "totalAmount": 375000
    },
    "currentBalance": 125000
  }
}
```

SQL:
```sql
SELECT
  pa.opening_balance +
  COALESCE(SUM(CASE WHEN pe.direction = 'IN' THEN pe.amount ELSE 0 END), 0) -
  COALESCE(SUM(CASE WHEN pe.direction = 'OUT' THEN pe.amount ELSE 0 END), 0) as balance
FROM payment_accounts pa
LEFT JOIN payment_entries pe ON pe.payment_account_id = pa.id
  AND pe.transaction_date <= $2
WHERE pa.id = $1 AND pa.tenant_id = $3
GROUP BY pa.id, pa.opening_balance
```

#### Query 4: Product Stock

**GET /api/v1/reports/products/:id/stock**

Response:
```json
{
  "productId": "uuid",
  "productName": "Men Suit - Black",
  "sku": "SUIT-BLK-001",
  "asOfDate": "2026-02-20",
  "currentStock": 45,
  "avgCost": 5200,
  "stockValue": 234000,
  "breakdown": {
    "purchasesIn": 100,
    "salesOut": 50,
    "returnsIn": 3,
    "returnsOut": 5,
    "adjustmentsIn": 2,
    "adjustmentsOut": 5,
    "netStock": 45
  }
}
```

SQL:
```sql
SELECT
  SUM(CASE
    WHEN movement_type IN ('PURCHASE_IN', 'CUSTOMER_RETURN_IN', 'ADJUSTMENT_IN')
    THEN quantity ELSE 0
  END) -
  SUM(CASE
    WHEN movement_type IN ('SALE_OUT', 'SUPPLIER_RETURN_OUT', 'ADJUSTMENT_OUT')
    THEN quantity ELSE 0
  END) as stock
FROM inventory_movements
WHERE tenant_id = $1
  AND product_id = $2
  AND transaction_date <= $3
```

#### Query 5: Pending Receivables Dashboard

**GET /api/v1/reports/pending-receivables**

Query Parameters:
- asOfDate: date
- customerId: uuid (optional filter)
- minAmount: number (optional filter)

Response:
```json
{
  "asOfDate": "2026-02-20",
  "totalReceivables": 250000,
  "customerCount": 15,
  "customers": [
    {
      "customerId": "uuid",
      "customerName": "Retail Shop A",
      "balance": 85000,
      "oldestInvoiceDate": "2026-01-15",
      "daysPastDue": 36,
      "openDocuments": [
        {
          "documentNumber": "SAL-2026-0012",
          "transactionDate": "2026-01-15",
          "totalAmount": 50000,
          "paidAmount": 0,
          "outstanding": 50000,
          "daysPastDue": 36
        },
        {
          "documentNumber": "SAL-2026-0045",
          "transactionDate": "2026-02-01",
          "totalAmount": 35000,
          "paidAmount": 0,
          "outstanding": 35000,
          "daysPastDue": 19
        }
      ]
    }
  ]
}
```

#### Query 6: Pending Payables Dashboard

**GET /api/v1/reports/pending-payables**

Similar to receivables, for suppliers.

#### Query 7: Supplier Statement

**GET /api/v1/reports/suppliers/:id/statement**

Query Parameters:
- dateFrom: date (required)
- dateTo: date (required)

Response:
```json
{
  "supplierId": "uuid",
  "supplierName": "ABC Textiles",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-02-20",
  "openingBalance": 0,
  "closingBalance": 45000,
  "entries": [
    {
      "date": "2026-01-05",
      "documentNumber": "PUR-2026-0001",
      "type": "PURCHASE",
      "debit": 50000,
      "credit": 0,
      "balance": 50000
    },
    {
      "date": "2026-01-10",
      "documentNumber": "SPY-2026-0001",
      "type": "SUPPLIER_PAYMENT",
      "debit": 0,
      "credit": 30000,
      "balance": 20000
    },
    {
      "date": "2026-02-02",
      "documentNumber": "PUR-2026-0010",
      "type": "PURCHASE",
      "debit": 75000,
      "credit": 0,
      "balance": 95000
    },
    {
      "date": "2026-02-15",
      "documentNumber": "SPY-2026-0005",
      "type": "SUPPLIER_PAYMENT",
      "debit": 0,
      "credit": 50000,
      "balance": 45000
    }
  ]
}
```

SQL (with running balance):
```sql
WITH ledger AS (
  SELECT
    t.transaction_date as date,
    t.document_number,
    t.type,
    le.entry_type,
    le.amount
  FROM ledger_entries le
  JOIN transactions t ON t.id = le.transaction_id
  WHERE le.tenant_id = $1
    AND le.supplier_id = $2
    AND t.transaction_date BETWEEN $3 AND $4
  ORDER BY t.transaction_date, t.created_at
)
SELECT
  date,
  document_number,
  type,
  CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE 0 END as debit,
  CASE WHEN entry_type = 'AP_DECREASE' THEN amount ELSE 0 END as credit,
  SUM(
    CASE WHEN entry_type = 'AP_INCREASE' THEN amount ELSE -amount END
  ) OVER (ORDER BY date, document_number) as balance
FROM ledger
```

#### Query 8: Customer Statement

Similar to supplier statement, using AR entries.

#### Query 9: Payment Account Statement

**GET /api/v1/reports/payment-accounts/:id/statement**

Shows all money in/out with running balance.

---

### 7.2 Dashboard Summary

**GET /api/v1/dashboard/summary**

Query Parameters:
- asOfDate: date (default: today)

Response:
```json
{
  "asOfDate": "2026-02-20",
  "cash": {
    "totalBalance": 325000,
    "accounts": [
      { "name": "Cash", "balance": 125000 },
      { "name": "HBL Bank", "balance": 200000 }
    ]
  },
  "inventory": {
    "totalValue": 2500000,
    "totalProducts": 150,
    "lowStockCount": 12
  },
  "receivables": {
    "totalAmount": 250000,
    "customerCount": 15,
    "overdueAmount": 120000,
    "overdueCount": 8
  },
  "payables": {
    "totalAmount": 180000,
    "supplierCount": 10,
    "overdueAmount": 45000,
    "overdueCount": 3
  },
  "recentActivity": {
    "todaySales": 85000,
    "todayPurchases": 120000,
    "todayPayments": 50000,
    "todayReceipts": 75000
  }
}
```

Implementation uses cached/aggregated queries for performance.

---

### 7.3 Excel/CSV Import System

#### Import Flow

1. **Upload File** → Creates import_batch
2. **Map Columns** → User maps CSV columns to system fields
3. **Validate** → System validates all rows
4. **Review** → User reviews errors
5. **Commit** → System creates records

#### Import Batch Creation

**POST /api/v1/imports**

Request (multipart/form-data):
```
file: suppliers.csv
module: SUPPLIERS
```

**Validations:**
- file: required, must be CSV or XLSX
- module: required, enum: SUPPLIERS, CUSTOMERS, PRODUCTS, OPENING_BALANCES
- File size: max 10MB
- Row count: max 10,000 rows

**Process:**
1. Validate file format
2. Parse file (first 5 rows for preview)
3. Create import_batch record (status = PROCESSING)
4. Store file temporarily
5. Extract column headers
6. Return column mapping UI data

Response (201):
```json
{
  "id": "uuid",
  "module": "SUPPLIERS",
  "fileName": "suppliers.csv",
  "totalRows": 250,
  "status": "PENDING_MAPPING",
  "detectedColumns": [
    "Company Name",
    "Phone Number",
    "Address",
    "Notes"
  ],
  "requiredFields": [
    { "field": "name", "type": "string", "required": true },
    { "field": "phone", "type": "string", "required": false },
    { "field": "address", "type": "string", "required": false },
    { "field": "notes", "type": "string", "required": false }
  ],
  "createdAt": "2026-02-20T10:00:00.000Z"
}
```

---

#### Column Mapping

**POST /api/v1/imports/:id/map**

Request:
```json
{
  "columnMappings": {
    "Company Name": "name",
    "Phone Number": "phone",
    "Address": "address",
    "Notes": "notes"
  }
}
```

**Process:**
1. Validate mapping (all required fields mapped)
2. Parse all rows with mapping
3. Validate each row
4. Create import_rows records
5. Update import_batch with validation results

Response (200):
```json
{
  "id": "uuid",
  "status": "VALIDATED",
  "totalRows": 250,
  "validRows": 245,
  "invalidRows": 5,
  "errors": [
    {
      "rowNumber": 12,
      "field": "name",
      "error": "Name is required",
      "value": ""
    },
    {
      "rowNumber": 45,
      "field": "phone",
      "error": "Invalid phone format",
      "value": "invalid"
    }
  ],
  "preview": [
    {
      "rowNumber": 1,
      "data": {
        "name": "ABC Suppliers",
        "phone": "+92-300-1234567",
        "address": "Karachi"
      },
      "status": "VALID"
    }
  ]
}
```

---

#### Import Commit

**POST /api/v1/imports/:id/commit**

Request:
```json
{
  "skipInvalidRows": true
}
```

**Process:**
1. Verify batch status = VALIDATED
2. Begin transaction
3. For each valid row:
   - Create supplier/customer/product record
   - Link to import_row
   - Handle duplicates (skip or update)
4. Update import_batch (status = COMPLETED)
5. Commit transaction

Response (200):
```json
{
  "id": "uuid",
  "status": "COMPLETED",
  "totalRows": 250,
  "successRows": 245,
  "failedRows": 5,
  "skippedRows": 5,
  "createdRecords": [
    {
      "rowNumber": 1,
      "recordId": "uuid",
      "recordType": "SUPPLIER"
    }
  ],
  "completedAt": "2026-02-20T10:15:00.000Z"
}
```

---

#### Import Rollback

**POST /api/v1/imports/:id/rollback**

**Process:**
1. Find all records created by this import batch
2. Begin transaction
3. Delete all created records (if no dependencies)
4. Update import_batch (status = ROLLED_BACK)
5. Commit transaction

**Edge Cases:**
- Records have dependencies (transactions): Return 409
- Partial rollback not allowed: All or nothing

---

### 7.4 Production Hardening (12-Factor Methodology)

#### I. Codebase
- Single codebase in Git
- Same code deploys to dev/staging/prod
- Version tagging for releases

#### II. Dependencies
- Explicit dependency declaration (package.json)
- No implicit system dependencies
- Lock file committed (package-lock.json)

#### III. Config
- All config in environment variables
- No secrets in code
- Different configs for each environment
- .env.example template provided

#### IV. Backing Services
- Database treated as attached resource
- Connection via environment variable
- Can swap databases without code changes

#### V. Build, Release, Run
- Strict separation of build and run stages
- Immutable releases
- Versioned releases

#### VI. Processes
- Stateless processes
- No local session storage
- Use Redis for shared state (if needed)

#### VII. Port Binding
- Self-contained service
- Exports HTTP via port binding
- No webserver dependencies

#### VIII. Concurrency
- Scale via process model
- Horizontal scaling support
- Stateless enables easy scaling

#### IX. Disposability
- Fast startup (< 10 seconds)
- Graceful shutdown
- Handle SIGTERM properly

#### X. Dev/Prod Parity
- Keep dev/staging/prod similar
- Same database type in all environments
- Same backing services

#### XI. Logs
- Logs as event streams
- Write to stdout/stderr
- Log aggregation in production

#### XII. Admin Processes
- One-off admin tasks via CLI
- Run in same environment
- Use same codebase

---

### Production Checklist

#### Performance Optimization
- [ ] Database query optimization (use EXPLAIN ANALYZE)
- [ ] Add database connection pooling
- [ ] Implement response caching (Redis)
- [ ] Add query result pagination
- [ ] Optimize N+1 queries
- [ ] Add database indexes for common queries
- [ ] Implement lazy loading for relations

#### Security Hardening
- [ ] Enable HTTPS only in production
- [ ] Add rate limiting per endpoint
- [ ] Implement CSRF protection
- [ ] Add SQL injection protection (Prisma provides)
- [ ] Sanitize all user inputs
- [ ] Add request size limits
- [ ] Implement brute force protection
- [ ] Add security headers (Helmet.js)
- [ ] Enable CORS with whitelist
- [ ] Implement API versioning

#### Monitoring & Observability
- [ ] Add application performance monitoring (APM)
- [ ] Implement health check endpoints
- [ ] Add structured logging (JSON format)
- [ ] Set up error tracking (Sentry)
- [ ] Add metrics collection (Prometheus)
- [ ] Implement distributed tracing
- [ ] Add custom business metrics
- [ ] Set up alerting (PagerDuty/Slack)

#### Deployment
- [ ] Create Dockerfile
- [ ] Set up CI/CD pipeline
- [ ] Implement blue-green deployment
- [ ] Add database migration automation
- [ ] Create deployment runbook
- [ ] Set up staging environment
- [ ] Configure auto-scaling
- [ ] Add health checks for load balancer

#### Backup & Recovery
- [ ] Automate database backups
- [ ] Test restore procedures
- [ ] Document recovery process
- [ ] Set up point-in-time recovery
- [ ] Implement backup monitoring

---

### Deliverables - Phase 7

#### Code Artifacts
- [ ] All canonical query endpoints
- [ ] Dashboard summary endpoint
- [ ] Import system (upload, map, validate, commit)
- [ ] Rollback functionality
- [ ] Performance optimizations
- [ ] Caching layer
- [ ] Monitoring instrumentation

#### Documentation
- [ ] Query documentation with examples
- [ ] Import user guide
- [ ] Deployment guide
- [ ] Operations runbook
- [ ] Troubleshooting guide
- [ ] Performance tuning guide

#### Infrastructure
- [ ] Production Dockerfile
- [ ] CI/CD pipeline configuration
- [ ] Environment configuration templates
- [ ] Database backup scripts
- [ ] Monitoring dashboards

#### Tests
- [ ] Query accuracy tests
- [ ] Import validation tests
- [ ] Performance benchmarks
- [ ] Load testing results
- [ ] Disaster recovery tests

### Acceptance Criteria - Phase 7

**Must Pass:**
- [ ] All canonical queries return accurate data
- [ ] Dashboard loads in < 2 seconds
- [ ] Can import 1000 suppliers in < 30 seconds
- [ ] Import validation catches all errors
- [ ] Rollback works correctly
- [ ] All queries use indexes
- [ ] No N+1 query problems
- [ ] Application starts in < 10 seconds
- [ ] Health checks work
- [ ] Logs are structured JSON
- [ ] Metrics are collected
- [ ] Can deploy to production
- [ ] Backup/restore tested
- [ ] All tests passing
- [ ] Documentation complete

---

## CROSS-PHASE CONCERNS

### Error Handling Strategy

**Error Hierarchy:**
```
AppError (base)
├── ValidationError (400)
├── UnauthorizedError (401)
├── ForbiddenError (403)
├── NotFoundError (404)
├── ConflictError (409)
├── UnprocessableEntityError (422)
└── InternalServerError (500)
```

**Error Response Format:**
```json
{
  "statusCode": 422,
  "errorCode": "INSUFFICIENT_STOCK",
  "message": "Cannot complete sale due to insufficient stock",
  "details": {
    "productId": "uuid",
    "productName": "Men Suit - Black",
    "requested": 10,
    "available": 7
  },
  "timestamp": "2026-02-20T15:00:00.000Z",
  "path": "/api/v1/transactions/abc/post",
  "requestId": "uuid"
}
```

### Logging Standards

**Log Levels:**
- ERROR: System failures, data corruption
- WARN: Business rule violations, stock adjustments
- INFO: Business events (transaction posted)
- DEBUG: Detailed debugging (dev only)

**What to Log:**
- All posted transactions
- All payments
- All returns
- All adjustments
- All import operations
- All authentication events
- All errors with context

**What NOT to Log:**
- Passwords
- Full JWT tokens
- Credit card numbers (N/A for V1)
- Customer PII in production

### Performance Targets

**API Response Times:**
- Health check: < 100ms
- Master data list: < 200ms
- Transaction list: < 300ms
- Balance queries: < 150ms
- Stock queries: < 100ms
- Dashboard: < 2000ms
- Import validation: < 5s per 1000 rows

**Database:**
- Connection pool: 10-50 connections
- Query timeout: 5 seconds
- Max transaction time: 10 seconds

**Scalability:**
- Support 100 concurrent users
- Handle 1000 transactions per day
- Store 100,000 transactions per tenant
- Support 100 tenants initially

---

## SUMMARY

This implementation plan provides:

✅ **7 Detailed Phases** covering every aspect of backend development
✅ **System Invariants** that must never be violated
✅ **Edge Cases** explicitly handled at every step
✅ **Complete API Specifications** with request/response examples
✅ **Database Schema** with all constraints and indexes
✅ **Posting Patterns** with exact row creation logic
✅ **Test Strategies** for every phase
✅ **Performance Benchmarks** for validation
✅ **Production Hardening** using 12-factor methodology
✅ **Cross-Phase Concerns** (errors, logging, monitoring)

**Total Estimated Timeline:**
- Phase 1: 2 weeks
- Phase 2: 1 week
- Phase 3: 2 weeks
- Phase 4: 3 weeks
- Phase 5: 2 weeks
- Phase 6: 2 weeks
- Phase 7: 2 weeks
- **Total: 14 weeks** (3.5 months) for solo developer

**Critical Success Factors:**
1. Never violate system invariants
2. Test edge cases explicitly
3. Maintain data integrity above all
4. Keep audit trail complete
5. Document all decisions
6. Validate with real business data

**Risk Mitigation:**
- Start with Phase 1-3 to prove architecture
- Get business validation after Phase 4
- Iterate on feedback before Phase 5-7
- Keep scope strict (no feature creep)
- Test concurrency early and often

---

**END OF COMPLETE IMPLEMENTATION PLAN**

All phases documented with extreme detail, covering every constraint, edge case, validation rule, and business logic requirement.
