"use server";

import { isAppError, isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  addDocument,
  connectAtera,
  connectBookStack,
  connectSharePointLibrary,
  createCollection,
  disconnectKnowledgeSource,
  findSharePointLibraries,
  findSharePointSites,
  getKnowledgeSource,
  deleteCollection,
  deleteDocument,
  requirePermission,
  searchKnowledge,
  type KnowledgeHit,
} from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { enqueueKnowledgeIngest, enqueueKnowledgeSync } from "@/lib/queue";
import { requireTenant } from "@/lib/session";

const MAX_FILES_PER_UPLOAD = 10;

async function managerContext() {
  const ctx = await requireTenant();
  requirePermission(ctx.tenant, "knowledge.manage");
  return ctx;
}

/** Connecting, syncing and disconnecting sources: owners and admins, never support sessions. */
async function connectorContext() {
  const ctx = await requireTenant();
  requirePermission(ctx.tenant, "knowledge.connect");
  return ctx;
}

export async function createCollectionAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await runAction("createCollection", async () => {
    const ctx = await managerContext();
    const collection = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      createCollection(tx, {
        tenantId: ctx.tenant.tenantId,
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/knowledge");
    return { data: collection.id };
  });
  if (result.ok && result.data) redirect(`/knowledge/${result.data}`);
  return result.ok ? { ok: true } : result;
}

export async function deleteCollectionAction(collectionId: string): Promise<ActionResult> {
  const result = await runAction("deleteCollection", async () => {
    const ctx = await managerContext();
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      deleteCollection(tx, { tenantId: ctx.tenant.tenantId, collectionId, actorId: ctx.user.id }),
    );
    revalidatePath("/knowledge");
  });
  if (result.ok) redirect("/knowledge");
  return result;
}

/** Stores the files and queues them for text extraction; the list shows the progress. */
export async function uploadDocumentsAction(
  collectionId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("uploadDocuments", async () => {
    const ctx = await managerContext();
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw validationError("Bitte wählen Sie mindestens eine Datei aus.");
    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw validationError(
        `Bitte höchstens ${MAX_FILES_PER_UPLOAD} Dateien auf einmal hochladen.`,
      );
    }
    const tenantId = ctx.tenant.tenantId;
    const added: string[] = [];
    const problems: string[] = [];
    // One transaction per file: a rejected file does not stop the others.
    for (const file of files) {
      try {
        const { documentId } = await withTenant(getDatabase().db, tenantId, async (tx) =>
          addDocument(tx, {
            tenantId,
            collectionId,
            fileName: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            actorId: ctx.user.id,
          }),
        );
        await enqueueKnowledgeIngest({ documentId, tenantId });
        added.push(file.name);
      } catch (error) {
        if (!isAppError(error)) throw error;
        problems.push(error.message);
      }
    }
    revalidatePath(`/knowledge/${collectionId}`);
    revalidatePath("/knowledge");
    if (added.length === 0) throw validationError(problems.join(" "));
    const message =
      added.length === 1
        ? `„${added[0]}“ wird verarbeitet.`
        : `${added.length} Dateien werden verarbeitet.`;
    return { message: problems.length ? `${message} ${problems.join(" ")}` : message };
  });
}

export async function deleteDocumentAction(
  collectionId: string,
  documentId: string,
): Promise<ActionResult> {
  return runAction("deleteDocument", async () => {
    const ctx = await managerContext();
    if (!isUuid(documentId)) throw validationError("Ungültiges Dokument.");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      deleteDocument(tx, { tenantId: ctx.tenant.tenantId, documentId, actorId: ctx.user.id }),
    );
    revalidatePath(`/knowledge/${collectionId}`);
    revalidatePath("/knowledge");
  });
}

/** "Suche testen": shows what an agent would find. */
export async function searchKnowledgeAction(
  collectionId: string,
  query: string,
): Promise<ActionResult<KnowledgeHit[]>> {
  return runAction("searchKnowledge", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "knowledge.read");
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    const hits = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      searchKnowledge(tx, {
        tenantId: ctx.tenant.tenantId,
        query: query.slice(0, 300),
        collectionIds: [collectionId],
        limit: 5,
      }),
    );
    return { data: hits };
  });
}

/* ------------------------------------------------------------- SharePoint */

export async function searchSharePointSitesAction(
  query: string,
): Promise<ActionResult<{ id: string; name: string; webUrl: string }[]>> {
  return runAction("searchSharePointSites", async () => {
    const ctx = await connectorContext();
    return {
      data: await findSharePointSites(getDatabase().db, ctx.tenant.tenantId, query.slice(0, 100)),
    };
  });
}

