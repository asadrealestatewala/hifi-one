// Gives every existing lead and client a contact record. Safe to repeat. The Contacts screen also does this the first time it is opened.
import { PrismaClient } from "@prisma/client";
import { backfillContacts } from "../src/lib/crm-contacts";

const db = new PrismaClient();
for (const o of await db.organization.findMany()) console.log(o.name, await backfillContacts(db, o.id));
await db.$disconnect();
