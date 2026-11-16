-- AlterTable
ALTER TABLE "Earner" ADD COLUMN     "billingClientId" TEXT;

-- CreateTable
CREATE TABLE "PartnerResaleTerm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "collection" TEXT NOT NULL DEFAULT 'PARTNER_COLLECTS',
    "unitName" TEXT NOT NULL DEFAULT 'student',
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "wholesalePrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "resalePrice" DECIMAL(14,2),
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 10,
    "effectiveFrom" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerResaleTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResaleSchool" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResaleSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResaleCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "enteredById" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "collection" TEXT,
    "wholesalePrice" DECIMAL(14,2),
    "resalePrice" DECIMAL(14,2),

    CONSTRAINT "ResaleCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPaymentNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPaymentNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerResaleTerm_organizationId_effectiveFrom_idx" ON "PartnerResaleTerm"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerResaleTerm_earnerId_productId_effectiveFrom_key" ON "PartnerResaleTerm"("earnerId", "productId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ResaleSchool_organizationId_earnerId_idx" ON "ResaleSchool"("organizationId", "earnerId");

-- CreateIndex
CREATE INDEX "ResaleSchool_clientId_productId_idx" ON "ResaleSchool"("clientId", "productId");

-- CreateIndex
CREATE INDEX "ResaleCount_organizationId_month_idx" ON "ResaleCount"("organizationId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ResaleCount_schoolId_month_key" ON "ResaleCount"("schoolId", "month");

-- CreateIndex
CREATE INDEX "PartnerPaymentNotice_organizationId_status_idx" ON "PartnerPaymentNotice"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PartnerPaymentNotice_invoiceId_idx" ON "PartnerPaymentNotice"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Earner_billingClientId_key" ON "Earner"("billingClientId");

-- AddForeignKey
ALTER TABLE "PartnerResaleTerm" ADD CONSTRAINT "PartnerResaleTerm_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerResaleTerm" ADD CONSTRAINT "PartnerResaleTerm_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleSchool" ADD CONSTRAINT "ResaleSchool_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleSchool" ADD CONSTRAINT "ResaleSchool_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleSchool" ADD CONSTRAINT "ResaleSchool_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleCount" ADD CONSTRAINT "ResaleCount_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "ResaleSchool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPaymentNotice" ADD CONSTRAINT "PartnerPaymentNotice_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

