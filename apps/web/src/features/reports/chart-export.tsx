"use client";

import { useState } from "react";
import type { Stacked } from "@pv/domain";
import { downloadPng } from "../gantt/gantt-export";

/**
 * Export of one report chart as a PNG (issue #622). A chart is turned into a "raster" (a size and a way to draw it), then placed on a
 * white sheet under its title with the date, and downloaded. It all happens in the browser: nothing is sent anywhere.
 * Charts drawn by ECharts are read from their SVG; the stacked bars (plain HTML on the page) are drawn from their numbers.
 */
export type Raster = { width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void; /** Frees what the picture holds. */ done?: () => void };

const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const INK = "#1b1f2a", MUTED = "#5b6272";
const PAD = 20;

/** A file name from a chart title: "Initiatives by Team and Phase" gives "initiatives-by-team-and-phase-2026-11-23.png". */
export function chartFileName(title: string, day: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "chart"}-${day}.png`;
}

/** Splits text into lines no wider than `max` (by the measure given); a word wider than the line stays whole. */
export function wrapText(text: string, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The SVG an ECharts chart drew inside `box`, as a picture. */
export async function svgRaster(box: HTMLElement): Promise<Raster | null> {
  const svg = box.querySelector("svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width), height = Math.round(rect.height);
  if (width === 0 || height === 0) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { URL.revokeObjectURL(url); return null; }
  return { width, height, draw: (ctx) => ctx.drawImage(img, 0, 0, width, height), done: () => URL.revokeObjectURL(url) };
}

type StackedInput = { data: Stacked; rowLabel: (key: string) => string; colLabel: (key: string) => string; colour: (col: string) => string; percent: boolean };
/** The stacked bar chart drawn from its numbers: the legend, then one bar per row with the count (or share) in each segment and the total at the end. */
export function stackedRaster(i: StackedInput): Raster {
  const width = 760, nameW = 170, totalW = 40, rowH = 28, gap = 6, barW = width - nameW - totalW - 12;
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `12px ${SANS}`;
  // legend: swatch + name, wrapped
  const items = i.data.columns.map((c) => ({ c, text: i.colLabel(c), w: 14 + m.measureText(i.colLabel(c)).width + 14 }));
  const place: { c: string; text: string; x: number; y: number }[] = [];
  let x = 0, y = 0;
  for (const it of items) { if (x > 0 && x + it.w > width) { x = 0; y += 20; } place.push({ c: it.c, text: it.text, x, y }); x += it.w; }
  const legendH = items.length > 0 ? y + 20 : 0;
  const max = Math.max(1, ...i.data.rows.map((r) => r.total));
  const height = legendH + 8 + i.data.rows.length * (rowH + gap);
  return {
    width, height,
    draw: (ctx) => {
      ctx.textBaseline = "middle"; ctx.font = `12px ${SANS}`;
      for (const p of place) { ctx.fillStyle = i.colour(p.c); ctx.fillRect(p.x, p.y + 5, 10, 10); ctx.fillStyle = INK; ctx.fillText(p.text, p.x + 14, p.y + 10); }
      i.data.rows.forEach((r, n) => {
        const top = legendH + 8 + n * (rowH + gap), mid = top + rowH / 2;
        ctx.fillStyle = INK; ctx.font = `12.5px ${SANS}`;
        let name = i.rowLabel(r.key);
        while (name.length > 1 && ctx.measureText(name).width > nameW - 10) name = name.slice(0, -1);
        ctx.fillText(name === i.rowLabel(r.key) ? name : `${name}…`, 0, mid);
        const total = i.percent ? barW : (r.total / max) * barW;
        let at = nameW;
        for (const c of i.data.columns) {
          const n2 = r.cells[c]; if (!n2) continue;
          const w = (n2 / r.total) * total;
          ctx.fillStyle = i.colour(c); ctx.fillRect(at, top, w, rowH);
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(at, top, w, rowH);
          const text = i.percent ? `${Math.round((n2 / r.total) * 100)}%` : String(n2);
          if (w >= ctx.measureText(text).width + 8) { ctx.fillStyle = "#fff"; ctx.font = `600 11.5px ${SANS}`; ctx.textAlign = "center"; ctx.fillText(text, at + w / 2, mid); ctx.textAlign = "left"; }
          at += w;
        }
        ctx.fillStyle = MUTED; ctx.font = `12px ${SANS}`; ctx.textAlign = "right"; ctx.fillText(String(r.total), width, mid); ctx.textAlign = "left";
      });
    },
  };
}

/** Places the picture on a white sheet under the title (and a line of words about it), with the date at the foot. */
export function composeSheet(r: Raster, o: { title: string; subtitle?: string; dateLabel: string }): HTMLCanvasElement {
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `600 15px ${SANS}`;
  const inner = Math.max(r.width, 360);
  const titleLines = wrapText(o.title, inner, (s) => m.measureText(s).width);
  m.font = `12px ${SANS}`;
  const subLines = o.subtitle ? wrapText(o.subtitle, inner, (s) => m.measureText(s).width) : [];
  const headH = titleLines.length * 20 + subLines.length * 16 + (subLines.length ? 4 : 0) + 10;
  const width = inner + PAD * 2, height = PAD + headH + r.height + 12 + 16 + PAD / 2;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  let y = PAD;
  ctx.font = `600 15px ${SANS}`; ctx.fillStyle = INK;
  for (const l of titleLines) { ctx.fillText(l, PAD, y); y += 20; }
  ctx.font = `12px ${SANS}`; ctx.fillStyle = MUTED;
  if (subLines.length) y += 4;
  for (const l of subLines) { ctx.fillText(l, PAD, y); y += 16; }
  y += 10;
  ctx.save(); ctx.translate(PAD, y); r.draw(ctx); ctx.restore();
  ctx.textBaseline = "top"; ctx.font = `11px ${SANS}`; ctx.fillStyle = MUTED;
  ctx.fillText(`Product Velocity · ${o.dateLabel}`, PAD, y + r.height + 12);
  return canvas;
}

/** "Export PNG" for one chart. `raster` makes the picture when asked, so nothing is drawn until the button is used. */
export function ExportPngButton({ describe, name, raster, className = "rp-export" }: { /** The title and the line under it, read when the button is used. */ describe: () => { title: string; subtitle?: string }; /** What the button is called for a screen reader, e.g. the chart's own name. */ name: string; raster: () => Promise<Raster | null>; className?: string }) {
  const [note, setNote] = useState("");
  const run = async () => {
    setNote("");
    const r = await raster();
    if (!r) { setNote("This chart could not be exported."); return; }
    const day = new Date().toISOString().slice(0, 10);
    const { title, subtitle } = describe();
    const sheet = composeSheet(r, { title, ...(subtitle ? { subtitle } : {}), dateLabel: day });
    r.done?.();
    downloadPng(sheet, chartFileName(title, day));
    setNote("Picture saved.");
  };
  return (
    <>
      <button type="button" className={className} aria-label={`Export ${name} as PNG`} title="Export this chart as a PNG picture" onClick={() => void run()}>Export PNG</button>
      {note && <span role="status" className="sr-only">{note}</span>}
    </>
  );
}
