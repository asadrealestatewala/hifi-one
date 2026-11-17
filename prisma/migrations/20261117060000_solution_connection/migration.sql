-- CreateTable
CREATE TABLE "SolutionConnection" (
    "productId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPullAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "SolutionConnection_pkey" PRIMARY KEY ("productId")
);

-- AddForeignKey
ALTER TABLE "SolutionConnection" ADD CONSTRAINT "SolutionConnection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
