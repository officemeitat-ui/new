import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Liveness and readiness probe for load balancers and monitoring. Contains no tenant data. */
export async function GET() {
  const report = await checkHealth();
  // Error details stay in the logs; the public response only says which dependency is down.
  const body = {
    status: report.status,
    checks: {
      database: { ok: report.checks.database.ok, latencyMs: report.checks.database.latencyMs },
      redis: { ok: report.checks.redis.ok, latencyMs: report.checks.redis.latencyMs },
    },
  };
  return NextResponse.json(body, { status: report.status === "ok" ? 200 : 503 });
}
