"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DocEditor } from "./documents-tab";

/** The reading page of one initiative document: a wide, comfortable column with the same Write, Preview and Copy controls as the Spec tab. */
export function DocumentReader({ id, itemCode, canEdit }: { id: string; itemCode: string; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const back = `/portfolio/${encodeURIComponent(itemCode)}`;
  const noop = useCallback(async () => {}, []);
  return (
    <div className="doc-page">
      <p><Link href={back}>← Back to {itemCode}</Link></p>
      {error && <p role="alert" className="pf-error">{error}</p>}
      <DocEditor id={id} page canEdit={canEdit} onChanged={noop} onRemoved={() => router.push(back)} onError={setError} />
    </div>
  );
}
