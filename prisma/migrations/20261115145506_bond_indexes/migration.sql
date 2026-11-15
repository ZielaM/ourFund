-- CreateTable
CREATE TABLE "inflation_readings" (
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "value" DECIMAL(7,2) NOT NULL,

    CONSTRAINT "inflation_readings_pkey" PRIMARY KEY ("year","month")
);

-- CreateTable
CREATE TABLE "reference_rates" (
    "valid_from" DATE NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "reference_rates_pkey" PRIMARY KEY ("valid_from")
);
