// Deletes monitoring data that has passed its retention period (screenshots per the policy; activity totals after 180 days).
// Run it once a day from your scheduler: npm run monitoring:purge
import { PrismaClient } from "@prisma/client";
import { purgeMonitoring } from "../src/lib/monitoring";
import { defaultStorage } from "../src/lib/storage";

const db = new PrismaClient();
const r = await purgeMonitoring(db, defaultStorage());
console.log(`Removed ${r.screenshots} screenshots, ${r.buckets} activity records, ${r.appUsage} application records.`);
await db.$disconnect();
