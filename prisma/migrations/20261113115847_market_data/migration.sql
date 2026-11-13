-- CreateEnum
CREATE TYPE "price_source" AS ENUM ('YAHOO', 'MANUAL');

-- AlterTable
ALTER TABLE "instruments" ADD COLUMN     "price_source" "price_source" NOT NULL DEFAULT 'YAHOO',
ADD COLUMN     "quote_symbol" TEXT;

-- CreateTable
CREATE TABLE "prices" (
    "instrument_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "close" DECIMAL(28,10) NOT NULL,
    "source" "price_source" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("instrument_id","date")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "currency" CHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("currency","date")
);

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
