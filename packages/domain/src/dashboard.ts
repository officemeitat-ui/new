import { notFound, validationError } from "@nexus/core";
import { desc, eq, sql, type Tx } from "@nexus/db";
import { agents, agentVersions, runs, tenants, usageEvents } from "@nexus/db/schema";
import { countPendingApprovals, type ApprovalScope } from "./approvals";
import { appendAudit } from "./audit";

const TZ = "Europe/Vienna";
// Start of today / this ISO week / this month in Vienna time, as timestamptz.
const startOf = (unit: "day" | "week" | "month") =>
  sql.raw(`(date_trunc('${unit}', now() at time zone '${TZ}') at time zone '${TZ}')`);

export type Dashboard = {
  runsToday: number;
  completedToday: number;
  openApprovals: number;
  activeAgents: number;
  /** Estimate: completed runs × the agent's "manual minutes per task". */
  savedMinutesWeek: number;
  savedMinutesMonth: number;
  hourlyRateCents: number;
  costUsdMicrosMonth: number;
  runsLast7Days: { day: string; runs: number }[];
  recentRuns: {
    id: string;
    conversationId: string;
    agentName: string;
    status: string;
    createdAt: Date;
    costUsdMicros: number;
  }[];
};

/** Key figures for the start page (M10). All numbers are tenant-scoped through RLS. */
export async function getDashboard(
  tx: Tx,
  tenantId: string,
  approvalScope: ApprovalScope,
): Promise<Dashboard> {
  const roiMinutes = sql<number>`coalesce((${agentVersions.config}->>'roiMinutesPerTask')::int, 0)`;

  const [counts] = await tx
    .select({
      runsToday: sql<number>`count(*) filter (where ${runs.createdAt} >= ${startOf("day")})::int`,
      completedToday: sql<number>`count(*) filter (where ${runs.createdAt} >= ${startOf("day")} and ${runs.status} = 'completed')::int`,
      savedMinutesWeek: sql<number>`coalesce(sum(${roiMinutes}) filter (where ${runs.status} = 'completed' and ${runs.createdAt} >= ${startOf("week")}), 0)::int`,
      savedMinutesMonth: sql<number>`coalesce(sum(${roiMinutes}) filter (where ${runs.status} = 'completed' and ${runs.createdAt} >= ${startOf("month")}), 0)::int`,
    })
    .from(runs)
    .innerJoin(agentVersions, eq(agentVersions.id, runs.agentVersionId))
    .where(eq(runs.tenantId, tenantId));

  const [cost] = await tx
    .select({ total: sql<number>`coalesce(sum(${usageEvents.costUsdMicros}), 0)::bigint` })
    .from(usageEvents)
    .where(
      sql`${usageEvents.tenantId} = ${tenantId} and ${usageEvents.createdAt} >= ${startOf("month")}`,
    );

  const [agentCount] = await tx
    .select({ active: sql<number>`count(*)::int` })
    .from(agents)
    .where(sql`${agents.tenantId} = ${tenantId} and ${agents.status} = 'active'`);

  const [tenant] = await tx
    .select({ hourlyRateCents: tenants.hourlyRateCents })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  const daily = await tx.execute<{ day: string; runs: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
           (select count(*)::int from ${runs} r
             where r.tenant_id = ${tenantId}
               and (r.created_at at time zone ${TZ})::date = d.day) as runs
    from generate_series((now() at time zone ${TZ})::date - 6, (now() at time zone ${TZ})::date, interval '1 day') as d(day)
    order by d.day`);

  const recent = await tx
    .select({
      id: runs.id,
      conversationId: runs.conversationId,
      agentName: agents.name,
      status: runs.status,
      createdAt: runs.createdAt,
      costUsdMicros: runs.costUsdMicros,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    // Members see their own activity only; owners/admins the whole company's (finding 14).
    .where(
      approvalScope.all
        ? eq(runs.tenantId, tenantId)
        : sql`${runs.tenantId} = ${tenantId} and ${runs.triggeredBy} = ${approvalScope.userId}`,
    )
    .orderBy(desc(runs.createdAt))
    .limit(6);

  return {
    runsToday: counts?.runsToday ?? 0,
    completedToday: counts?.completedToday ?? 0,
    openApprovals: await countPendingApprovals(tx, tenantId, approvalScope),
    activeAgents: agentCount?.active ?? 0,
    savedMinutesWeek: counts?.savedMinutesWeek ?? 0,
    savedMinutesMonth: counts?.savedMinutesMonth ?? 0,
    hourlyRateCents: tenant?.hourlyRateCents ?? 4500,
    costUsdMicrosMonth: Number(cost?.total ?? 0),
    runsLast7Days: daily.rows.map((row) => ({ day: row.day, runs: Number(row.runs) })),
    recentRuns: recent,
  };
}

/** General settings: company name and the internal hourly rate used for savings. */
export async function updateTenantGeneral(
  tx: Tx,
  input: { tenantId: string; name: string; hourlyRateCents: number; actorId: string },
): Promise<void> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120)
    throw validationError("Bitte einen Firmennamen angeben.");
  if (
    !Number.isInteger(input.hourlyRateCents) ||
    input.hourlyRateCents < 1000 ||
    input.hourlyRateCents > 50_000
  ) {
    throw validationError("Bitte einen Stundensatz zwischen 10 und 500 Euro angeben.");
  }
  const [before] = await tx
    .select({ name: tenants.name, hourlyRateCents: tenants.hourlyRateCents })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  if (!before) throw notFound("Mandant nicht gefunden.");
  if (before.name === name && before.hourlyRateCents === input.hourlyRateCents) return;
  await tx
    .update(tenants)
    .set({ name, hourlyRateCents: input.hourlyRateCents })
    .where(eq(tenants.id, input.tenantId));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "tenant.settings_changed",
    targetType: "tenant",
    targetId: input.tenantId,
    metadata: { from: before, to: { name, hourlyRateCents: input.hourlyRateCents } },
  });
}
