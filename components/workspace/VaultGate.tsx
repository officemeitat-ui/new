import { workspace } from "@/config/workspace";
import { UnlockScreen, VaultPanel } from "@/components/workspace/VaultUI";
import { docAccess } from "@/lib/workspace/vault";

/** Schützt die Dokumentation: gesperrt → Passwortabfrage; noch nicht eingerichtet → Angebot zum Verschlüsseln. */
export async function VaultGate({ children }: { children: React.ReactNode }) {
  const access = await docAccess();
  if (access === "gesperrt") return <UnlockScreen />;
  return (
    <div className="space-y-4">
      <VaultPanel access={access} minutes={workspace.vault.unlockMinutes} />
      {children}
    </div>
  );
}
