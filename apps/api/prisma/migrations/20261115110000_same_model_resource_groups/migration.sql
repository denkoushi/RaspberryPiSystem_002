CREATE TABLE "ProductionScheduleSameModelResourceGroup" (
  "id" TEXT NOT NULL,
  "siteKey" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionScheduleSameModelResourceGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PSSameModelGroup_id_site_key" ON "ProductionScheduleSameModelResourceGroup"("id", "siteKey");
CREATE INDEX "PSSameModelGroup_site_idx" ON "ProductionScheduleSameModelResourceGroup"("siteKey");
CREATE TABLE "ProductionScheduleSameModelResourceMember" (
  "groupId" TEXT NOT NULL,
  "siteKey" VARCHAR(100) NOT NULL,
  "resourceCd" VARCHAR(20) NOT NULL,
  CONSTRAINT "ProductionScheduleSameModelResourceMember_pkey" PRIMARY KEY ("siteKey", "resourceCd"),
  CONSTRAINT "PSSameModelMember_group_fkey" FOREIGN KEY ("groupId", "siteKey") REFERENCES "ProductionScheduleSameModelResourceGroup"("id", "siteKey") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PSSameModelMember_group_idx" ON "ProductionScheduleSameModelResourceMember"("groupId", "siteKey");
