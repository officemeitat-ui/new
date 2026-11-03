// Every tenant-scoped table needs Row Level Security in a SQL migration (drizzle/*_rls.sql).
// test/rls-coverage.test.ts fails if one is missing.
export * from "./agents";
export * from "./audit";
export * from "./auth";
export * from "./integrations";
export * from "./knowledge";
export * from "./pricing";
export * from "./tenancy";
