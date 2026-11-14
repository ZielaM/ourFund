-- CreateEnum
CREATE TYPE "bond_kind" AS ENUM ('OTS', 'ROR', 'DOR', 'TOS', 'COI', 'EDO', 'ROS', 'ROD');

-- AlterEnum
ALTER TYPE "price_source" ADD VALUE 'TREASURY';

-- CreateTable
CREATE TABLE "bond_series" (
    "instrument_id" UUID NOT NULL,
    "kind" "bond_kind" NOT NULL,
    "first_rate" DECIMAL(7,4) NOT NULL,
    "margin" DECIMAL(7,4),

    CONSTRAINT "bond_series_pkey" PRIMARY KEY ("instrument_id")
);

-- CreateTable
CREATE TABLE "bond_rates" (
    "instrument_id" UUID NOT NULL,
    "period" INTEGER NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "bond_rates_pkey" PRIMARY KEY ("instrument_id","period")
);

-- AddForeignKey
ALTER TABLE "bond_series" ADD CONSTRAINT "bond_series_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_rates" ADD CONSTRAINT "bond_rates_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "bond_series"("instrument_id") ON DELETE CASCADE ON UPDATE CASCADE;
