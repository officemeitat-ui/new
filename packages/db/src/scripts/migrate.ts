import { createLogger } from "@nexus/core/logger";
import { runMigrations } from "../migrations";

const log = createLogger("migrate");
const url = process.env.DATABASE_URL;
if (!url) {
  log.error("DATABASE_URL ist nicht gesetzt (siehe .env.example).");
  process.exit(1);
}

await runMigrations(url);
log.info("migrations applied");
