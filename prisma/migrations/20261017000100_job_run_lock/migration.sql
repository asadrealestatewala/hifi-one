CREATE UNIQUE INDEX "JobRun_one_running" ON "JobRun"("organizationId", "key") WHERE "status" = 'RUNNING';
