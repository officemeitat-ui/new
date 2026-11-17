import "server-only";
import { getBookPage, listBookPages, upsertBookPage } from "@/lib/bookstack";
import { setCustomerBookstack, type Customer } from "@/lib/workspace/customers";
import { cablingMarkdown, createPage, listPorts, listRacks, pageByBookstackId, updatePage } from "@/lib/workspace/docs";

export const CABLING_PAGE_NAME = "Verkabelung und Patchschrank";

/** Schreibt Patchschränke und Patchliste als Seite in das verknüpfte BookStack-Buch (legt sie an oder aktualisiert sie). */
export async function publishCablingToBookstack(customer: Customer, now = new Date()): Promise<number> {
  if (!customer.bookstackBookId) throw new Error("Kein BookStack-Buch verknüpft");
  const [racks, ports] = await Promise.all([listRacks(customer.id), listPorts(customer.id)]);
  const pageId = await upsertBookPage({
    bookId: customer.bookstackBookId,
    pageId: customer.bookstackPageId,
    name: CABLING_PAGE_NAME,
    markdown: cablingMarkdown(customer.name, racks, ports, now),
  });
  await setCustomerBookstack(customer.id, { pageId: String(pageId) });
  return pageId;
}

/** Übernimmt die Seiten des verknüpften Buchs als Doku-Seiten; bereits übernommene werden aktualisiert. */
export async function importPagesFromBookstack(customer: Customer, now = new Date()): Promise<{ created: number; updated: number }> {
  if (!customer.bookstackBookId) throw new Error("Kein BookStack-Buch verknüpft");
  let created = 0;
  let updated = 0;
  for (const summary of await listBookPages(customer.bookstackBookId)) {
    // Die veröffentlichte Verkabelungsseite stammt aus dem Arbeitsplatz selbst.
    if (String(summary.id) === customer.bookstackPageId) continue;
    const page = await getBookPage(summary.id);
    const markdown = page.markdown?.trim();
    const format = markdown ? "markdown" : "html";
    const content = markdown || page.html || "";
    const existing = await pageByBookstackId(customer.id, String(page.id));
    if (existing) {
      await updatePage(existing.id, { title: page.name, content, format }, now);
      updated++;
    } else {
      await createPage(
        { customerId: customer.id, title: page.name, content, format, source: "bookstack", bookstackPageId: String(page.id) },
        now,
      );
      created++;
    }
  }
  return { created, updated };
}
