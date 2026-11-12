-- Working calendar: office hours, working days and public holidays in one place.
CREATE TABLE "WorkingCalendar" (
    "organizationId" TEXT NOT NULL,
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '18:30',
    "lunchMinutes" INTEGER NOT NULL DEFAULT 30,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkingCalendar_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicHoliday_organizationId_date_key" ON "PublicHoliday"("organizationId", "date");
CREATE INDEX "PublicHoliday_organizationId_date_idx" ON "PublicHoliday"("organizationId", "date");
