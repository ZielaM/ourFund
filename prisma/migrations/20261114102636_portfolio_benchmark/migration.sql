-- AlterEnum
ALTER TYPE "instrument_type" ADD VALUE 'INDEX';

-- AlterTable
ALTER TABLE "portfolios" ADD COLUMN     "benchmark_instrument_id" UUID;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_benchmark_instrument_id_fkey" FOREIGN KEY ("benchmark_instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
