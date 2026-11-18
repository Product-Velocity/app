import { SELECT_SLOTS, type SelectFieldInfo, type SelectMap } from "@/lib/atlassian/select-map";
import { SelectMappingEditor, type EditorSlot } from "./select-mapping-editor";

// "Initiative fields" of a Jira project (issue #512): Health, Initiative Status and Initiative Phase on custom single-select fields of the initiative issue.
// The editor is shared with GitHub (select-mapping-editor.tsx); this maps Jira's data to it.
const DIRECTIONS: Record<string, string> = { to_jira: "Product Velocity to Jira", two_way: "Both ways" };

export function InitiativeSelectCard({ projectId, projectName, saved, fields, fieldsError, action, counts = {}, readAt, readHref }: { projectId: string; projectName: string; saved: SelectMap; fields: SelectFieldInfo[] | null; fieldsError?: string | null; action: (formData: FormData) => void | Promise<void>; /** Initiatives with a value, by Product Velocity field. */ counts?: Record<string, number>; readAt: string; readHref: string }) {
  const slots: EditorSlot[] = SELECT_SLOTS.map((s) => ({ key: s.slot, label: s.label, values: [...s.values], directions: s.directions.map((d) => ({ value: d, label: DIRECTIONS[d]! })), saved: saved[s.slot] ? { field: saved[s.slot]!.field, direction: saved[s.slot]!.direction, options: saved[s.slot]!.options } : null, count: counts[s.pvKey] ?? 0 }));
  return (
    <SelectMappingEditor
      prefix="sel" tracker="Jira" fieldWord="custom single-select fields" optionWord="option" projectId={projectId} projectName={projectName} slots={slots}
      fields={fields === null ? null : fields.map((f) => ({ id: f.id, name: f.name, options: f.options.map((o) => ({ value: o.id, label: o.value })) }))}
      fieldsError={fieldsError ?? (fields && fields.length === 0 ? "No custom single-select field is on the create screen of this project's initiative issue type. Add one in Jira and put it on that screen, then read again." : null)}
      action={action} readAt={readAt} readHref={readHref}
      phaseNote="Initiative Phase only goes from Product Velocity to Jira: it moves at the decision gates, so Jira cannot change it. Build Status is not mapped here: it comes from the epics."
    />
  );
}
