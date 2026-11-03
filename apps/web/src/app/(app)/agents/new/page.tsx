import { requirePermission, AGENT_TEMPLATES } from "@nexus/domain";
import { getTranslations } from "next-intl/server";
import { TemplateGallery } from "@/components/agents/template-gallery";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Neuer Agent" };

export default async function NewAgentPage() {
  const t = await getTranslations("agents");
  const ctx = await requireTenant();
  requirePermission(ctx.tenant, "agent.edit");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("galleryTitle")}</h1>
        <p className="text-muted-foreground">{t("gallerySubtitle")}</p>
      </div>
      <TemplateGallery
        templates={AGENT_TEMPLATES.map((template) => ({
          id: template.id,
          name: template.name,
          purpose: template.purpose,
          tier: template.tier,
          roiMinutesPerTask: template.roiMinutesPerTask,
          roiUnit: template.roiUnit,
          industries: template.industries,
          requiredIntegrations: template.requiredIntegrations,
        }))}
      />
    </div>
  );
}
