-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('STANDARD', 'IKE', 'IKZE', 'OKI');

-- CreateEnum
CREATE TYPE "instrument_type" AS ENUM ('STOCK', 'ETF', 'BOND', 'CRYPTO');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'DEPOSIT', 'WITHDRAWAL', 'SPLIT');

-- CreateTable
CREATE TABLE "portfolios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "account_type" NOT NULL DEFAULT 'STANDARD',
    "institution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "instrument_type" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "date" DATE NOT NULL,
    "instrument_id" UUID,
    "quantity" DECIMAL(28,10),
    "price" DECIMAL(28,10),
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amount" DECIMAL(28,10),
    "fee" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "tax" DECIMAL(28,10) NOT NULL DEFAULT 0,
    "split_ratio" DECIMAL(18,8),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_user_id_name_key" ON "portfolios"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_portfolio_id_name_key" ON "accounts"("portfolio_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_symbol_market_key" ON "instruments"("symbol", "market");

-- CreateIndex
CREATE INDEX "transactions_account_id_date_idx" ON "transactions"("account_id", "date");

-- CreateIndex
CREATE INDEX "transactions_instrument_id_idx" ON "transactions"("instrument_id");

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
