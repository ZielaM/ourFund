-- CreateEnum
CREATE TYPE "instrument_event_type" AS ENUM ('DIVIDEND', 'SPLIT');

-- AlterTable
ALTER TABLE "instruments" ADD COLUMN     "events_from" DATE;

-- CreateTable
CREATE TABLE "instrument_events" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "type" "instrument_event_type" NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(28,10) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dismissed_events" (
    "account_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dismissed_events_pkey" PRIMARY KEY ("account_id","event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instrument_events_instrument_id_type_date_key" ON "instrument_events"("instrument_id", "type", "date");

-- AddForeignKey
ALTER TABLE "instrument_events" ADD CONSTRAINT "instrument_events_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dismissed_events" ADD CONSTRAINT "dismissed_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dismissed_events" ADD CONSTRAINT "dismissed_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "instrument_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
