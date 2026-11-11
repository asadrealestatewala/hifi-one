-- CreateTable
CREATE TABLE "ProductCommissionRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCommissionRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductCommissionRate_productId_role_key" ON "ProductCommissionRate"("productId", "role");

-- CreateIndex
CREATE INDEX "ProductCommissionRate_organizationId_active_idx" ON "ProductCommissionRate"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "ProductCommissionRate" ADD CONSTRAINT "ProductCommissionRate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
