import { AssistantChat } from "@/components/workspace/Assistant";
import { requireAdmin } from "@/lib/auth";

export default async function AssistentPage({ searchParams }: PageProps<"/app/assistent">) {
  await requireAdmin();
  const { frage } = await searchParams;
  return <AssistantChat initial={typeof frage === "string" ? frage.slice(0, 2000) : undefined} />;
}
