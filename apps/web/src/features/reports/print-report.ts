/**
 * Export of the whole Reports page as a PDF (issue #622). PDFs come from the browser's print view (Vercel cannot run LibreOffice):
 * the page is set to a fixed print width first so every chart redraws to fit, then the print window opens, where "Save as PDF" is chosen.
 * The print rules (what is hidden, the page size, no card split across pages) are in globals.css under `.rp-printing` and `@media print`.
 */
export const PRINT_WIDTH_PX = 1040;

/** The name the PDF is saved under by default: the browser uses the page title. */
export function reportPdfTitle(report: string, day: string): string {
  return `Product Velocity - Reports - ${report} - ${day}`;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export async function printReportPage(root: HTMLElement, title: string): Promise<void> {
  const before = document.title;
  root.classList.add("rp-printing");
  document.title = title;
  // two frames: the charts watch their box and redraw at the print width; then one more beat for the SVG to settle
  await nextFrame(); await nextFrame();
  await new Promise((r) => setTimeout(r, 150));
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    root.classList.remove("rp-printing");
    document.title = before;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  setTimeout(done, 120_000); // a browser that never says "afterprint" does not keep the page narrow
  window.print();
}
