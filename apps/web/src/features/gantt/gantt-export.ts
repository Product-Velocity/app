import { PX_PER_DAY, type Range, type Tick, type Window, type Zoom } from "@pv/domain";

/**
 * Export of the Gantt as a picture, drawn on a canvas from the same lines the chart shows (no extra library).
 * PNG downloads the canvas; PDF opens the browser's print dialog on the picture (PDFs come from an HTML print view).
 * Every row is drawn, not only the rows in view; a chart too tall for a canvas is refused with a reason.
 */
export type ExportLine =
  | { kind: "group"; level: 1 | 2; label: string; count: number; flags: string; span: Range | null; progress: number | null }
  | { kind: "item"; level: number; code: string; name: string; health: string; bar: Range; progress: number | null; note: string | null; gate: { day: number; gate: string } | null; actual: { startDay: number; endDay: number } | null };

export type ExportInput = {
  lines: ExportLine[]; win: Window; zoom: Zoom; labelW: number; lineH: number; todayDay: number; todayLabel: string;
  ticks: Tick[]; years: { label: string; x: number; width: number }[];
  edges: { from: number; to: number; clash: boolean }[];
};

const HEAD_H = 62;
export const MAX_EXPORT_PX = 16_000;
const FILL: Record<string, string> = { "On Track": "#cfeedd", "At Risk": "#fde7b0", "Delayed": "#f6c4c4", "Blocked": "#e9a9a9" };
const NO_HEALTH = "#dfe3f2";
const INK = "#1b1f2a", MUTED = "#5b6272", GRID = "#e6e8ee", RED = "#b4472f";

