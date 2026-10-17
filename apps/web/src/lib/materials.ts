/**
 * Turn attached files into text the tutor can read. Text files are read as
 * is; PDFs are extracted page by page in the browser with pdf.js. Scanned
 * PDFs and images need a vision step, which is not wired yet.
 */
export interface Material {
  name: string;
  text: string;
}

const MAX_CHARS = 60_000;

export async function readMaterial(file: File): Promise<{ material?: Material; skipped?: string }> {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const text = await extractPdfText(file);
    if (!text.trim()) return { skipped: `${file.name} (no selectable text, maybe a scan)` };
    return { material: { name: file.name, text: text.slice(0, MAX_CHARS) } };
  }
  if (/\.(txt|md|markdown|csv|json|py|js|ts|html?)$/i.test(file.name) || file.type.startsWith("text/")) {
    return { material: { name: file.name, text: (await file.text()).slice(0, MAX_CHARS) } };
  }
  return { skipped: file.name };
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    let out = "";
    let lastY: number | null = null;
    for (const item of content.items as { str: string; transform: number[] }[]) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        out += line.trimEnd() + "\n";
        line = "";
      }
      line += item.str;
      lastY = y;
    }
    out += line;
    pages.push(`--- page ${i} ---\n${out.trim()}`);
    if (pages.join("\n").length > MAX_CHARS) break;
  }
  return pages.join("\n\n");
}
