// PDF-Export eines Rezepts (A4, Text als echter Text – klein, durchsuchbar, druckbar).
// Nutzt jsPDF (wird erst bei Bedarf per CDN nachgeladen, kein Build-Schritt nötig).

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
let libPromise = null;

export function loadPdfLib() {
  const g = typeof window !== "undefined" ? window : globalThis;
  if (g.jspdf && g.jspdf.jsPDF) return Promise.resolve(g.jspdf.jsPDF);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = JSPDF_URL;
      s.async = true;
      s.onload = () => (window.jspdf && window.jspdf.jsPDF
        ? resolve(window.jspdf.jsPDF)
        : (libPromise = null, reject(new Error("PDF-Bibliothek nicht verfügbar"))));
      s.onerror = () => { libPromise = null; reject(new Error("PDF-Bibliothek konnte nicht geladen werden (offline?)")); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

// ---------- Text für die PDF-Standardschrift (Helvetica, WinAnsi) aufbereiten ----------
const REPLACE = {
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  "−": "-", "‐": "-", "‑": "-", "‒": "-",
  "→": "->", "←": "<-", "≈": "~", "≤": "<=", "≥": ">=",
  "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅕": "1/5", "⅙": "1/6",
  "‘": "'", "’": "'", "‚": ",", "“": "\"", "”": "\"", "„": "\"",
  "–": "-", "—": "-", "•": "-", "…": "...", "€": "EUR",
};
function pdfText(s) {
  let out = "";
  for (const ch of String(s ?? "").replace(/\r/g, "")) {
    if (ch === "\n") { out += ch; continue; }
    if (REPLACE[ch] !== undefined) { out += REPLACE[ch]; continue; }
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) { out += " "; continue; }
    if (c <= 255) { out += ch; continue; }
    // übrige Zeichen: Akzente entfernen (ő -> o), sonst weglassen (Emojis etc.)
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base && base.charCodeAt(0) < 128) out += base;
  }
  return out;
}

// ---------- Layout ----------
const PAGE_W = 210, PAGE_H = 297, MARGIN = 18, CW = PAGE_W - 2 * MARGIN;
const TOP = 18, BOTTOM = PAGE_H - 20;
const INK = [51, 62, 77], MUTED = [107, 119, 137], LINE = [219, 227, 240];
const ACCENT = [47, 93, 138], ACCENT_2 = [18, 58, 94], TINT = [230, 238, 247], STAR_OFF = [200, 208, 220];
const PT = 0.3528; // mm pro Punkt

function drawStar(doc, cx, cy, r, on) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  const rel = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  doc.setFillColor(...(on ? ACCENT : STAR_OFF));
  doc.lines(rel, pts[0][0], pts[0][1], [1, 1], "F", true);
}