export function renderGantt(i: ExportInput): { canvas: HTMLCanvasElement } | { error: string } {
  const width = i.labelW + (i.win.endDay - i.win.startDay) * PX_PER_DAY[i.zoom];
  const height = HEAD_H + i.lines.length * i.lineH + 8;
  if (height > MAX_EXPORT_PX || width > MAX_EXPORT_PX) return { error: "This chart is too large to export in one picture. Filter it, collapse groups or choose a wider zoom first." };
  const scale = width * height > 12_000_000 ? 1 : 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "This browser cannot draw the picture." };
  ctx.scale(scale, scale);
  const sans = "'IBM Plex Sans', system-ui, sans-serif";
  const px = PX_PER_DAY[i.zoom];
  const x = (day: number) => i.labelW + (day - i.win.startDay) * px;
  const fit = (text: string, max: number) => {
    if (ctx.measureText(text).width <= max) return text;
    let t = text; while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  };
  const barH = i.lineH >= 40 ? 22 : 18, barTop = i.lineH >= 40 ? 7 : 3;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  // header
  ctx.fillStyle = "#f6f7fb"; ctx.fillRect(0, 0, width, HEAD_H);
  ctx.textBaseline = "middle"; ctx.font = `600 12px ${sans}`; ctx.fillStyle = INK;
  for (const y of i.years) { ctx.fillText(y.label, i.labelW + y.x + 6, 11); }
  ctx.font = `12px ${sans}`; ctx.fillStyle = "#3c4254";
  for (const t of i.ticks) { ctx.fillText(fit(t.label, Math.max(0, t.width - 8)), i.labelW + t.x + 6, 34); }
  ctx.font = `600 13px ${sans}`; ctx.fillStyle = INK; ctx.fillText("Initiative", 8, HEAD_H - 14);
  // grid
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for (const t of i.ticks) { ctx.beginPath(); ctx.moveTo(Math.round(i.labelW + t.x) + 0.5, 22); ctx.lineTo(Math.round(i.labelW + t.x) + 0.5, height); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, HEAD_H + 0.5); ctx.lineTo(width, HEAD_H + 0.5); ctx.stroke();

  i.lines.forEach((l, n) => {
    const top = HEAD_H + n * i.lineH;
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(0, top + i.lineH - 0.5); ctx.lineTo(width, top + i.lineH - 0.5); ctx.stroke();
    ctx.textBaseline = "middle";
    if (l.kind === "group") {
      ctx.fillStyle = "#f6f7fb"; ctx.fillRect(0, top, i.labelW, i.lineH - 1);
      ctx.font = `600 13px ${sans}`; ctx.fillStyle = INK;
      const label = `${l.label}  ${l.count}${l.flags ? `  ·  ${l.flags}` : ""}`;
      ctx.fillText(fit(label, i.labelW - 20 - (l.level - 1) * 14), 8 + (l.level - 1) * 14, top + i.lineH / 2);
      if (l.span) {
        const w = Math.max(2, (l.span.endDay - l.span.startDay) * px);
        ctx.fillStyle = "#b9bfd6"; ctx.fillRect(x(l.span.startDay), top + i.lineH / 2 - 4, w, 8);
        if (l.progress !== null) { ctx.fillStyle = "#6f78a6"; ctx.fillRect(x(l.span.startDay), top + i.lineH / 2 - 4, (w * l.progress) / 100, 8); }
      }
      return;
    }
    // label column
    ctx.font = `11px ui-monospace, monospace`; ctx.fillStyle = MUTED;
    const pad = 8 + Math.max(0, l.level - 1) * 14 + 18;
    ctx.fillText(l.code, pad, top + i.lineH / 2);
    const codeW = ctx.measureText(l.code).width + 6;
    ctx.font = `13px ${sans}`; ctx.fillStyle = INK;
    ctx.fillText(fit(l.name, i.labelW - pad - codeW - (l.health ? 70 : 8)), pad + codeW, top + i.lineH / 2);
    if (l.health) { ctx.font = `11px ${sans}`; ctx.fillStyle = MUTED; ctx.textAlign = "right"; ctx.fillText(l.health, i.labelW - 8, top + i.lineH / 2); ctx.textAlign = "left"; }
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(i.labelW - 0.5, top); ctx.lineTo(i.labelW - 0.5, top + i.lineH); ctx.stroke();
    // bar
    const bx = x(l.bar.startDay), bw = Math.max(6, (l.bar.endDay - l.bar.startDay + 1) * px);
    ctx.fillStyle = l.health ? (FILL[l.health] ?? NO_HEALTH) : NO_HEALTH;
    ctx.fillRect(bx, top + barTop, bw, barH);
    if (l.progress !== null) { ctx.fillStyle = "rgba(20,24,40,.22)"; ctx.fillRect(bx, top + barTop, (bw * l.progress) / 100, barH); }
    ctx.strokeStyle = "rgba(20,24,40,.35)"; ctx.strokeRect(bx + 0.5, top + barTop + 0.5, bw - 1, barH - 1);
    const inside = bw >= 120 ? `${l.code} ${l.name}` : bw >= 44 ? l.code : "";
    if (inside) { ctx.font = `11px ${sans}`; ctx.fillStyle = INK; ctx.fillText(fit(inside, bw - 10), bx + 5, top + barTop + barH / 2); }
    if (l.actual) { ctx.fillStyle = INK; ctx.fillRect(x(l.actual.startDay), top + barTop + barH + 2, Math.max(2, (l.actual.endDay - l.actual.startDay + 1) * px), 3); }
    let noteX = bx + bw + 6;
    if (l.gate) {
      const gx = x(l.gate.day) + px / 2, gy = top + barTop + barH / 2;
      ctx.fillStyle = "#1a56c4"; ctx.beginPath(); ctx.moveTo(gx, gy - 7); ctx.lineTo(gx + 7, gy); ctx.lineTo(gx, gy + 7); ctx.lineTo(gx - 7, gy); ctx.closePath(); ctx.fill();
      ctx.font = `600 10px ${sans}`; ctx.fillStyle = "#1a56c4"; ctx.fillText(l.gate.gate, gx + 10, gy);
      if (gx >= bx + bw - 4 && gx < noteX + 90) noteX = gx + 24;
    }
    if (l.note) { ctx.font = `11px ${sans}`; ctx.fillStyle = RED; ctx.fillText(l.note, noteX, top + barTop + barH / 2); }
  });
  // dependency lines
  ctx.lineWidth = 1.4;
  for (const e of i.edges) {
    const a = i.lines[e.from], b = i.lines[e.to];
    if (!a || a.kind !== "item" || !b || b.kind !== "item") continue;
    const y1 = HEAD_H + e.from * i.lineH + barTop + barH / 2, y2 = HEAD_H + e.to * i.lineH + barTop + barH / 2;
    const x1 = x(a.bar.endDay + 1), x2 = x(b.bar.startDay);
    ctx.strokeStyle = e.clash ? RED : "#6f78a6"; ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    if (x2 - x1 >= 16) { ctx.lineTo(x1 + 8, y1); ctx.lineTo(x1 + 8, y2); } else { const yb = y1 + (y2 > y1 ? 1 : -1) * (i.lineH / 2); ctx.lineTo(x1 + 8, y1); ctx.lineTo(x1 + 8, yb); ctx.lineTo(x2 - 8, yb); ctx.lineTo(x2 - 8, y2); }
    ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 5, y2 - 3); ctx.lineTo(x2 - 5, y2 + 3); ctx.closePath(); ctx.fill();
  }
  // today
  const tx = x(i.todayDay);
  ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, 46); ctx.lineTo(tx, height); ctx.stroke();
  ctx.font = `11px ${sans}`; ctx.fillStyle = "#a11d2d"; ctx.textBaseline = "middle"; ctx.fillText(i.todayLabel, tx + 4, 54);
  return { canvas };
}

export function downloadPng(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, "image/png");
}

/** Opens the print dialog on the picture (choose "Save as PDF"); the page is landscape and the picture is scaled to its width. */
export function printPicture(canvas: HTMLCanvasElement, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(`<!doctype html><title></title><style>@page{size:landscape;margin:10mm}html,body{margin:0}img{width:100%;height:auto;display:block}</style>`);
  doc.close();
  doc.title = title;
  const img = doc.createElement("img");
  img.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  img.src = canvas.toDataURL("image/png");
  doc.body.appendChild(img);
}
