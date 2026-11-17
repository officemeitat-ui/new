import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { orgName } from "@/lib/awareness/store";

export default async function OeffnenPage({ searchParams }: PageProps<"/app/awareness/oeffnen">) {
  await requireAdmin();
  const { org } = await searchParams;
  if (typeof org !== "string" || !(await orgName(org))) notFound();
  redirect(`/app/awareness/${org}`);
}
