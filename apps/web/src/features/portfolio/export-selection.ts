import { toCsv, type FieldDef } from "@pv/domain";
import type { GridItem, Lookups } from "./types";

/** One CSV row per selected item and one column per shown field, with readable values (project and people by name). */
export function selectionToCsv(rows: GridItem[], fields: FieldDef[], lookups: Lookups): string {
  const value = (f: FieldDef, row: GridItem): string | number | boolean | null => {
    const v = row[f.key];
    if (v === null || v === undefined || v === "") return null;
    if (f.key === "home_project") return lookups.projects.find((p) => p.id === v)?.name ?? String(v);
    if (f.type === "Person") return lookups.members.find((m) => m.user_id === v)?.email ?? String(v);
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return toCsv([fields.map((f) => f.name), ...rows.map((r) => fields.map((f) => value(f, r)))]);
}

/** Download text as a file (Excel opens a CSV that starts with a byte-order mark as UTF-8). */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