/**
 * Baut das PDF eines Rezepts.
 * @param r        Rezept-Objekt aus der Tabelle `rezepte`
 * @param opts.wines       Array mit fertigen Weinbezeichnungen (Strings)
 * @param opts.image       optional { dataUrl, w, h } (JPEG, bereits zugeschnitten)
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function buildRecipePdf(r, { wines = [], image = null } = {}) {
  const jsPDF = await loadPdfLib();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const titel = pdfText(r.titel || "Rezept");
  doc.setProperties({ title: titel, subject: "Rezept", creator: "Rezepte-App" });

  let y = TOP;
  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; } };
  const lineH = (fs, k = 1.45) => fs * PT * k;

  // Zeilenweise schreiben (mit automatischem Seitenumbruch); y = Oberkante der Zeile
  function writeLines(lines, x, fs, { color = INK, style = "normal", k = 1.45 } = {}) {
    doc.setFont("helvetica", style);
    doc.setFontSize(fs);
    doc.setTextColor(...color);
    const lh = lineH(fs, k);
    for (const line of lines) {
      ensure(lh);
      doc.text(line, x, y + fs * PT * 0.82);
      y += lh;
    }
  }
  const wrap = (text, width, fs, style = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(fs);
    return doc.splitTextToSize(text, width);
  };
  function blockTitle(text) {
    ensure(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(text.toUpperCase(), MARGIN, y + 8.5 * PT * 0.82, { charSpace: 0.5 });
    y += lineH(8.5) + 2.5;
  }

  // --- Bild ---
  if (image && image.dataUrl) {
    const h = CW * (image.h / image.w);
    ensure(h + 4);
    doc.addImage(image.dataUrl, "JPEG", MARGIN, y, CW, h, undefined, "FAST");
    y += h + 7;
  }

  // --- Kategorie, Titel, Meta ---
  if (r.kategorie) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...ACCENT);
    doc.text(pdfText(r.kategorie).toUpperCase(), MARGIN, y + 8.5 * PT * 0.82, { charSpace: 0.5 });
    y += lineH(8.5) + 1.5;
  }
  writeLines(wrap(titel, CW, 22, "bold"), MARGIN, 22, { color: ACCENT_2, style: "bold", k: 1.25 });
  y += 2;

  const meta = [];
  if (r.portionen) meta.push(`${r.portionen} Portionen`);
  if (r.zubereitungszeit_min) meta.push(`${r.zubereitungszeit_min} Min. aktiv`);
  if (r.wartezeit_min) meta.push(`${r.wartezeit_min} Min. Ruhe/Gehzeit`);
  if (r.schwierigkeit) meta.push(pdfText(r.schwierigkeit));
  if (meta.length) writeLines(wrap(meta.join("   ·   "), CW, 10), MARGIN, 10, { color: MUTED });
  if (r.bewertung) {
    ensure(7);
    for (let i = 1; i <= 4; i++) drawStar(doc, MARGIN + 2.4 + (i - 1) * 6, y + 3.2, 2.4, i <= r.bewertung);
    y += 7;
  }
  y += 3;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  // --- Zutaten / Zubereitung ---
  const zutaten = String(r.zutaten || "").split("\n").map((l) => pdfText(l).trim()).filter(Boolean);
  const schritte = String(r.zubereitung || "").split(/\n+/).map((l) => pdfText(l).trim()).filter(Boolean);

  if (zutaten.length) {
    blockTitle("Zutaten");
    for (const z of zutaten) {
      const lines = wrap(z, CW - 6, 10.5);
      ensure(lineH(10.5) * Math.min(lines.length, 2) + 2);
      doc.setFillColor(...ACCENT);
      doc.circle(MARGIN + 1.3, y + lineH(10.5) / 2, 0.55, "F");
      writeLines(lines, MARGIN + 5, 10.5);
      y += 1.2;
    }
    y += 5;
  }
  if (schritte.length) {
    blockTitle("Zubereitung");
    for (const p of schritte) {
      writeLines(wrap(p, CW, 10.5), MARGIN, 10.5, { k: 1.55 });
      y += 2.5;
    }
    y += 3;
  }
  if (!zutaten.length && !schritte.length) {
    writeLines(["Noch keine Zutaten/Zubereitung erfasst."], MARGIN, 10.5, { color: MUTED, style: "italic" });
    y += 4;
  }

  // --- Weinempfehlung ---
  const weine = wines.map(pdfText).filter(Boolean);
  if (weine.length) {
    const wl = weine.flatMap((w) => wrap(w, CW - 12, 10.5));
    const boxH = 5 + lineH(8.5) + 1.5 + wl.length * lineH(10.5) + 4;
    ensure(boxH + 2);
    doc.setFillColor(...TINT);
    doc.roundedRect(MARGIN, y, CW, boxH, 2.5, 2.5, "F");
    const top = y;
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...ACCENT_2);
    doc.text("WEINEMPFEHLUNG", MARGIN + 6, y + 8.5 * PT * 0.82, { charSpace: 0.5 });
    y += lineH(8.5) + 1.5;
    writeLines(wl, MARGIN + 6, 10.5);
    y = top + boxH + 6;
  }

  // --- Notizen / Quelle ---
  if (r.notizen) writeLines(wrap(pdfText(r.notizen), CW, 9.5, "italic"), MARGIN, 9.5, { color: MUTED, style: "italic" });
  if (r.quelle) {
    y += 2;
    writeLines(wrap("Quelle: " + pdfText(r.quelle), CW, 9.5), MARGIN, 9.5, { color: MUTED });
  }

  // --- Fusszeile auf jeder Seite ---
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const left = doc.splitTextToSize(titel, CW - 30)[0] || "";
    doc.text(left, MARGIN, PAGE_H - 9.5);
    doc.text(`Seite ${i} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 9.5, { align: "right" });
  }

  const safeName = (r.titel || "Rezept").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Rezept";
  return { blob: doc.output("blob"), filename: `${safeName}.pdf` };
}

// ---------- Bild für das PDF vorbereiten (Browser) ----------
// Lädt das Rezeptbild, schneidet es auf max. 2:1-Querformat zu (wie "cover" in der App)
// und verkleinert es – hält das PDF klein genug für E-Mail/WhatsApp.
export async function loadImageForPdf(url, { maxW = 1200, maxRatio = 0.5, timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const bmp = await createImageBitmap(await res.blob());
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (sh > sw * maxRatio) { sh = Math.round(sw * maxRatio); sy = Math.round((bmp.height - sh) / 2); }
    const scale = Math.min(1, maxW / sw);
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), w, h };
  } finally {
    clearTimeout(timer);
  }
}
