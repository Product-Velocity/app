import * as c from "ag-grid-community";
import * as e from "ag-grid-enterprise";
const mods = (m) => Object.keys(m).filter((k) => /Module$/.test(k)).sort();
const cm = new Set(mods(c));
const em = mods(e).filter((k) => !cm.has(k));
const want = /(Cell|Range|Fill|Clipboard|Undo|Export|Csv|Excel|Edit|Selection|Pinned|Column|Filter|Row|Grouping|Tree|Master|Pivot|Aggreg|Status|Sidebar|Tool|Menu|Context|Rich|Select|Date|Text|Number|Checkbox|Large|Custom|Validation|Tooltip|Drag|Keyboard|Navigation)/;
console.log("COMMUNITY modules:", [...cm].filter((k) => want.test(k)).join(", "));
console.log("\nENTERPRISE-only modules:", em.join(", "));
