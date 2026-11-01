-- CreateTable
CREATE TABLE "MeetingRecording" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDING',
    "chunks" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingRecording_meetingId_idx" ON "MeetingRecording"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingRecording_organizationId_startedAt_idx" ON "MeetingRecording"("organizationId", "startedAt");


-- Registers the meetings.recordings permission and gives it to every Super Admin role. Other roles get it from `npm run roles:sync`. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description")
VALUES ('perm_meetings_recordings', 'meetings.recordings', 'Record the meetings you host and watch or download meeting recordings')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" = 'SUPER_ADMIN' AND p."key" = 'meetings.recordings'
ON CONFLICT DO NOTHING;
