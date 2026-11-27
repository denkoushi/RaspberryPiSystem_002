CREATE TYPE "CsvDashboardRowSupersededReason" AS ENUM (
  'ORDER_STATUS_X', 'DROPPED_RESOURCE', 'ORDER_STATUS_X_AND_DROPPED_RESOURCE'
);

ALTER TABLE "CsvDashboardRow" ADD COLUMN "supersededReason" "CsvDashboardRowSupersededReason";
