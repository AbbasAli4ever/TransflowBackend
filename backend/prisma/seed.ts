import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function seed() {
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Test Wholesale Business',
      baseCurrency: 'PKR',
      timezone: 'Asia/Karachi',
    },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Test Owner',
      email: 'owner@test.com',
      passwordHash: await hash('Test123!', 12),
      role: 'OWNER',
    },
  });

  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'ABC Textiles',
        phone: '+92-300-1234567',
        address: 'Karachi, Pakistan',
        createdBy: user.id,
      },
    }),
    prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: 'XYZ Fabrics',
        phone: '+92-300-7654321',
        address: 'Lahore, Pakistan',
        createdBy: user.id,
      },
    }),
  ]);

  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name: 'Retail Shop A',
        phone: '+92-321-1111111',
        address: 'Shop 1, Main Road',
        createdBy: user.id,
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name: 'Retail Shop B',
        phone: '+92-321-2222222',
        address: 'Shop 2, Market Street',
        createdBy: user.id,
      },
    }),
  ]);

  const products = await Promise.all([
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Men Suit - Black',
        sku: 'SUIT-BLK-001',
        category: 'Suits',
        unit: 'piece',
        avgCost: 0,
        createdBy: user.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Men Suit - Navy',
        sku: 'SUIT-NAV-001',
        category: 'Suits',
        unit: 'piece',
        avgCost: 0,
        createdBy: user.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Shirt - White',
        sku: 'SHRT-WHT-001',
        category: 'Shirts',
        unit: 'piece',
        avgCost: 0,
        createdBy: user.id,
      },
    }),
  ]);

  const paymentAccounts = await Promise.all([
    prisma.paymentAccount.create({
      data: {
        tenantId: tenant.id,
        name: 'Cash',
        type: 'CASH',
        openingBalance: 0,
        createdBy: user.id,
      },
    }),
    prisma.paymentAccount.create({
      data: {
        tenantId: tenant.id,
        name: 'HBL Bank',
        type: 'BANK',
        openingBalance: 0,
        createdBy: user.id,
      },
    }),
    prisma.paymentAccount.create({
      data: {
        tenantId: tenant.id,
        name: 'JazzCash',
        type: 'WALLET',
        openingBalance: 0,
        createdBy: user.id,
      },
    }),
  ]);

  console.log('Seed completed successfully');
  console.log({ tenant, user, suppliers, customers, products, paymentAccounts });
}

seed()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
