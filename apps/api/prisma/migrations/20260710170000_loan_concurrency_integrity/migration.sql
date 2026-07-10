DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Loan"
    WHERE "returnedAt" IS NOT NULL AND "cancelledAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Loan contains rows with both returnedAt and cancelledAt';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Loan"
    WHERE "itemId" IS NOT NULL AND "returnedAt" IS NULL AND "cancelledAt" IS NULL
    GROUP BY "itemId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Loan contains duplicate active item loans';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Loan"
    WHERE "measuringInstrumentId" IS NOT NULL AND "returnedAt" IS NULL AND "cancelledAt" IS NULL
    GROUP BY "measuringInstrumentId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Loan contains duplicate active measuring instrument loans';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Loan"
    WHERE "riggingGearId" IS NOT NULL AND "returnedAt" IS NULL AND "cancelledAt" IS NULL
    GROUP BY "riggingGearId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Loan contains duplicate active rigging gear loans';
  END IF;
END $$;

ALTER TABLE "Loan"
  ADD CONSTRAINT "Loan_terminal_state_check"
  CHECK (NOT ("returnedAt" IS NOT NULL AND "cancelledAt" IS NOT NULL));

CREATE UNIQUE INDEX "Loan_active_item_uidx"
  ON "Loan" ("itemId")
  WHERE "itemId" IS NOT NULL AND "returnedAt" IS NULL AND "cancelledAt" IS NULL;

CREATE UNIQUE INDEX "Loan_active_measuring_instrument_uidx"
  ON "Loan" ("measuringInstrumentId")
  WHERE "measuringInstrumentId" IS NOT NULL AND "returnedAt" IS NULL AND "cancelledAt" IS NULL;

CREATE UNIQUE INDEX "Loan_active_rigging_gear_uidx"
  ON "Loan" ("riggingGearId")
  WHERE "riggingGearId" IS NOT NULL AND "returnedAt" IS NULL AND "cancelledAt" IS NULL;
