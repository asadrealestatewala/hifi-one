-- CreateTable
CREATE TABLE "EarnerType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultRate" DECIMAL(5,2) NOT NULL,
    "defaultDurationMonths" INTEGER,
    "leadSharing" BOOLEAN NOT NULL DEFAULT false,
    "publicOffer" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarnerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Earner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "country" TEXT,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "durationMonths" INTEGER,
    "leadSharing" BOOLEAN NOT NULL DEFAULT false,
    "territory" TEXT,
    "certExpiryDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "referralCode" TEXT NOT NULL,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Earner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnerSolution" (
    "earnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "EarnerSolution_pkey" PRIMARY KEY ("earnerId","productId")
);

-- CreateTable
CREATE TABLE "PartnerInquiry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "country" TEXT,
    "profession" TEXT,
    "interestedType" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "professionKind" TEXT NOT NULL,
    "company" TEXT,
    "jobTitle" TEXT,
    "professionOther" TEXT,
    "solutionCodes" TEXT[],
    "typeKey" TEXT NOT NULL,
    "salesExperience" TEXT,
    "networkSize" TEXT,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsIp" TEXT,
    "submissions" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "earnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCertificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "renewals" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "revokedById" TEXT,
    "firstReminderAt" TIMESTAMP(3),
    "finalReminderAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSetting" (
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerSetting_pkey" PRIMARY KEY ("organizationId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "EarnerType_organizationId_key_key" ON "EarnerType"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Earner_userId_key" ON "Earner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Earner_referralCode_key" ON "Earner"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Earner_applicationId_key" ON "Earner"("applicationId");

-- CreateIndex
CREATE INDEX "Earner_organizationId_status_idx" ON "Earner"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PartnerInquiry_organizationId_status_createdAt_idx" ON "PartnerInquiry"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerApplication_organizationId_status_createdAt_idx" ON "PartnerApplication"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerApplication_organizationId_email_idx" ON "PartnerApplication"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCertificate_publicId_key" ON "PartnerCertificate"("publicId");

-- CreateIndex
CREATE INDEX "PartnerCertificate_organizationId_status_expiresAt_idx" ON "PartnerCertificate"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "PartnerCertificate_earnerId_idx" ON "PartnerCertificate"("earnerId");

-- AddForeignKey
ALTER TABLE "Earner" ADD CONSTRAINT "Earner_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "EarnerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnerSolution" ADD CONSTRAINT "EarnerSolution_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnerSolution" ADD CONSTRAINT "EarnerSolution_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCertificate" ADD CONSTRAINT "PartnerCertificate_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCertificate" ADD CONSTRAINT "PartnerCertificate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
