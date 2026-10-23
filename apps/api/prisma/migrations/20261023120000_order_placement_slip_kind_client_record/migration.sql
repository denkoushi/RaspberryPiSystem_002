ALTER TABLE "OrderPlacementEvent"
    ADD COLUMN "client_record_id" TEXT,
    ADD COLUMN "slip_kind" TEXT NOT NULL DEFAULT 'manufacturing_order';

ALTER TABLE "OrderPlacementBranchState"
    ADD COLUMN "slip_kind" TEXT NOT NULL DEFAULT 'manufacturing_order';

CREATE UNIQUE INDEX "OrderPlacementEvent_client_record_id_key" ON "OrderPlacementEvent"("client_record_id");
