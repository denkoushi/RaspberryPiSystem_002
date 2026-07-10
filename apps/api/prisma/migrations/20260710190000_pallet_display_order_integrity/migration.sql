DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MachinePalletItem"
    GROUP BY "resourceCd", "palletNo", "displayOrder"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'MachinePalletItem contains duplicate displayOrder values in a pallet';
  END IF;
END $$;

CREATE UNIQUE INDEX "MachinePalletItem_uidx_machine_pallet_order"
  ON "MachinePalletItem" ("resourceCd", "palletNo", "displayOrder");

