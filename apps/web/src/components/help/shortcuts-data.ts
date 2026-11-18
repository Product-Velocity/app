import { QUICK_ADD_TOKENS } from "@pv/domain";

/** The keyboard shortcuts list shown on the Help shortcuts page: all shortcuts in one place. */
export const SHORTCUT_SECTIONS: { title: string; rows: [string, string][] }[] = [
  { title: "Anywhere in the roadmap", rows: [["Ctrl+K / ⌘K", "Open the command palette: find an initiative or run an action"], ["Alt+N", "Go to Add an initiative"], ["Ctrl+Z / ⌘Z", "Undo your last change"], ["Ctrl+Y / ⇧⌘Z", "Redo"], ["Esc", "Close a menu or dialog; clear the selection"]] },
  { title: "In the grid", rows: [["Arrow keys", "Move between cells"], ["Enter or F2", "Edit the cell"], ["Tab", "Move one cell right"], ["Esc", "Cancel an edit"], ["Delete", "Clear a cell, or delete the ticked rows when you are on the checkbox column"], ["Space", "Open the initiative in the side panel"], ["Paste from a spreadsheet", "Opens the import with column mapping"]] },
  { title: "The side panel", rows: [["J / K", "Next or previous initiative in the current view"], ["Esc", "Close the panel"], ["← →", "Switch tabs (with the tab focused)"]] },
  { title: "Add an initiative: type it in one line", rows: [
    ["Name", "Type the name, press Enter. Only the name is needed; the project comes from the row you are on"],
    ...QUICK_ADD_TOKENS.map((t): [string, string] => [t.token, t.means]),
    ["Paste a list", "One initiative per line, with the same words (up to 200)"],
    ["Example", "Faster search #platform @bo +growth M should ~now !atrisk by:31/03"],
  ] },
  { title: "Good to know", rows: [["Lock icon", "The value comes from GitHub and cannot be edited here"], ["Selecting rows", "A bar above the grid sets a field on all of them at once"]] },
];
