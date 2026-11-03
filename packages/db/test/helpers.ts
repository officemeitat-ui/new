import { createDatabase, type DatabaseHandle } from "../src/client";
import { TEST_DATABASE_URL } from "./global-setup";

export function openTestDatabase(): DatabaseHandle {
  return createDatabase(TEST_DATABASE_URL, { max: 4 });
}
