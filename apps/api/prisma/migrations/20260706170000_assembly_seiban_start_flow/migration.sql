-- Assembly kiosk start flow: lookup/resume by FSEIBAN + serial.
CREATE INDEX "AssemblyWorkSession_idx_product_serial_status"
  ON "AssemblyWorkSession"("productNo", "serialNo", "status", "updatedAt");
