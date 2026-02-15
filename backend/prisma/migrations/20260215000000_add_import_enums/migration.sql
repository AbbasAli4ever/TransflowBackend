-- AlterEnum: Add new values to ImportStatus
ALTER TYPE "ImportStatus" ADD VALUE 'PENDING_MAPPING';
ALTER TYPE "ImportStatus" ADD VALUE 'VALIDATED';
ALTER TYPE "ImportStatus" ADD VALUE 'ROLLED_BACK';

-- AlterEnum: Add new values to ImportRowStatus
ALTER TYPE "ImportRowStatus" ADD VALUE 'PENDING';
ALTER TYPE "ImportRowStatus" ADD VALUE 'VALID';
ALTER TYPE "ImportRowStatus" ADD VALUE 'INVALID';
