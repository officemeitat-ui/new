import { VaultGate } from "@/components/workspace/VaultGate";
import { requireAdmin } from "@/lib/auth";

export default async function DokuLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <VaultGate>{children}</VaultGate>;
}
