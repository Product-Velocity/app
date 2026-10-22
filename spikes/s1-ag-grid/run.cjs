const { chromium } = require("/opt/node-tools/node_modules/playwright");
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
let results0;
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const results = (results0 = {});
  for (const n of [2000, 10000]) {
    const ctx = await b.newContext({ viewport: { width: 1500, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
    const p = await ctx.newPage();
    const logs = []; p.on("console", (m) => logs.push(m.type() + ": " + m.text().slice(0, 160)));
    const t0 = Date.now();
    await p.goto(`http://localhost:5199/?n=${n}`);
    await p.waitForSelector(".ag-cell");
    const first = await p.evaluate(() => ({ ready: window.__ready, first: window.__first, now: performance.now() }));
    results[`load_${n}`] = { gridReadyMs: Math.round(first.ready), firstDataRenderedMs: Math.round(first.first), wallMs: Date.now() - t0 };
    if (n === 2000) {
      console.error('step1 edits');
      // 1) inline edit latency: Enter keypress -> value committed -> painted (30 edits across editor types)
      const cell = (col, row) => p.locator(`.ag-row[row-index="${row}"] .ag-cell[col-id="${col}"]`);
      for (let i = 0; i < 10; i++) {            // text
        await cell("title", i).dblclick(); await p.keyboard.press("Control+A"); await p.keyboard.type(`Edited ${i}`); await p.keyboard.press("Enter");
      }
      for (let i = 0; i < 10; i++) {            // number
        await cell("value", i).dblclick(); await p.keyboard.press("Control+A"); await p.keyboard.type(String(50 + i)); await p.keyboard.press("Enter");
      }
      for (let i = 0; i < 10; i++) {            // custom picker editor
        await cell("owner", i).dblclick(); await p.keyboard.press("Control+A"); await p.keyboard.type(`Person ${i + 5}`); await p.keyboard.press("Enter");
      }
      await p.waitForTimeout(200);
      const lat = await p.evaluate(() => ({ lat: window.__m.lat, changes: window.__m.changes, cols: window.__m.cols }));
      results.changesByColumn = lat.cols;
      results.edit = { edits: lat.changes, p50ms: Math.round(pct(lat.lat, 0.5)), p95ms: Math.round(pct(lat.lat, 0.95)), maxMs: Math.round(Math.max(...lat.lat)) };

      console.error('step2 locked');
      // 2) locked cells reject edits (double click + typing)
      const before = await cell("status", 0).innerText();
      await cell("status", 0).dblclick(); await p.keyboard.type("HACK"); await p.keyboard.press("Enter");
      results.locked = { editorOpened: await p.locator(".ag-cell-inline-editing").count(), valueUnchanged: (await cell("status", 0).innerText()) === before };
      await p.keyboard.press("Escape");

      console.error('step3 bulk');
      // 3) bulk edit: select 3 rows, set MoSCoW in ONE action, measure; then one undo step
      const bulk = await p.evaluate(async () => {
        const api = window.__api; api.deselectAll();
        [0, 1, 2].forEach((i) => api.getDisplayedRowAtIndex(i).setSelected(true));
        const sel = api.getSelectedNodes();
        const t = performance.now();
        sel.forEach((n) => n.setDataValue("moscow", "Must"));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { selected: sel.length, ms: Math.round(performance.now() - t) };
      });
      results.bulk = bulk;
      // undo: how many undo steps does ONE bulk action take, and what is the limit
      const undo = await p.evaluate(() => {
        const api = window.__api; const size0 = api.getCurrentUndoSize();
        return { undoSize: size0, redoSize: api.getCurrentRedoSize() };
      });
      results.undoStackAfterBulk = undo;
      const after = await p.evaluate(() => {
        const api = window.__api; const v = (i) => api.getDisplayedRowAtIndex(i).data.moscow;
        const before = [v(0), v(1), v(2)];
        api.undoCellEditing();
        const afterOne = [v(0), v(1), v(2)];
        return { before, afterOneUndo: afterOne };
      });
      results.undoOneStepOnBulk = after;
      // fill up beyond 20 edits to see the limit
      results.undoLimit = await p.evaluate(() => {
        const api = window.__api; for (let i = 0; i < 30; i++) api.getDisplayedRowAtIndex(i + 10).setDataValue("size", i % 2 ? "L" : "S");
        return api.getCurrentUndoSize();
      });

      // 4) scroll smoothness: drag 2,000 rows by wheel, count slow frames
      console.error('step4 scroll');
      const scrollRun = (step) => p.evaluate((step) => new Promise((res) => {
        const times = []; let last = performance.now(); let n = 0;
        const vp = document.querySelector(".ag-body-vertical-scroll-viewport"); vp.scrollTop = 0;
        function tick(now) { times.push(now - last); last = now; n++; vp.scrollTop += step; if (n < 120) requestAnimationFrame(tick); else res(times); }
        requestAnimationFrame(tick);
      }), step);
      const fast = await scrollRun(120), jump = await scrollRun(600);
      results.scroll = {
        wheel120pxPerFrame: { p50ms: Math.round(pct(fast, 0.5)), p95ms: Math.round(pct(fast, 0.95)), framesOver50ms: fast.filter((f) => f > 50).length + "/120" },
        jump600pxPerFrame: { p50ms: Math.round(pct(jump, 0.5)), p95ms: Math.round(pct(jump, 0.95)), framesOver50ms: jump.filter((f) => f > 50).length + "/120" },
      };

      console.error('step5 gaps');
      // 5) Community gaps: copy a cell, drag-select a range, fill handle
      await p.evaluate(() => { document.querySelector(".ag-body-vertical-scroll-viewport").scrollTop = 0; window.__api.ensureIndexVisible(0, "top"); });
      await p.waitForTimeout(500);
      await cell("title", 0).click(); await p.keyboard.press("Control+C");
      const clip = await p.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return "(clipboard not readable: " + e.name + ")"; } });
      await cell("title", 0).hover(); await p.mouse.down(); await cell("title", 4).hover(); await p.mouse.up();
      results.communityGaps = {
        rangeSelectedCells: await p.locator(".ag-cell-range-selected").count(),
        fillHandle: await p.locator(".ag-fill-handle").count(),
        clipboardAfterCtrlC: clip.slice(0, 40),
      };
    }
    if (n === 2000) results.consoleWarnings = logs.filter((l) => /warn|error/i.test(l)).slice(0, 4);
    await p.close();
  }
  console.log(JSON.stringify(results, null, 1));
  await b.close();
})().catch((e) => { console.log(JSON.stringify(results0, null, 1)); console.log('ERROR', e.message.split('\n')[0]); process.exit(1); });
