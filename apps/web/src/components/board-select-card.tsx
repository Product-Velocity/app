import { BOARD_SELECTS, type BoardField, type BoardMapping } from "@pv/github";
import { valuesOf } from "@/lib/github/board-selects-form";
import { SelectMappingEditor, type EditorSlot } from "./select-mapping-editor";

// "Initiative fields" of a GitHub project (issue #513): Health, Initiative Status and Initiative Phase on single-select fields of the project's board.
// The editor is shared with Jira (select-mapping-editor.tsx); this maps the board's data to it.
const DIRECTIONS: Record<string, string> = { to_github: "Product Velocity to GitHub", two_way: "Both ways" };

export function BoardSelectCard({ projectId, projectName, boardTitle, saved, fields, fieldsError, action, counts = {}, readAt, readHref }: { projectId: string; projectName: string; boardTitle: string; saved: BoardMapping["selects"] | undefined; fields: BoardField[] | null; fieldsError?: string | null; action: (formData: FormData) => void | Promise<void>; counts?: Record<string, number>; readAt: string; readHref: string }) {
  const selectFields = (fields ?? []).filter((f) => f.dataType === "SINGLE_SELECT");
  const slots: EditorSlot[] = BOARD_SELECTS.map((s) => ({ key: s.key, label: s.label, values: [...valuesOf(s.key)], directions: s.directions.map((d) => ({ value: d, label: DIRECTIONS[d]! })), saved: saved?.[s.key] ? { field: saved[s.key]!.field.id, direction: saved[s.key]!.direction, options: saved[s.key]!.options } : null, count: counts[s.key] ?? 0 }));
  return (
    <SelectMappingEditor
      prefix="bsel" tracker="GitHub" fieldWord="single-select fields of the board" optionWord="board option" projectId={projectId} projectName={projectName} slots={slots}
      fields={fields === null ? null : selectFields.map((f) => ({ id: f.id, name: f.name, options: (f.options ?? []).map((o) => ({ value: o.name, label: o.name })) }))}
      fieldsError={fieldsError ?? (fields && selectFields.length === 0 ? `The board “${boardTitle}” has no single-select field to use. Add one in GitHub (for example Health), then read again.` : null)}
      action={action} readAt={readAt} readHref={readHref}
      phaseNote="Initiative Phase only goes from Product Velocity to GitHub: it moves at the decision gates, so the board cannot change it. The board's Status field (Delivery Status) is separate and stays read-only."
    />
  );
}
