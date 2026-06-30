CREATE TABLE "SelfInspectionRegistrationPolicyConfig" (
    "key" VARCHAR(80) NOT NULL,
    "requireMeasuringInstrumentTag" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionRegistrationPolicyConfig_pkey" PRIMARY KEY ("key")
);
