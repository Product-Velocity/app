# Spike S1: AG Grid Community

Result and decision: `docs/08-SPIKES-AND-OPEN-QUESTIONS.md` (S1).

Reproduce (needs Node 22, pnpm, Playwright with Chromium):
```
cd spikes/s1-ag-grid
pnpm install --ignore-workspace
pnpm modules                 # lists Community vs Enterprise-only modules
pnpm build && pnpm preview   # serves http://127.0.0.1:5199
node run.cjs                 # edit .cjs: path to your Playwright install and Chromium
```
`main.jsx` is a 2,000-row, 14-column grid with locked (GitHub-driven) columns, select editors, a custom picker editor, row selection and built-in undo/redo. `run.cjs` measures load, edit latency, locked cells, bulk edit, undo, scroll and the Community gaps.
