-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_source_external_id_key" ON "transactions"("account_id", "source", "external_id");
