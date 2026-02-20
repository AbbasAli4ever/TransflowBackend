#!/bin/bash

# Phase 1 Test Suite Quick Start
# This script helps you set up and run the test suite

set -e  # Exit on error

echo "=================================================="
echo "Finance System - Phase 1 Test Suite Setup"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check if test database exists
echo -e "${YELLOW}Step 1: Checking test database...${NC}"

if psql -lqt | cut -d \| -f 1 | grep -qw finance_test; then
    echo -e "${GREEN}✓ Test database 'finance_test' exists${NC}"
else
    echo -e "${YELLOW}Creating test database 'finance_test'...${NC}"
    createdb finance_test || {
        echo -e "${RED}✗ Failed to create test database${NC}"
        echo "Please ensure PostgreSQL is running and you have permissions"
        exit 1
    }
    echo -e "${GREEN}✓ Test database created${NC}"
fi

echo ""

# Step 2: Check environment configuration
echo -e "${YELLOW}Step 2: Checking environment configuration...${NC}"

if [ -f .env.test ]; then
    echo -e "${GREEN}✓ .env.test file exists${NC}"
else
    echo -e "${RED}✗ .env.test file not found${NC}"
    echo "Please ensure .env.test is present in the backend directory"
    exit 1
fi

echo ""

# Step 3: Run migrations on test database
echo -e "${YELLOW}Step 3: Running migrations on test database...${NC}"

export DATABASE_URL="postgresql://zaeemulhassan@localhost:5432/finance_test"

npx prisma migrate deploy || {
    echo -e "${RED}✗ Migrations failed${NC}"
    exit 1
}

echo -e "${GREEN}✓ Migrations completed${NC}"
echo ""

# Step 4: Run Prisma generate
echo -e "${YELLOW}Step 4: Generating Prisma Client...${NC}"

npx prisma generate || {
    echo -e "${RED}✗ Prisma generate failed${NC}"
    exit 1
}

echo -e "${GREEN}✓ Prisma Client generated${NC}"
echo ""

# Step 5: Run tests
echo -e "${YELLOW}Step 5: Running tests...${NC}"
echo ""

# Display test menu
echo "Choose test suite to run:"
echo "  1) All tests (unit + integration)"
echo "  2) Unit tests only"
echo "  3) Integration tests only"
echo "  4) Tenant isolation tests (CRITICAL)"
echo "  5) Tests with coverage report"
echo "  6) Exit"
echo ""

read -p "Enter choice [1-6]: " choice

case $choice in
    1)
        echo -e "${YELLOW}Running all tests...${NC}"
        npm test
        ;;
    2)
        echo -e "${YELLOW}Running unit tests only...${NC}"
        npm run test:unit
        ;;
    3)
        echo -e "${YELLOW}Running integration tests only...${NC}"
        npm run test:integration
        ;;
    4)
        echo -e "${YELLOW}Running CRITICAL tenant isolation tests...${NC}"
        npm run test:isolation
        ;;
    5)
        echo -e "${YELLOW}Running tests with coverage...${NC}"
        npm run test:cov
        ;;
    6)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}=================================================="
echo "Test execution complete!"
echo -e "==================================================${NC}"
echo ""
echo "Next steps:"
echo "  - Review test output above"
echo "  - Check test/PHASE1_TEST_SUMMARY.md for details"
echo "  - Run 'npm run test:cov' for coverage report"
echo ""
