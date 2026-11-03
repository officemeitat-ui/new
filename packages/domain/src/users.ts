import { eq, type Database } from "@nexus/db";
import { authUser } from "@nexus/db/schema";
import { normalizeEmail } from "./invitations";

/** Identity lookup (global table, no tenant data). Used to decide between sign-in and sign-up. */
export async function userExists(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, normalizeEmail(email)))
    .limit(1);
  return Boolean(row);
}
