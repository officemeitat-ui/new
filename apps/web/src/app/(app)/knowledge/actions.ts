"use server";

import { isAppError, isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  addDocument,
  createCollection,
  deleteCollection,
  deleteDocument,
  requirePermission,
  searchKnowledge,
  type KnowledgeHit,
} from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { enqueueKnowledgeIngest } from "@/lib/queue";
import { requireTenant } from "@/lib/session";

const MAX_FILES_PER_UPLOAD = 10;

async function managerContext() {
  const ctx = await requireTenant();
  requirePermission(ctx.tenant, "knowledge.manage");
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