export async function listSharePointLibrariesAction(
  siteId: string,
): Promise<ActionResult<{ id: string; name: string; webUrl: string }[]>> {
  return runAction("listSharePointLibraries", async () => {
    const ctx = await connectorContext();
    return { data: await findSharePointLibraries(getDatabase().db, ctx.tenant.tenantId, siteId) };
  });
}

/**
 * Connects a library chosen in the wizard. Site and library are looked up again on the server,
 * so the browser cannot connect something the tenant's Microsoft 365 does not have.
 */
export async function connectSharePointAction(input: {
  collectionId: string;
  siteId: string;
  /** Display only; the site itself is verified through its libraries. */
  siteName: string;
  siteUrl: string;
  libraryId: string;
}): Promise<ActionResult> {
  return runAction("connectSharePoint", async () => {
    const ctx = await connectorContext();
    if (!isUuid(input.collectionId)) throw validationError("Ungültige Sammlung.");
    const db = getDatabase().db;
    const tenantId = ctx.tenant.tenantId;
    const libraries = await findSharePointLibraries(db, tenantId, input.siteId);
    const library = libraries.find((l) => l.id === input.libraryId);
    if (!library) throw validationError("Die Bibliothek wurde nicht gefunden.");
    const site = {
      id: input.siteId,
      name: input.siteName.trim().slice(0, 200) || library.name,
      webUrl: /^https:\/\//.test(input.siteUrl) ? input.siteUrl.slice(0, 500) : "",
    };
    const source = await withTenant(db, tenantId, (tx) =>
      connectSharePointLibrary(tx, {
        tenantId,
        collectionId: input.collectionId,
        site,
        library,
        actorId: ctx.user.id,
      }),
    );
    await enqueueKnowledgeSync({ sourceId: source.id, tenantId });
    revalidatePath(`/knowledge/${input.collectionId}`);
    return {
      message: "Verbunden. Der erste Abgleich läuft im Hintergrund – Sie können weiterarbeiten.",
    };
  });
}

export async function syncSharePointAction(collectionId: string): Promise<ActionResult> {
  return runAction("syncSharePoint", async () => {
    const ctx = await connectorContext();
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    const source = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      getKnowledgeSource(tx, ctx.tenant.tenantId, collectionId),
    );
    if (!source) throw validationError("Keine Verbindung vorhanden.");
    await enqueueKnowledgeSync({ sourceId: source.id, tenantId: ctx.tenant.tenantId });
    revalidatePath(`/knowledge/${collectionId}`);
    return { message: "Abgleich gestartet." };
  });
}

export async function disconnectSharePointAction(collectionId: string): Promise<ActionResult> {
  return runAction("disconnectSharePoint", async () => {
    const ctx = await connectorContext();
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      disconnectKnowledgeSource(tx, {
        tenantId: ctx.tenant.tenantId,
        collectionId,
        actorId: ctx.user.id,
      }),
    );
    revalidatePath(`/knowledge/${collectionId}`);
    return { message: "Die Verbindung ist getrennt; die übernommenen Dokumente wurden entfernt." };
  });
}

/* ------------------------------------------------------ BookStack, Atera */

const CONNECTED = "Verbunden. Der erste Abgleich läuft im Hintergrund – Sie können weiterarbeiten.";

/** Tests the BookStack token, then stores it encrypted and starts the first sync. */
export async function connectBookStackAction(
  collectionId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("connectBookStack", async () => {
    const ctx = await connectorContext();
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    const tenantId = ctx.tenant.tenantId;
    const source = await connectBookStack(getDatabase().db, {
      tenantId,
      collectionId,
      baseUrl: String(formData.get("baseUrl") ?? "").slice(0, 500),
      tokenId: String(formData.get("tokenId") ?? "").slice(0, 200),
      tokenSecret: String(formData.get("tokenSecret") ?? "").slice(0, 200),
      actorId: ctx.user.id,
    });
    await enqueueKnowledgeSync({ sourceId: source.id, tenantId });
    revalidatePath(`/knowledge/${collectionId}`);
    return { message: CONNECTED };
  });
}

/** Tests the Atera key, then stores it encrypted and starts the first sync. */
export async function connectAteraAction(
  collectionId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("connectAtera", async () => {
    const ctx = await connectorContext();
    if (!isUuid(collectionId)) throw validationError("Ungültige Sammlung.");
    const tenantId = ctx.tenant.tenantId;
    const source = await connectAtera(getDatabase().db, {
      tenantId,
      collectionId,
      apiKey: String(formData.get("apiKey") ?? "").slice(0, 4000),
      monthsBack: Number(formData.get("monthsBack") ?? 12),
      actorId: ctx.user.id,
    });
    await enqueueKnowledgeSync({ sourceId: source.id, tenantId });
    revalidatePath(`/knowledge/${collectionId}`);
    return { message: CONNECTED };
  });
}
