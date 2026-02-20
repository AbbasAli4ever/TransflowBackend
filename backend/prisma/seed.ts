import { PrismaClient, PaymentAccountType } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// ─── Helper: generate document number and bump sequence ──────────────────────
const prefixMap: Record<string, string> = {
  PURCHASE: 'PUR',
  SALE: 'SAL',
  SUPPLIER_PAYMENT: 'SPY',
  CUSTOMER_PAYMENT: 'CPY',
  SUPPLIER_RETURN: 'SRN',
  CUSTOMER_RETURN: 'CRN',
  INTERNAL_TRANSFER: 'TRF',
  ADJUSTMENT: 'ADJ',
};

const seqCounters: Record<string, number> = {};

function nextDocNumber(type: string, year = 2026): string {
  const key = type;
  seqCounters[key] = (seqCounters[key] ?? 0) + 1;
  const prefix = prefixMap[type] ?? type.substring(0, 3);
  return `${prefix}-${year}-${String(seqCounters[key]).padStart(4, '0')}`;
}

function date(d: string): Date {
  return new Date(d + 'T00:00:00.000Z');
}

function dateTime(ts: string): Date {
  return new Date(ts);
}

async function seed() {
  // ── Idempotency check ─────────────────────────────────────────────────────
  const existing = await prisma.user.findUnique({ where: { email: 'owner@persona.pk' } });
  if (existing) {
    console.log('Already seeded — skipping (owner@persona.pk exists)');
    return;
  }

  console.log('🌱 Starting comprehensive seed...\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TENANT + USERS
  // ═══════════════════════════════════════════════════════════════════════════
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Persona Wholesale Trading',
      baseCurrency: 'PKR',
      timezone: 'Asia/Karachi',
    },
  });
  const T = tenant.id;
  console.log(`✓ Tenant: ${tenant.name} (${T})`);

  const passwordHash = await hash('Owner@123', 12);
  const owner = await prisma.user.create({
    data: { tenantId: T, fullName: 'Ahmed Khan', email: 'owner@persona.pk', passwordHash, role: 'OWNER' },
  });
  const admin = await prisma.user.create({
    data: { tenantId: T, fullName: 'Sara Malik', email: 'admin@persona.pk', passwordHash: await hash('Admin@123', 12), role: 'ADMIN' },
  });
  const staff = await prisma.user.create({
    data: { tenantId: T, fullName: 'Ali Raza', email: 'staff@persona.pk', passwordHash: await hash('Staff@123', 12), role: 'STAFF' },
  });
  console.log(`✓ Users: owner=${owner.email}, admin=${admin.email}, staff=${staff.email}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. SUPPLIERS (6)
  // ═══════════════════════════════════════════════════════════════════════════
  const supplierData = [
    { name: 'ABC Textiles',         phone: '+92-300-1234567', address: '23-A Industrial Area, Faisalabad',     notes: 'Primary fabric supplier' },
    { name: 'XYZ Fabrics',          phone: '+92-321-9876543', address: '45-B Cloth Market, Lahore',            notes: 'Premium silk and cotton' },
    { name: 'Pakistan Garments Co', phone: '+92-333-4567890', address: 'Plot 12, SITE Area, Karachi',          notes: 'Ready-made garments' },
    { name: 'Eastern Thread Mills', phone: '+92-300-5551234', address: '67 Mill Road, Multan',                 notes: 'Thread and accessories' },
    { name: 'Royal Button House',   phone: '+92-312-7778888', address: 'Shop 8, Jodia Bazar, Karachi',         notes: 'Buttons, zippers, trims' },
    { name: 'Star Packaging',       phone: '+92-345-1112222', address: '99 Packaging Lane, Lahore',            notes: 'Boxes, bags, labels' },
  ];
  const suppliers = await Promise.all(
    supplierData.map((s) => prisma.supplier.create({ data: { tenantId: T, createdBy: owner.id, ...s } })),
  );
  // Deactivate one supplier for status-filter testing
  await prisma.supplier.update({ where: { id: suppliers[5].id }, data: { status: 'INACTIVE' } });
  console.log(`✓ Suppliers: ${suppliers.length} (1 inactive)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CUSTOMERS (8)
  // ═══════════════════════════════════════════════════════════════════════════
  const customerData = [
    { name: 'Fashion Hub Karachi',   phone: '+92-321-1111111', address: 'Shop 12, Tariq Road, Karachi',        notes: 'Large retail store' },
    { name: 'Style Corner Lahore',   phone: '+92-321-2222222', address: 'M.M. Alam Road, Lahore',              notes: 'Premium boutique' },
    { name: 'Budget Mart Islamabad', phone: '+92-333-3333333', address: 'F-6 Markaz, Islamabad',               notes: 'Budget retail chain' },
    { name: 'Al-Noor Collection',    phone: '+92-300-4444444', address: 'Saddar, Rawalpindi',                   notes: 'Wholesale reseller' },
    { name: 'Trendy Wear Multan',    phone: '+92-345-5555555', address: 'Hussain Agahi, Multan',               notes: 'Regional distributor' },
    { name: 'Classic Garments',      phone: '+92-312-6666666', address: 'Burns Garden, Karachi',               notes: 'Wedding & formal wear' },
    { name: 'Quick Fashion Online',  phone: '+92-333-7777777', address: 'DHA Phase 5, Lahore',                 notes: 'E-commerce store' },
    { name: 'Sana Boutique',         phone: '+92-300-8888888', address: 'Zamzama, Karachi',                     notes: 'Women specialty' },
  ];
  const customers = await Promise.all(
    customerData.map((c) => prisma.customer.create({ data: { tenantId: T, createdBy: owner.id, ...c } })),
  );
  // Deactivate one customer for testing inactive filters
  await prisma.customer.update({ where: { id: customers[7].id }, data: { status: 'INACTIVE' } });
  console.log(`✓ Customers: ${customers.length} (1 inactive)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. PRODUCTS + VARIANTS (9 products, 35+ variants)
  // ═══════════════════════════════════════════════════════════════════════════
  const sizesSML  = ['S', 'M', 'L', 'XL', 'XXL'];
  const sizesShoe = ['40', '41', '42', '43', '44'];

  const productDefs = [
    { name: 'Men Suit - Black',        sku: 'SUIT-BLK',  category: 'Suits',       unit: 'piece', sizes: sizesSML },
    { name: 'Men Suit - Navy Blue',    sku: 'SUIT-NAV',  category: 'Suits',       unit: 'piece', sizes: sizesSML },
    { name: 'Men Suit - Charcoal',     sku: 'SUIT-CHR',  category: 'Suits',       unit: 'piece', sizes: ['M', 'L', 'XL'] },
    { name: 'Dress Shirt - White',     sku: 'SHRT-WHT',  category: 'Shirts',      unit: 'piece', sizes: sizesSML },
    { name: 'Dress Shirt - Blue',      sku: 'SHRT-BLU',  category: 'Shirts',      unit: 'piece', sizes: sizesSML },
    { name: 'Silk Tie - Red',          sku: 'TIE-RED',   category: 'Accessories', unit: 'piece', sizes: ['one-size'] },
    { name: 'Leather Belt - Brown',    sku: 'BELT-BRN',  category: 'Accessories', unit: 'piece', sizes: ['S', 'M', 'L'] },
    { name: 'Formal Shoes - Black',    sku: 'SHOE-BLK',  category: 'Footwear',    unit: 'pair',  sizes: sizesShoe },
  ];

  const products: Array<{ id: string; name: string; sku: string; variants: Array<{ id: string; size: string }> }> = [];

  for (const p of productDefs) {
    const product = await prisma.product.create({
      data: {
        tenantId: T,
        name: p.name,
        sku: p.sku,
        category: p.category,
        unit: p.unit,
        createdBy: owner.id,
        variants: {
          create: p.sizes.map((size) => ({
            tenantId: T,
            size,
            createdBy: owner.id,
          })),
        },
      },
      include: { variants: true },
    });
    products.push({
      id: product.id,
      name: product.name,
      sku: p.sku,
      variants: product.variants.map((v) => ({ id: v.id, size: v.size })),
    });
  }

  // Add one archived/legacy product to exercise inactive status filters
  const legacyProduct = await prisma.product.create({
    data: {
      tenantId: T,
      name: 'Legacy Waistcoat - Grey',
      sku: 'LEG-WST-GRY',
      category: 'Legacy',
      unit: 'piece',
      status: 'INACTIVE',
      createdBy: owner.id,
      variants: {
        create: [{ tenantId: T, size: 'one-size', status: 'INACTIVE', createdBy: owner.id }],
      },
    },
    include: { variants: true },
  });
  products.push({
    id: legacyProduct.id,
    name: legacyProduct.name,
    sku: legacyProduct.sku ?? 'LEG-WST-GRY',
    variants: legacyProduct.variants.map((vr) => ({ id: vr.id, size: vr.size })),
  });

  // Mark one active product variant inactive for variant-status filter testing
  const size44 = products[7].variants.find((vr) => vr.size === '44');
  if (!size44) throw new Error('Formal Shoes size 44 variant not found');
  await prisma.productVariant.update({ where: { id: size44.id }, data: { status: 'INACTIVE' } });

  console.log(`✓ Products: ${products.length} (${products.reduce((s, p) => s + p.variants.length, 0)} variants total, with inactive product + variant)`);

  // Helper to find variant by product index + size
  function v(productIdx: number, size: string): string {
    const variant = products[productIdx].variants.find((vr) => vr.size === size);
    if (!variant) throw new Error(`Variant not found: product=${products[productIdx].name} size=${size}`);
    return variant.id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PAYMENT ACCOUNTS (6)
  // ═══════════════════════════════════════════════════════════════════════════
  const accountDefs: Array<{ name: string; type: PaymentAccountType; openingBalance: number; status?: 'ACTIVE' | 'INACTIVE' }> = [
    { name: 'Main Cash',        type: 'CASH',   openingBalance: 500000 },
    { name: 'HBL Business',     type: 'BANK',   openingBalance: 2000000 },
    { name: 'JazzCash Wallet',  type: 'WALLET', openingBalance: 50000 },
    { name: 'Meezan Bank',      type: 'BANK',   openingBalance: 1000000 },
    { name: 'Corporate Card',   type: 'CARD',   openingBalance: 25000 },
    { name: 'Archived Cashbox', type: 'CASH',   openingBalance: 0, status: 'INACTIVE' },
  ];

  const accounts = await Promise.all(
    accountDefs.map((a) => prisma.paymentAccount.create({ data: { tenantId: T, createdBy: owner.id, ...a } })),
  );
  console.log(`✓ Payment Accounts: ${accounts.length} (total opening: PKR ${accountDefs.reduce((s, a) => s + a.openingBalance, 0).toLocaleString()})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TRANSACTIONS — Full lifecycle simulation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── Creating transactions ───');

  // ── 6.1  PURCHASE #1: From ABC Textiles — Men Suit Black (bulk) ──────────
  const pur1 = await createPostedPurchase({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[0].id,
    transactionDate: '2025-10-15',
    lines: [
      { variantId: v(0, 'S'),  qty: 20, unitCost: 8000, discount: 0 },
      { variantId: v(0, 'M'),  qty: 40, unitCost: 8000, discount: 0 },
      { variantId: v(0, 'L'),  qty: 30, unitCost: 8500, discount: 0 },
      { variantId: v(0, 'XL'), qty: 20, unitCost: 8500, discount: 0 },
      { variantId: v(0, 'XXL'),qty: 10, unitCost: 9000, discount: 0 },
    ],
    deliveryFee: 5000,
    paidNow: 200000,
    paymentAccountId: accounts[1].id,  // HBL
    notes: 'Initial stock - Black suits',
  });
  console.log(`  ✓ PUR #1: ${pur1.documentNumber} — PKR ${pur1.totalAmount.toLocaleString()} (paid ${pur1.paidNow.toLocaleString()})`);

  // ── 6.2  PURCHASE #2: From XYZ Fabrics — Navy suits + Shirts ────────────
  const pur2 = await createPostedPurchase({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[1].id,
    transactionDate: '2025-12-05',
    lines: [
      { variantId: v(1, 'M'),  qty: 25, unitCost: 8500, discount: 500 },
      { variantId: v(1, 'L'),  qty: 25, unitCost: 8500, discount: 500 },
      { variantId: v(1, 'XL'), qty: 15, unitCost: 9000, discount: 0 },
      { variantId: v(3, 'M'),  qty: 50, unitCost: 2500, discount: 0 },
      { variantId: v(3, 'L'),  qty: 50, unitCost: 2500, discount: 0 },
    ],
    deliveryFee: 3000,
    paidNow: 0,  // Fully on credit
    notes: 'Navy suits + white shirts bulk order',
  });
  console.log(`  ✓ PUR #2: ${pur2.documentNumber} — PKR ${pur2.totalAmount.toLocaleString()} (on credit)`);

  // ── 6.3  PURCHASE #3: Accessories from Royal Button House ────────────────
  const pur3 = await createPostedPurchase({
    tenantId: T, userId: admin.id,
    supplierId: suppliers[4].id,
    transactionDate: '2026-01-05',
    lines: [
      { variantId: v(5, 'one-size'), qty: 100, unitCost: 1200, discount: 0 },  // Ties
      { variantId: v(6, 'M'),        qty: 50,  unitCost: 2000, discount: 0 },  // Belts
      { variantId: v(6, 'L'),        qty: 30,  unitCost: 2000, discount: 0 },  // Belts
    ],
    deliveryFee: 1000,
    paidNow: 100000,
    paymentAccountId: accounts[0].id,  // Cash
    notes: 'Accessories restock',
  });
  console.log(`  ✓ PUR #3: ${pur3.documentNumber} — PKR ${pur3.totalAmount.toLocaleString()}`);

  // ── 6.4  PURCHASE #4: Formal shoes from Pakistan Garments ────────────────
  const pur4 = await createPostedPurchase({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[2].id,
    transactionDate: '2026-02-14',
    lines: [
      { variantId: v(7, '41'), qty: 20, unitCost: 5000, discount: 0 },
      { variantId: v(7, '42'), qty: 30, unitCost: 5000, discount: 0 },
      { variantId: v(7, '43'), qty: 20, unitCost: 5000, discount: 0 },
    ],
    deliveryFee: 2000,
    paidNow: 352000,
    paymentAccountId: accounts[1].id,
    notes: 'Formal shoes - first batch',
  });
  console.log(`  ✓ PUR #4: ${pur4.documentNumber} — PKR ${pur4.totalAmount.toLocaleString()}`);

  // ── 6.5  PURCHASE #5: Blue shirts — partial payment ─────────────────────
  const pur5 = await createPostedPurchase({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[1].id,
    transactionDate: '2026-02-18',
    lines: [
      { variantId: v(4, 'S'),  qty: 30, unitCost: 2800, discount: 200 },
      { variantId: v(4, 'M'),  qty: 50, unitCost: 2800, discount: 200 },
      { variantId: v(4, 'L'),  qty: 40, unitCost: 2800, discount: 200 },
      { variantId: v(4, 'XL'), qty: 20, unitCost: 3000, discount: 0 },
    ],
    deliveryFee: 2000,
    paidNow: 150000,
    paymentAccountId: accounts[0].id,
    notes: 'Blue dress shirts',
  });
  console.log(`  ✓ PUR #5: ${pur5.documentNumber} — PKR ${pur5.totalAmount.toLocaleString()}`);

  // ── 6.6  PURCHASE #6 (DRAFT): Charcoal suits — not posted yet ───────────
  const pur6Draft = await createDraftPurchase({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[0].id,
    transactionDate: '2026-02-18',
    lines: [
      { variantId: v(2, 'M'),  qty: 15, unitCost: 9000, discount: 0 },
      { variantId: v(2, 'L'),  qty: 15, unitCost: 9000, discount: 0 },
      { variantId: v(2, 'XL'), qty: 10, unitCost: 9500, discount: 0 },
    ],
    deliveryFee: 3000,
    notes: 'Charcoal suit restock — awaiting approval',
  });
  console.log(`  ✓ PUR #6: DRAFT — PKR ${pur6Draft.totalAmount.toLocaleString()}`);

  // ── 6.7  SALE #1: To Fashion Hub Karachi ────────────────────────────────
  const sal1 = await createPostedSale({
    tenantId: T, userId: staff.id,
    customerId: customers[0].id,
    transactionDate: '2025-10-25',
    lines: [
      { variantId: v(0, 'M'),  qty: 10, unitPrice: 14000, discount: 1000 },
      { variantId: v(0, 'L'),  qty: 8,  unitPrice: 14500, discount: 0 },
      { variantId: v(3, 'M'),  qty: 15, unitPrice: 4500,  discount: 0 },
      { variantId: v(5, 'one-size'), qty: 20, unitPrice: 2500, discount: 0 },
    ],
    deliveryFee: 2000,
    receivedNow: 100000,
    paymentAccountId: accounts[0].id,
    notes: 'Bulk order - Fashion Hub',
  });
  console.log(`  ✓ SAL #1: ${sal1.documentNumber} — PKR ${sal1.totalAmount.toLocaleString()} (received ${sal1.paidNow.toLocaleString()})`);

  // ── 6.8  SALE #2: To Style Corner Lahore ────────────────────────────────
  const sal2 = await createPostedSale({
    tenantId: T, userId: staff.id,
    customerId: customers[1].id,
    transactionDate: '2025-12-10',
    lines: [
      { variantId: v(1, 'M'),  qty: 5, unitPrice: 15000, discount: 0 },
      { variantId: v(1, 'L'),  qty: 5, unitPrice: 15000, discount: 0 },
      { variantId: v(6, 'M'),  qty: 10, unitPrice: 3500, discount: 0 },
    ],
    deliveryFee: 3000,
    receivedNow: 0,
    notes: 'Style Corner - on credit',
  });
  console.log(`  ✓ SAL #2: ${sal2.documentNumber} — PKR ${sal2.totalAmount.toLocaleString()} (on credit)`);

  // ── 6.9  SALE #3: To Budget Mart ────────────────────────────────────────
  const sal3 = await createPostedSale({
    tenantId: T, userId: owner.id,
    customerId: customers[2].id,
    transactionDate: '2026-01-10',
    lines: [
      { variantId: v(0, 'XL'), qty: 5,  unitPrice: 13000, discount: 500 },
      { variantId: v(3, 'L'),  qty: 20, unitPrice: 4200,  discount: 0 },
      { variantId: v(4, 'M'),  qty: 15, unitPrice: 4800,  discount: 300 },
    ],
    deliveryFee: 1500,
    receivedNow: 50000,
    paymentAccountId: accounts[2].id,  // JazzCash
    notes: 'Budget Mart - mixed order',
  });
  console.log(`  ✓ SAL #3: ${sal3.documentNumber} — PKR ${sal3.totalAmount.toLocaleString()}`);

  // ── 6.10 SALE #4: To Al-Noor Collection (large wholesale) ───────────────
  const sal4 = await createPostedSale({
    tenantId: T, userId: owner.id,
    customerId: customers[3].id,
    transactionDate: '2026-02-05',
    lines: [
      { variantId: v(0, 'S'),  qty: 10, unitPrice: 12000, discount: 0 },
      { variantId: v(0, 'M'),  qty: 15, unitPrice: 12000, discount: 0 },
      { variantId: v(7, '42'), qty: 10, unitPrice: 8000,  discount: 0 },
      { variantId: v(7, '43'), qty: 8,  unitPrice: 8000,  discount: 0 },
    ],
    deliveryFee: 5000,
    receivedNow: 200000,
    paymentAccountId: accounts[1].id,
    notes: 'Al-Noor wholesale order',
  });
  console.log(`  ✓ SAL #4: ${sal4.documentNumber} — PKR ${sal4.totalAmount.toLocaleString()}`);

  // ── 6.11 SALE #5: To Trendy Wear (shoe-focused) ────────────────────────
  const sal5 = await createPostedSale({
    tenantId: T, userId: staff.id,
    customerId: customers[4].id,
    transactionDate: '2026-02-18',
    lines: [
      { variantId: v(7, '41'), qty: 8, unitPrice: 8500, discount: 0 },
      { variantId: v(7, '42'), qty: 10, unitPrice: 8500, discount: 500 },
      { variantId: v(4, 'S'),  qty: 10, unitPrice: 4500, discount: 0 },
    ],
    deliveryFee: 2000,
    receivedNow: 0,
    notes: 'Trendy Wear - net 30',
  });
  console.log(`  ✓ SAL #5: ${sal5.documentNumber} — PKR ${sal5.totalAmount.toLocaleString()}`);

  // ── 6.12 SALE #6 (DRAFT): To Classic Garments ──────────────────────────
  const sal6Draft = await createDraftSale({
    tenantId: T, userId: staff.id,
    customerId: customers[5].id,
    transactionDate: '2026-02-18',
    lines: [
      { variantId: v(1, 'L'),  qty: 3, unitPrice: 16000, discount: 0 },
      { variantId: v(1, 'XL'), qty: 2, unitPrice: 16500, discount: 0 },
    ],
    deliveryFee: 1500,
    notes: 'Classic Garments - pending confirmation',
  });
  console.log(`  ✓ SAL #6: DRAFT — PKR ${sal6Draft.totalAmount.toLocaleString()}`);

  // ── 6.13 SUPPLIER PAYMENT #1: Pay ABC Textiles ──────────────────────────
  const spy1 = await createPostedSupplierPayment({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[0].id,
    amount: 300000,
    paymentAccountId: accounts[1].id,
    transactionDate: '2025-11-01',
    allocateToTransactionId: pur1.id,
    notes: 'Partial payment against PUR #1',
  });
  console.log(`  ✓ SPY #1: ${spy1.documentNumber} — PKR 300,000 to ABC Textiles`);

  // ── 6.14 SUPPLIER PAYMENT #2: Pay XYZ Fabrics ──────────────────────────
  const spy2 = await createPostedSupplierPayment({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[1].id,
    amount: 200000,
    paymentAccountId: accounts[0].id,
    transactionDate: '2026-02-18',
    allocateToTransactionId: pur2.id,
    notes: 'Payment against navy suits invoice',
  });
  console.log(`  ✓ SPY #2: ${spy2.documentNumber} — PKR 200,000 to XYZ Fabrics`);

  // ── 6.15 CUSTOMER PAYMENT #1: From Fashion Hub ─────────────────────────
  const cpy1 = await createPostedCustomerPayment({
    tenantId: T, userId: owner.id,
    customerId: customers[0].id,
    amount: 150000,
    paymentAccountId: accounts[0].id,
    transactionDate: '2025-11-20',
    allocateToTransactionId: sal1.id,
    notes: 'Fashion Hub payment',
  });
  console.log(`  ✓ CPY #1: ${cpy1.documentNumber} — PKR 150,000 from Fashion Hub`);

  // ── 6.16 CUSTOMER PAYMENT #2: From Style Corner ────────────────────────
  const cpy2 = await createPostedCustomerPayment({
    tenantId: T, userId: owner.id,
    customerId: customers[1].id,
    amount: 100000,
    paymentAccountId: accounts[1].id,
    transactionDate: '2026-01-15',
    allocateToTransactionId: sal2.id,
    notes: 'Style Corner partial payment',
  });
  console.log(`  ✓ CPY #2: ${cpy2.documentNumber} — PKR 100,000 from Style Corner`);

  // ── 6.17 CUSTOMER PAYMENT #3: From Al-Noor ─────────────────────────────
  const cpy3 = await createPostedCustomerPayment({
    tenantId: T, userId: owner.id,
    customerId: customers[3].id,
    amount: 250000,
    paymentAccountId: accounts[1].id,
    transactionDate: '2026-02-18',
    allocateToTransactionId: sal4.id,
    notes: 'Al-Noor clearing balance',
  });
  console.log(`  ✓ CPY #3: ${cpy3.documentNumber} — PKR 250,000 from Al-Noor`);

  // ── 6.18 SUPPLIER RETURN: Return defective ties to Royal Button House ──
  // Find the tie line from PUR #3
  const pur3Lines = await prisma.transactionLine.findMany({ where: { transactionId: pur3.id } });
  const tieLine = pur3Lines.find((l) => l.variantId === v(5, 'one-size'));
  if (!tieLine) throw new Error('Tie line not found in PUR #3');

  const srn1 = await createPostedSupplierReturn({
    tenantId: T, userId: owner.id,
    supplierId: suppliers[4].id,
    transactionDate: '2026-01-15',
    lines: [{ sourceTransactionLineId: tieLine.id, variantId: tieLine.variantId, qty: 10, unitCost: tieLine.unitCost }],
    notes: '10 ties returned - stitching defect',
  });
  console.log(`  ✓ SRN #1: ${srn1.documentNumber} — 10 ties returned to Royal Button House`);

  // ── 6.19 CUSTOMER RETURN: Fashion Hub returns 3 suits ──────────────────
  const sal1Lines = await prisma.transactionLine.findMany({ where: { transactionId: sal1.id } });
  const suitMLine = sal1Lines.find((l) => l.variantId === v(0, 'M'));
  if (!suitMLine) throw new Error('Suit M line not found in SAL #1');

  const crn1 = await createPostedCustomerReturn({
    tenantId: T, userId: owner.id,
    customerId: customers[0].id,
    transactionDate: '2025-12-01',
    lines: [{ sourceTransactionLineId: suitMLine.id, variantId: suitMLine.variantId, qty: 2, unitPrice: suitMLine.unitPrice }],
    returnHandling: 'STORE_CREDIT',
    notes: 'Customer returned 2 suits - wrong size',
  });
  console.log(`  ✓ CRN #1: ${crn1.documentNumber} — 2 suits returned by Fashion Hub (store credit)`);

  // ── 6.20 INTERNAL TRANSFER: Cash → HBL Bank ───────────────────────────
  const trf1 = await createPostedInternalTransfer({
    tenantId: T, userId: owner.id,
    fromAccountId: accounts[0].id,
    toAccountId: accounts[1].id,
    amount: 200000,
    transactionDate: '2026-02-12',
    notes: 'Monthly cash deposit to bank',
  });
  console.log(`  ✓ TRF #1: ${trf1.documentNumber} — PKR 200,000 Cash → HBL Bank`);

  // ── 6.21 INTERNAL TRANSFER: HBL → JazzCash ────────────────────────────
  const trf2 = await createPostedInternalTransfer({
    tenantId: T, userId: admin.id,
    fromAccountId: accounts[1].id,
    toAccountId: accounts[2].id,
    amount: 30000,
    transactionDate: '2026-02-18',
    notes: 'Top up JazzCash wallet',
  });
  console.log(`  ✓ TRF #2: ${trf2.documentNumber} — PKR 30,000 HBL → JazzCash`);

  // ── 6.22 STOCK ADJUSTMENT: IN (found extra inventory) ─────────────────
  const adj1 = await createPostedAdjustment({
    tenantId: T, userId: owner.id,
    transactionDate: '2026-02-13',
    lines: [
      { variantId: v(3, 'M'), qty: 5, direction: 'IN' as const, reason: 'Found extra stock during count' },
      { variantId: v(3, 'L'), qty: 3, direction: 'IN' as const, reason: 'Found extra stock during count' },
    ],
    notes: 'Quarterly stock reconciliation',
  });
  console.log(`  ✓ ADJ #1: ${adj1.documentNumber} — Stock IN (shirts found during count)`);

  // ── 6.23 STOCK ADJUSTMENT: OUT (damaged goods) ────────────────────────
  const adj2 = await createPostedAdjustment({
    tenantId: T, userId: owner.id,
    transactionDate: '2026-02-18',
    lines: [
      { variantId: v(0, 'XXL'), qty: 2, direction: 'OUT' as const, reason: 'Water damage in warehouse' },
      { variantId: v(4, 'L'),   qty: 3, direction: 'OUT' as const, reason: 'Moth damage' },
    ],
    notes: 'Damaged goods write-off',
  });
  console.log(`  ✓ ADJ #2: ${adj2.documentNumber} — Stock OUT (damaged goods)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. IMPORT BATCHES + ROWS (screens 37-41 coverage)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── Creating import history ───');

  // Records that simulate successful imports (kept dependency-free for rollback testing)
  const importedSupplierA = await prisma.supplier.create({
    data: {
      tenantId: T,
      name: 'Imported Supplier Alpha',
      phone: '+92-300-9000101',
      address: 'Import Lane, Karachi',
      notes: 'Created via simulated import',
      createdBy: admin.id,
    },
  });
  const importedSupplierB = await prisma.supplier.create({
    data: {
      tenantId: T,
      name: 'Imported Supplier Beta',
      phone: '+92-300-9000102',
      address: 'Import Lane, Lahore',
      notes: 'Created via simulated import',
      createdBy: admin.id,
    },
  });

  const importedProductA = await prisma.product.create({
    data: {
      tenantId: T,
      name: 'Imported Cufflinks - Silver',
      sku: 'IMP-CUFF-SLV',
      category: 'Accessories',
      unit: 'piece',
      createdBy: admin.id,
      variants: { create: [{ tenantId: T, size: 'one-size', createdBy: admin.id }] },
    },
  });
  const importedProductB = await prisma.product.create({
    data: {
      tenantId: T,
      name: 'Imported Pocket Square - Navy',
      sku: 'IMP-PSQ-NAV',
      category: 'Accessories',
      unit: 'piece',
      createdBy: admin.id,
      variants: { create: [{ tenantId: T, size: 'one-size', createdBy: admin.id }] },
    },
  });

  const importPendingBatch = await prisma.importBatch.create({
    data: {
      tenantId: T,
      sourceType: 'CSV',
      module: 'SUPPLIERS',
      fileName: 'suppliers-pending.csv',
      status: 'PENDING_MAPPING',
      totalRows: 3,
      successRows: 0,
      failedRows: 0,
      createdBy: admin.id,
      createdAt: dateTime('2026-02-12T08:15:00.000Z'),
      updatedAt: dateTime('2026-02-12T08:15:00.000Z'),
    },
  });
  await prisma.importRow.createMany({
    data: [
      { tenantId: T, importBatchId: importPendingBatch.id, rowNumber: 1, rawDataJson: { Company: 'Nisa Fabrics', Phone: '+92-300-1000001' }, status: 'PENDING' },
      { tenantId: T, importBatchId: importPendingBatch.id, rowNumber: 2, rawDataJson: { Company: 'Raza Traders', Phone: '+92-300-1000002' }, status: 'PENDING' },
      { tenantId: T, importBatchId: importPendingBatch.id, rowNumber: 3, rawDataJson: { Company: 'Memon Threads', Phone: '+92-300-1000003' }, status: 'PENDING' },
    ],
  });

  const importValidatedBatch = await prisma.importBatch.create({
    data: {
      tenantId: T,
      sourceType: 'EXCEL',
      module: 'CUSTOMERS',
      fileName: 'customers-validated.xlsx',
      status: 'VALIDATED',
      totalRows: 4,
      successRows: 0,
      failedRows: 0,
      createdBy: owner.id,
      createdAt: dateTime('2026-02-13T09:10:00.000Z'),
      updatedAt: dateTime('2026-02-13T09:25:00.000Z'),
    },
  });
  await prisma.importRow.createMany({
    data: [
      { tenantId: T, importBatchId: importValidatedBatch.id, rowNumber: 1, rawDataJson: { name: 'Hassan Menswear', phone: '+92-321-0000001' }, status: 'VALID' },
      { tenantId: T, importBatchId: importValidatedBatch.id, rowNumber: 2, rawDataJson: { name: '', phone: '+92-321-0000002' }, status: 'INVALID', errorMessage: 'name is required' },
      { tenantId: T, importBatchId: importValidatedBatch.id, rowNumber: 3, rawDataJson: { name: 'Prime Cloth House', phone: '+92-321-0000003' }, status: 'VALID' },
      { tenantId: T, importBatchId: importValidatedBatch.id, rowNumber: 4, rawDataJson: { name: 'Boutique Hub', phone: 'abc' }, status: 'INVALID', errorMessage: 'phone format is invalid' },
    ],
  });

  const importCompletedBatch = await prisma.importBatch.create({
    data: {
      tenantId: T,
      sourceType: 'CSV',
      module: 'PRODUCTS',
      fileName: 'products-completed.csv',
      status: 'COMPLETED',
      totalRows: 3,
      successRows: 2,
      failedRows: 1,
      createdBy: admin.id,
      createdAt: dateTime('2026-02-14T10:40:00.000Z'),
      updatedAt: dateTime('2026-02-14T11:05:00.000Z'),
    },
  });
  await prisma.importRow.createMany({
    data: [
      {
        tenantId: T,
        importBatchId: importCompletedBatch.id,
        rowNumber: 1,
        rawDataJson: { name: 'Imported Cufflinks - Silver', sku: 'IMP-CUFF-SLV', category: 'Accessories', unit: 'piece' },
        status: 'SUCCESS',
        createdRecordType: 'PRODUCT',
        createdRecordId: importedProductA.id,
      },
      {
        tenantId: T,
        importBatchId: importCompletedBatch.id,
        rowNumber: 2,
        rawDataJson: { name: 'Imported Duplicate SKU', sku: 'SUIT-BLK', category: 'Accessories', unit: 'piece' },
        status: 'FAILED',
        errorMessage: 'Duplicate SKU',
      },
      {
        tenantId: T,
        importBatchId: importCompletedBatch.id,
        rowNumber: 3,
        rawDataJson: { name: 'Imported Pocket Square - Navy', sku: 'IMP-PSQ-NAV', category: 'Accessories', unit: 'piece' },
        status: 'SUCCESS',
        createdRecordType: 'PRODUCT',
        createdRecordId: importedProductB.id,
      },
    ],
  });

  const importRollbackReadyBatch = await prisma.importBatch.create({
    data: {
      tenantId: T,
      sourceType: 'CSV',
      module: 'SUPPLIERS',
      fileName: 'suppliers-rollback-ready.csv',
      status: 'COMPLETED',
      totalRows: 2,
      successRows: 2,
      failedRows: 0,
      createdBy: owner.id,
      createdAt: dateTime('2026-02-15T07:20:00.000Z'),
      updatedAt: dateTime('2026-02-15T07:28:00.000Z'),
    },
  });
  await prisma.importRow.createMany({
    data: [
      {
        tenantId: T,
        importBatchId: importRollbackReadyBatch.id,
        rowNumber: 1,
        rawDataJson: { name: 'Imported Supplier Alpha', phone: '+92-300-9000101' },
        status: 'SUCCESS',
        createdRecordType: 'SUPPLIER',
        createdRecordId: importedSupplierA.id,
      },
      {
        tenantId: T,
        importBatchId: importRollbackReadyBatch.id,
        rowNumber: 2,
        rawDataJson: { name: 'Imported Supplier Beta', phone: '+92-300-9000102' },
        status: 'SUCCESS',
        createdRecordType: 'SUPPLIER',
        createdRecordId: importedSupplierB.id,
      },
    ],
  });

  const importRolledBackBatch = await prisma.importBatch.create({
    data: {
      tenantId: T,
      sourceType: 'EXCEL',
      module: 'OPENING_BALANCES',
      fileName: 'opening-balances-rolled-back.xlsx',
      status: 'ROLLED_BACK',
      totalRows: 2,
      successRows: 2,
      failedRows: 0,
      createdBy: owner.id,
      createdAt: dateTime('2026-02-16T06:30:00.000Z'),
      updatedAt: dateTime('2026-02-16T06:45:00.000Z'),
    },
  });
  await prisma.importRow.createMany({
    data: [
      {
        tenantId: T,
        importBatchId: importRolledBackBatch.id,
        rowNumber: 1,
        rawDataJson: { accountName: 'Main Cash', amount: '450000', previousOpeningBalance: 500000 },
        status: 'VALID',
      },
      {
        tenantId: T,
        importBatchId: importRolledBackBatch.id,
        rowNumber: 2,
        rawDataJson: { accountName: 'HBL Business', amount: '1800000', previousOpeningBalance: 2000000 },
        status: 'VALID',
      },
    ],
  });
  console.log('  ✓ Imports: 5 batches seeded (PENDING_MAPPING, VALIDATED, COMPLETED, ROLLED_BACK + rollback-ready)');

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. DOCUMENT SEQUENCES (persist final counts)
  // ═══════════════════════════════════════════════════════════════════════════
  for (const [type, count] of Object.entries(seqCounters)) {
    await prisma.documentSequence.create({
      data: { tenantId: T, transactionType: type, lastValue: count },
    });
  }
  console.log(`\n✓ Document sequences synced`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  const [supplierCount, customerCount, productCount, variantCount, paymentAccountCount, importBatchCount] = await Promise.all([
    prisma.supplier.count({ where: { tenantId: T } }),
    prisma.customer.count({ where: { tenantId: T } }),
    prisma.product.count({ where: { tenantId: T } }),
    prisma.productVariant.count({ where: { tenantId: T } }),
    prisma.paymentAccount.count({ where: { tenantId: T } }),
    prisma.importBatch.count({ where: { tenantId: T } }),
  ]);

  const txnCounts = await prisma.transaction.groupBy({
    by: ['type', 'status'],
    where: { tenantId: T },
    _count: true,
  });
  console.log('\n═══ SEED SUMMARY ═══');
  console.log(`Tenant:           ${tenant.name}`);
  console.log(`Users:            3 (OWNER, ADMIN, STAFF)`);
  console.log(`Suppliers:        ${supplierCount}`);
  console.log(`Customers:        ${customerCount}`);
  console.log(`Products:         ${productCount} (${variantCount} variants)`);
  console.log(`Payment Accounts: ${paymentAccountCount}`);
  console.log(`Import Batches:   ${importBatchCount}`);
  console.log(`Transactions:`);
  for (const row of txnCounts) {
    console.log(`  ${row.type} [${row.status}]: ${row._count}`);
  }
  console.log(`\nLogin credentials:`);
  console.log(`  OWNER: owner@persona.pk / Owner@123`);
  console.log(`  ADMIN: admin@persona.pk / Admin@123`);
  console.log(`  STAFF: staff@persona.pk / Staff@123`);
  console.log('\n✅ Seed complete!\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS — Simulate what the PostingService does
  // ═══════════════════════════════════════════════════════════════════════════

  interface PurchaseLine { variantId: string; qty: number; unitCost: number; discount: number }
  interface SaleLine { variantId: string; qty: number; unitPrice: number; discount: number }

  async function createDraftPurchase(p: {
    tenantId: string; userId: string; supplierId: string; transactionDate: string;
    lines: PurchaseLine[]; deliveryFee: number; notes?: string;
  }) {
    const subtotal = p.lines.reduce((s, l) => s + (l.qty * l.unitCost - l.discount), 0);
    const discountTotal = p.lines.reduce((s, l) => s + l.discount, 0);
    const totalAmount = subtotal + p.deliveryFee;

    return prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'PURCHASE', status: 'DRAFT',
        transactionDate: date(p.transactionDate),
        supplierId: p.supplierId, createdBy: p.userId,
        subtotal, discountTotal, deliveryFee: p.deliveryFee, totalAmount,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            unitCost: l.unitCost, discountAmount: l.discount,
            lineTotal: l.qty * l.unitCost - l.discount,
            costTotal: l.qty * l.unitCost - l.discount,
            createdBy: p.userId,
          })),
        },
      },
    });
  }

  async function createPostedPurchase(p: {
    tenantId: string; userId: string; supplierId: string; transactionDate: string;
    lines: PurchaseLine[]; deliveryFee: number; paidNow?: number;
    paymentAccountId?: string; notes?: string;
  }) {
    const paidNow = p.paidNow ?? 0;
    const subtotal = p.lines.reduce((s, l) => s + (l.qty * l.unitCost - l.discount), 0);
    const discountTotal = p.lines.reduce((s, l) => s + l.discount, 0);
    const totalAmount = subtotal + p.deliveryFee;
    const docNumber = nextDocNumber('PURCHASE');

    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'PURCHASE', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        supplierId: p.supplierId, createdBy: p.userId,
        subtotal, discountTotal, deliveryFee: p.deliveryFee, totalAmount, paidNow,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            unitCost: l.unitCost, discountAmount: l.discount,
            lineTotal: l.qty * l.unitCost - l.discount,
            costTotal: l.qty * l.unitCost - l.discount,
            createdBy: p.userId,
          })),
        },
      },
    });

    // Inventory movements (PURCHASE_IN)
    for (const l of p.lines) {
      await prisma.inventoryMovement.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, variantId: l.variantId,
          movementType: 'PURCHASE_IN', quantity: l.qty, unitCostAtTime: l.unitCost,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
      // Update avgCost on variant
      await updateAvgCost(p.tenantId, l.variantId);
    }

    // Ledger entry (AP_INCREASE)
    await prisma.ledgerEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id, entryType: 'AP_INCREASE',
        supplierId: p.supplierId, amount: totalAmount,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    // Payment entry if paidNow > 0
    if (paidNow > 0 && p.paymentAccountId) {
      await prisma.paymentEntry.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id,
          paymentAccountId: p.paymentAccountId,
          entryType: 'MONEY_OUT', direction: 'OUT', amount: paidNow,
          supplierId: p.supplierId,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, entryType: 'AP_DECREASE',
          supplierId: p.supplierId, amount: paidNow,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
      await prisma.allocation.create({
        data: {
          tenantId: p.tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: txn.id,
          amountApplied: paidNow,
          createdBy: p.userId,
        },
      });
    }

    return { ...txn, documentNumber: docNumber };
  }

  async function createDraftSale(p: {
    tenantId: string; userId: string; customerId: string; transactionDate: string;
    lines: SaleLine[]; deliveryFee: number; notes?: string;
  }) {
    const subtotal = p.lines.reduce((s, l) => s + (l.qty * l.unitPrice - l.discount), 0);
    const discountTotal = p.lines.reduce((s, l) => s + l.discount, 0);
    const totalAmount = subtotal + p.deliveryFee;

    return prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'SALE', status: 'DRAFT',
        transactionDate: date(p.transactionDate),
        customerId: p.customerId, createdBy: p.userId,
        subtotal, discountTotal, deliveryFee: p.deliveryFee, totalAmount,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            unitPrice: l.unitPrice, discountAmount: l.discount,
            lineTotal: l.qty * l.unitPrice - l.discount,
            costTotal: l.qty * l.unitPrice - l.discount,
            createdBy: p.userId,
          })),
        },
      },
    });
  }

  async function createPostedSale(p: {
    tenantId: string; userId: string; customerId: string; transactionDate: string;
    lines: SaleLine[]; deliveryFee: number; receivedNow?: number;
    paymentAccountId?: string; notes?: string;
  }) {
    const receivedNow = p.receivedNow ?? 0;
    const subtotal = p.lines.reduce((s, l) => s + (l.qty * l.unitPrice - l.discount), 0);
    const discountTotal = p.lines.reduce((s, l) => s + l.discount, 0);
    const totalAmount = subtotal + p.deliveryFee;
    const docNumber = nextDocNumber('SALE');

    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'SALE', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        customerId: p.customerId, createdBy: p.userId,
        subtotal, discountTotal, deliveryFee: p.deliveryFee, totalAmount, paidNow: receivedNow,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            unitPrice: l.unitPrice, discountAmount: l.discount,
            lineTotal: l.qty * l.unitPrice - l.discount,
            costTotal: l.qty * l.unitPrice - l.discount,
            createdBy: p.userId,
          })),
        },
      },
    });

    // Inventory movements (SALE_OUT)
    for (const l of p.lines) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: l.variantId },
        select: { avgCost: true },
      });
      await prisma.inventoryMovement.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, variantId: l.variantId,
          movementType: 'SALE_OUT', quantity: l.qty, unitCostAtTime: variant?.avgCost ?? 0,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
    }

    // Ledger entry (AR_INCREASE)
    await prisma.ledgerEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id, entryType: 'AR_INCREASE',
        customerId: p.customerId, amount: totalAmount,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    // Payment if receivedNow > 0
    if (receivedNow > 0 && p.paymentAccountId) {
      await prisma.paymentEntry.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id,
          paymentAccountId: p.paymentAccountId,
          entryType: 'MONEY_IN', direction: 'IN', amount: receivedNow,
          customerId: p.customerId,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, entryType: 'AR_DECREASE',
          customerId: p.customerId, amount: receivedNow,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
      await prisma.allocation.create({
        data: {
          tenantId: p.tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: txn.id,
          amountApplied: receivedNow,
          createdBy: p.userId,
        },
      });
    }

    return { ...txn, documentNumber: docNumber };
  }

  async function createPostedSupplierPayment(p: {
    tenantId: string; userId: string; supplierId: string; amount: number;
    paymentAccountId: string; transactionDate: string;
    allocateToTransactionId?: string; notes?: string;
  }) {
    const docNumber = nextDocNumber('SUPPLIER_PAYMENT');
    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'SUPPLIER_PAYMENT', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        supplierId: p.supplierId, createdBy: p.userId,
        totalAmount: p.amount, subtotal: p.amount,
        fromPaymentAccountId: p.paymentAccountId,
        notes: p.notes, idempotencyKey: randomUUID(),
      },
    });

    // Ledger: AP_DECREASE
    await prisma.ledgerEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id, entryType: 'AP_DECREASE',
        supplierId: p.supplierId, amount: p.amount,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    // Payment entry: MONEY_OUT
    await prisma.paymentEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id,
        paymentAccountId: p.paymentAccountId,
        entryType: 'MONEY_OUT', direction: 'OUT', amount: p.amount,
        supplierId: p.supplierId,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    // Allocation
    if (p.allocateToTransactionId) {
      await prisma.allocation.create({
        data: {
          tenantId: p.tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: p.allocateToTransactionId,
          amountApplied: p.amount,
          createdBy: p.userId,
        },
      });
    }

    return { ...txn, documentNumber: docNumber };
  }

  async function createPostedCustomerPayment(p: {
    tenantId: string; userId: string; customerId: string; amount: number;
    paymentAccountId: string; transactionDate: string;
    allocateToTransactionId?: string; notes?: string;
  }) {
    const docNumber = nextDocNumber('CUSTOMER_PAYMENT');
    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'CUSTOMER_PAYMENT', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        customerId: p.customerId, createdBy: p.userId,
        totalAmount: p.amount, subtotal: p.amount,
        fromPaymentAccountId: p.paymentAccountId,
        notes: p.notes, idempotencyKey: randomUUID(),
      },
    });

    // Ledger: AR_DECREASE
    await prisma.ledgerEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id, entryType: 'AR_DECREASE',
        customerId: p.customerId, amount: p.amount,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    // Payment entry: MONEY_IN
    await prisma.paymentEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id,
        paymentAccountId: p.paymentAccountId,
        entryType: 'MONEY_IN', direction: 'IN', amount: p.amount,
        customerId: p.customerId,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    // Allocation
    if (p.allocateToTransactionId) {
      await prisma.allocation.create({
        data: {
          tenantId: p.tenantId,
          paymentTransactionId: txn.id,
          appliesToTransactionId: p.allocateToTransactionId,
          amountApplied: p.amount,
          createdBy: p.userId,
        },
      });
    }

    return { ...txn, documentNumber: docNumber };
  }

  async function createPostedSupplierReturn(p: {
    tenantId: string; userId: string; supplierId: string; transactionDate: string;
    lines: Array<{ sourceTransactionLineId: string; variantId: string; qty: number; unitCost: number }>;
    notes?: string;
  }) {
    const totalAmount = p.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const docNumber = nextDocNumber('SUPPLIER_RETURN');

    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'SUPPLIER_RETURN', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        supplierId: p.supplierId, createdBy: p.userId,
        totalAmount, subtotal: totalAmount,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            unitCost: l.unitCost, lineTotal: l.qty * l.unitCost, costTotal: l.qty * l.unitCost,
            sourceTransactionLineId: l.sourceTransactionLineId,
            createdBy: p.userId,
          })),
        },
      },
    });

    // Inventory: SUPPLIER_RETURN_OUT
    for (const l of p.lines) {
      await prisma.inventoryMovement.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, variantId: l.variantId,
          movementType: 'SUPPLIER_RETURN_OUT', quantity: l.qty, unitCostAtTime: l.unitCost,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
      await updateAvgCost(p.tenantId, l.variantId);
    }

    // Ledger: AP_DECREASE
    await prisma.ledgerEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id, entryType: 'AP_DECREASE',
        supplierId: p.supplierId, amount: totalAmount,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    return { ...txn, documentNumber: docNumber };
  }

  async function createPostedCustomerReturn(p: {
    tenantId: string; userId: string; customerId: string; transactionDate: string;
    lines: Array<{ sourceTransactionLineId: string; variantId: string; qty: number; unitPrice: number }>;
    returnHandling: 'STORE_CREDIT' | 'REFUND_NOW';
    paymentAccountId?: string; notes?: string;
  }) {
    const totalAmount = p.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const docNumber = nextDocNumber('CUSTOMER_RETURN');

    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'CUSTOMER_RETURN', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        customerId: p.customerId, createdBy: p.userId,
        totalAmount, subtotal: totalAmount,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            unitPrice: l.unitPrice, lineTotal: l.qty * l.unitPrice, costTotal: l.qty * l.unitPrice,
            sourceTransactionLineId: l.sourceTransactionLineId,
            createdBy: p.userId,
          })),
        },
      },
    });

    // Inventory: CUSTOMER_RETURN_IN
    for (const l of p.lines) {
      await prisma.inventoryMovement.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, variantId: l.variantId,
          movementType: 'CUSTOMER_RETURN_IN', quantity: l.qty, unitCostAtTime: l.unitPrice,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
    }

    // Ledger: AR_DECREASE
    await prisma.ledgerEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id, entryType: 'AR_DECREASE',
        customerId: p.customerId, amount: totalAmount,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    return { ...txn, documentNumber: docNumber };
  }

  async function createPostedInternalTransfer(p: {
    tenantId: string; userId: string; fromAccountId: string; toAccountId: string;
    amount: number; transactionDate: string; notes?: string;
  }) {
    const docNumber = nextDocNumber('INTERNAL_TRANSFER');
    const groupId = randomUUID();

    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'INTERNAL_TRANSFER', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        createdBy: p.userId, totalAmount: p.amount, subtotal: p.amount,
        fromPaymentAccountId: p.fromAccountId, toPaymentAccountId: p.toAccountId,
        notes: p.notes, idempotencyKey: randomUUID(),
      },
    });

    // Two payment entries linked by transferGroupId
    await prisma.paymentEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id,
        paymentAccountId: p.fromAccountId,
        entryType: 'TRANSFER', direction: 'OUT', amount: p.amount,
        transferGroupId: groupId,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });
    await prisma.paymentEntry.create({
      data: {
        tenantId: p.tenantId, transactionId: txn.id,
        paymentAccountId: p.toAccountId,
        entryType: 'TRANSFER', direction: 'IN', amount: p.amount,
        transferGroupId: groupId,
        transactionDate: date(p.transactionDate), createdBy: p.userId,
      },
    });

    return { ...txn, documentNumber: docNumber };
  }

  async function createPostedAdjustment(p: {
    tenantId: string; userId: string; transactionDate: string;
    lines: Array<{ variantId: string; qty: number; direction: 'IN' | 'OUT'; reason: string }>;
    notes?: string;
  }) {
    const docNumber = nextDocNumber('ADJUSTMENT');

    const txn = await prisma.transaction.create({
      data: {
        tenantId: p.tenantId, type: 'ADJUSTMENT', status: 'POSTED',
        series: '2026', documentNumber: docNumber,
        transactionDate: date(p.transactionDate), postedAt: new Date(),
        createdBy: p.userId, totalAmount: 0, subtotal: 0,
        notes: p.notes, idempotencyKey: randomUUID(),
        transactionLines: {
          create: p.lines.map((l) => ({
            tenantId: p.tenantId, variantId: l.variantId, quantity: l.qty,
            description: JSON.stringify({ direction: l.direction, reason: l.reason }),
            createdBy: p.userId,
          })),
        },
      },
    });

    // Inventory movements
    for (const l of p.lines) {
      const movementType = l.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      await prisma.inventoryMovement.create({
        data: {
          tenantId: p.tenantId, transactionId: txn.id, variantId: l.variantId,
          movementType: movementType as any, quantity: l.qty, unitCostAtTime: 0,
          transactionDate: date(p.transactionDate), createdBy: p.userId,
        },
      });
    }

    return { ...txn, documentNumber: docNumber };
  }

  async function updateAvgCost(tenantId: string, variantId: string) {
    const result = await prisma.$queryRaw<[{ net_cost: bigint; net_qty: bigint }]>`
      SELECT
        COALESCE(SUM(CASE WHEN movement_type = 'PURCHASE_IN' THEN quantity * unit_cost_at_time ELSE -(quantity * unit_cost_at_time) END), 0) AS net_cost,
        COALESCE(SUM(CASE WHEN movement_type = 'PURCHASE_IN' THEN quantity ELSE -quantity END), 0) AS net_qty
      FROM inventory_movements
      WHERE tenant_id = ${tenantId}::uuid
        AND variant_id = ${variantId}::uuid
        AND movement_type IN ('PURCHASE_IN', 'SUPPLIER_RETURN_OUT')
    `;
    const netCost = Number(result[0]?.net_cost ?? 0);
    const netQty = Number(result[0]?.net_qty ?? 0);
    const avgCost = netQty > 0 ? Math.floor(netCost / netQty) : 0;
    await prisma.productVariant.update({ where: { id: variantId }, data: { avgCost } });
  }
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
