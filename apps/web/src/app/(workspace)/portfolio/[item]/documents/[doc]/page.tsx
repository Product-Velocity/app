import { notFound } from "next/navigation";
import { canEditItems } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { DocumentReader } from "@/features/portfolio/document-reader";

export const metadata = { title: "Document · Product Velocity" };

/**
 * One document of an initiative on a page of its own, for reading (opens on the Preview) and editing. The text is read through the
 * same API as the Spec tab, so the workspace and role rules are the same.
 */
export default async function ItemDocumentPage({ params }: { params: Promise<{ item: string; doc: string }> }) {
  const { item, doc } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(doc)) notFound();
  const code = decodeURIComponent(item);
  const { active } = await requireWorkspace(`/portfolio/${encodeURIComponent(code)}/documents/${doc}`);
  return <DocumentReader id={doc} itemCode={code} canEdit={canEditItems(active.role)} />;
}
