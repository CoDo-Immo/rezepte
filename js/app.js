import { supabase } from "./supabaseClient.js";
import { APP_VERSION } from "./config.js";
import { initAuth, onAuthChange, getSession, canEdit, signIn, signOut } from "./auth.js";
import { buildRecipePdf, loadImageForPdf } from "./pdf.js";

// ---------- Kategorien kommen dynamisch aus der Supabase-Tabelle `kategorien` ----------
const DEFAULT_ICON = '<path d="M5 4h14v16H5Z"/><path d="M9 9h6M9 13h6"/>';
const WINE_ICON = '<path d="M8 3h8l-1 7a3 3 0 0 1-6 0Z"/><path d="M12 12v6M9 20h6"/>';
const SCHWIERIGKEIT_OPTIONS = ["einfach", "mittel", "anspruchsvoll"];

function svg(paths, cls) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ${cls ? `class="${cls}"` : ""}>${paths}</svg>`;
}
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- state ----------
let RECIPES = [];
let CATEGORIES = []; // aktive Kategorien aus Tabelle `kategorien`, sortiert
let WINES_BY_ID = {};
let ALL_WINES = null;
let currentCategory = null;
let currentSearchTerm = "";
const IMAGE_BUCKET = "rezeptbilder";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// ---------- DOM refs ----------
const loginGate = document.getElementById("login-gate");
const appShell = document.getElementById("app-shell");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const loginSubmit = document.getElementById("login-submit");
const viewHome = document.getElementById("view-home");
const viewList = document.getElementById("view-list");
const viewDetail = document.getElementById("view-detail");
const catGrid = document.getElementById("cat-grid");
const listTitle = document.getElementById("list-title");
const listCount = document.getElementById("list-count");
const recipeList = document.getElementById("recipe-list");
const detailBody = document.getElementById("detail-body");
const detailActions = document.getElementById("detail-actions");
const shareBtn = document.getElementById("share-btn");
const search = document.getElementById("search");
const authBtn = document.getElementById("auth-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalBox = document.getElementById("modal-box");
const toastEl = document.getElementById("toast");
const footerEl = document.getElementById("app-footer");
const filterToggle = document.getElementById("filter-toggle");
const filterPanel = document.getElementById("filter-panel");
const filterBadge = document.getElementById("filter-badge");
const filterResult = document.getElementById("filter-result");
const FL = {
  bewertung: document.getElementById("fl-bewertung"),
  portMin: document.getElementById("fl-port-min"), portMax: document.getElementById("fl-port-max"),
  zeitMin: document.getElementById("fl-zeit-min"), zeitMax: document.getElementById("fl-zeit-max"),
  waitMin: document.getElementById("fl-wait-min"), waitMax: document.getElementById("fl-wait-max"),
  wein: document.getElementById("fl-wein"), weinText: document.getElementById("fl-wein-text"),
};

function setView(v) {
  viewHome.hidden = v !== "home";
  viewList.hidden = v !== "list";
  viewDetail.hidden = v !== "detail";
}

function showToast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("toast-error", isError);
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalBox.innerHTML = "";
}

// ---------- data loading ----------
async function loadRecipes() {
  recipeList.innerHTML = `<div class="loading-state">Lade Rezepte …</div>`;
  const { data, error } = await supabase
    .from("rezepte")
    .select("id, titel, kategorie, portionen, zubereitungszeit_min, wartezeit_min, schwierigkeit, bewertung, zutaten, zubereitung, notizen, quelle, bild_url, wein_empfehlung_ids")
    .order("titel", { ascending: true });
  if (error) {
    showToast("Fehler beim Laden der Rezepte: " + error.message, true);
    RECIPES = [];
    return;
  }
  RECIPES = data || [];
  await loadCategories();
  renderCategoryGrid();
  renderFooter();
}

async function loadCategories() {
  const { data, error } = await supabase
    .from("kategorien")
    .select("id, name, icon, sortierung, aktiv")
    .eq("aktiv", true)
    .order("sortierung", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    showToast("Fehler beim Laden der Kategorien: " + error.message, true);
    CATEGORIES = [];
    return;
  }
  CATEGORIES = data || [];
}

function renderFooter() {
  footerEl.textContent = `${RECIPES.length} Rezepte · Version ${APP_VERSION}`;
}

// Lädt einmalig alle Weine (für Anzeige + Such-Auswahl in der Weinempfehlung).
async function ensureWinesLoaded() {
  if (ALL_WINES) return ALL_WINES;
  const { data, error } = await supabase.from("wines").select("id, name, weingut, jahr").order("name", { ascending: true });
  ALL_WINES = error ? [] : (data || []);
  ALL_WINES.forEach((w) => { WINES_BY_ID[w.id] = w; });
  return ALL_WINES;
}

function wineLabel(w) {
  return `${w.name}${w.weingut ? " – " + w.weingut : ""}${w.jahr ? " " + w.jahr : ""}`;
}

// ---------- Bild-Upload ----------
async function uploadRecipeImage(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const rand = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${rand}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function storagePathFromUrl(url) {
  const marker = `/object/public/${IMAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function deleteRecipeImage(url) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  try { await supabase.storage.from(IMAGE_BUCKET).remove([path]); } catch (_e) { /* best effort */ }
}

function totalCountForCategory(cat) {
  return RECIPES.filter((r) => r.kategorie === cat).length;
}

// ---------- home / category grid ----------
function renderCategoryGrid() {
  catGrid.innerHTML = "";
  if (!CATEGORIES.length) {
    catGrid.innerHTML = `<div class="empty-state">Keine Kategorien vorhanden.</div>`;
    return;
  }
  CATEGORIES.forEach(({ name: cat, icon }) => {
    const n = totalCountForCategory(cat);
    const btn = document.createElement("button");
    btn.className = "cat-tile";
    btn.innerHTML = `${svg(icon || DEFAULT_ICON)}<span class="name">${esc(cat)}</span><span class="count">${n} Rezept${n === 1 ? "" : "e"}</span>`;
    btn.addEventListener("click", () => showList(cat));
    catGrid.appendChild(btn);
  });
}

// ---------- star rating ----------
function starRow(n, clickable, onPick) {
  n = n || 0;
  const wrap = document.createElement("span");
  wrap.className = "stars" + (clickable ? " stars-clickable" : "");
  for (let i = 1; i <= 4; i++) {
    const s = document.createElement("span");
    s.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" class="${i <= n ? "star-on" : "star-off"}"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7Z"/></svg>`;
    if (clickable) {
      s.style.cursor = "pointer";
      s.addEventListener("click", () => onPick(i));
    }
    wrap.appendChild(s);
  }
  return wrap;
}
function starRowHtml(n) {
  n = n || 0;
  let s = '<span class="stars">';
  for (let i = 1; i <= 4; i++) {
    s += `<svg viewBox="0 0 24 24" fill="currentColor" class="${i <= n ? "star-on" : "star-off"}"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7Z"/></svg>`;
  }
  return s + "</span>";
}

// ---------- list view ----------
function renderRecipeCards(list, container) {
  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">Keine Rezepte gefunden.</div>`;
    return;
  }
  list.forEach((r) => {
    const card = document.createElement("button");
    card.className = "recipe-card";
    const metaBits = [];
    if (r.zubereitungszeit_min) metaBits.push(`<span class="mono">${r.zubereitungszeit_min} Min.</span>`);
    if (r.wartezeit_min) metaBits.push(`<span class="mono">+${r.wartezeit_min} Min. Ruhe/Gehzeit</span>`);
    if (r.schwierigkeit) metaBits.push(esc(r.schwierigkeit));
    card.innerHTML = `
      ${r.bild_url ? `<img class="rc-thumb" src="${esc(r.bild_url)}" alt="" loading="lazy">` : ""}
      <div class="rc-main">
        <div class="rc-title">${esc(r.titel)}</div>
        <div class="rc-meta">${metaBits.join(" · ") || "<span>Details in Kürze</span>"}</div>
      </div>
      <span class="rc-cat">${esc(r.kategorie)}</span>
      ${starRowHtml(r.bewertung)}
    `;
    card.addEventListener("click", () => showDetail(r));
    container.appendChild(card);
  });
}

function showList(cat) {
  currentCategory = cat;
  currentSearchTerm = "";
  listTitle.textContent = cat;
  const list = RECIPES.filter((r) => r.kategorie === cat);
  listCount.textContent = `${list.length} Rezept${list.length === 1 ? "" : "e"}`;
  renderRecipeCards(list, recipeList);
  setView("list");
}

// ---------- Filter ----------
function inRange(val, minEl, maxEl) {
  const min = numOrNull(minEl.value), max = numOrNull(maxEl.value);
  if (min === null && max === null) return true;
  if (val === null || val === undefined) return false;
  return (min === null || val >= min) && (max === null || val <= max);
}
function activeFilterCount() {
  let n = 0;
  if (Number(FL.bewertung.value) > 0) n++;
  if (FL.portMin.value !== "" || FL.portMax.value !== "") n++;
  if (FL.zeitMin.value !== "" || FL.zeitMax.value !== "") n++;
  if (FL.waitMin.value !== "" || FL.waitMax.value !== "") n++;
  if (FL.wein.value || FL.weinText.value.trim()) n++;
  return n;
}
function filtersActive() { return activeFilterCount() > 0; }
function matchesFilters(r) {
  const minStars = Number(FL.bewertung.value);
  if (minStars > 0 && (r.bewertung || 0) < minStars) return false;
  if (!inRange(r.portionen, FL.portMin, FL.portMax)) return false;
  if (!inRange(r.zubereitungszeit_min, FL.zeitMin, FL.zeitMax)) return false;
  if (!inRange(r.wartezeit_min, FL.waitMin, FL.waitMax)) return false;
  const ids = (r.wein_empfehlung_ids || []).filter(Boolean);
  if (FL.wein.value === "with" && !ids.length) return false;
  if (FL.wein.value === "without" && ids.length) return false;
  const wt = FL.weinText.value.trim().toLowerCase();
  if (wt) {
    if (!ids.some((id) => WINES_BY_ID[id] && wineLabel(WINES_BY_ID[id]).toLowerCase().includes(wt))) return false;
  }
  return true;
}
function updateFilterUi(shown) {
  const n = activeFilterCount();
  filterBadge.hidden = n === 0;
  filterBadge.textContent = n;
  filterToggle.classList.toggle("active", n > 0 || !filterPanel.hidden);
  filterResult.textContent = `${shown} von ${RECIPES.length} Rezepten`;
}
function resetFilters() {
  FL.bewertung.value = "0"; FL.wein.value = ""; FL.weinText.value = "";
  [FL.portMin, FL.portMax, FL.zeitMin, FL.zeitMax, FL.waitMin, FL.waitMax].forEach((el) => { el.value = ""; });
}
async function applyHomeState() {
  const q = search.value.trim();
  if (!q && !filtersActive()) { currentSearchTerm = ""; updateFilterUi(RECIPES.length); setView("home"); return; }
  await showResults(q);
}

// ---------- Trefferliste (Suche und/oder Filter) ----------
async function showResults(q) {
  currentCategory = null;
  currentSearchTerm = q || "";
  if (FL.wein.value === "with" || FL.weinText.value.trim()) await ensureWinesLoaded();
  const ql = (q || "").toLowerCase();
  const list = RECIPES.filter((r) =>
    (!ql ||
      (r.titel || "").toLowerCase().includes(ql) ||
      (r.zutaten || "").toLowerCase().includes(ql) ||
      (r.zubereitung || "").toLowerCase().includes(ql)) &&
    matchesFilters(r)
  );
  listTitle.textContent = q ? `Suche: „${q}“` : "Gefilterte Rezepte";
  listCount.textContent = `${list.length} Treffer`;
  updateFilterUi(list.length);
  renderRecipeCards(list, recipeList);
  setView("list");
}

// ---------- detail view ----------
async function showDetail(r) {
  const metaBits = [];
  if (r.portionen) metaBits.push(`<span class="badge mono">${r.portionen} Port.</span>`);
  if (r.zubereitungszeit_min) metaBits.push(`<span class="badge mono">${r.zubereitungszeit_min} Min. aktiv</span>`);
  if (r.wartezeit_min) metaBits.push(`<span class="badge mono">${r.wartezeit_min} Min. Ruhe/Gehzeit</span>`);
  if (r.schwierigkeit) metaBits.push(`<span class="badge">${esc(r.schwierigkeit)}</span>`);
  metaBits.push(starRowHtml(r.bewertung));

  const zutatenLines = (r.zutaten || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const zubereitungParas = (r.zubereitung || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);

  let content = "";
  if (zutatenLines.length || zubereitungParas.length) {
    content = `
      <div class="grid2">
        <div>
          <p class="block-title">Zutaten</p>
          <ul class="zutaten">${zutatenLines.map((z) => `<li>${esc(z)}</li>`).join("")}</ul>
        </div>
        <div>
          <p class="block-title">Zubereitung</p>
          <div class="prose">${zubereitungParas.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
        </div>
      </div>`;
  } else {
    content = `<div class="placeholder-box">Noch keine Zutaten/Zubereitung erfasst.</div>`;
  }

  let wineHtml = "";
  const wineIds = (r.wein_empfehlung_ids || []).filter(Boolean);
  if (wineIds.length) {
    await ensureWinesLoaded();
    const names = wineIds.map((id) => WINES_BY_ID[id]).filter(Boolean).map(wineLabel);
    if (names.length) {
      wineHtml = `<div class="wine-box">${svg(WINE_ICON)}<div><div class="wt">Weinempfehlung</div>${names.map((n) => `<div class="wv">${esc(n)}</div>`).join("")}</div></div>`;
    }
  }

  detailBody.innerHTML = `
    ${r.bild_url ? `<img class="detail-image" src="${esc(r.bild_url)}" alt="${esc(r.titel)}">` : ""}
    <span class="rc-cat">${esc(r.kategorie)}</span>
    <h2 style="margin-top:8px">${esc(r.titel)}</h2>
    <div class="detail-meta">${metaBits.join("")}</div>
    ${content}
    ${wineHtml}
    ${r.notizen ? `<p class="note">${esc(r.notizen)}</p>` : ""}
    ${r.quelle ? `<p class="note" style="margin-top:10px">Quelle: <span class="source-link">${esc(r.quelle)}</span></p>` : ""}
  `;
  detailBody.dataset.recipeId = r.id;
  renderDetailActions(r);
  setView("detail");
  // PDF im Hintergrund vorbereiten, damit das Teilen beim Klick sofort startet
  getRecipePdf(r).catch(() => {});
}

// ---------- PDF teilen ----------
// Das PDF wird pro Rezept (und Inhaltsstand) einmal erzeugt und zwischengespeichert.
// Wichtig für iOS/Safari: navigator.share() muss direkt auf den Klick folgen —
// deshalb wird das PDF schon beim Öffnen der Detailansicht vorbereitet.
const PDF_CACHE = new Map(); // recipe.id -> { sig, promise }

async function wineLabelsFor(r) {
  const ids = (r.wein_empfehlung_ids || []).filter(Boolean);
  if (!ids.length) return [];
  await ensureWinesLoaded();
  return ids.map((id) => WINES_BY_ID[id]).filter(Boolean).map(wineLabel);
}

function getRecipePdf(r) {
  const sig = JSON.stringify(r);
  const hit = PDF_CACHE.get(r.id);
  if (hit && hit.sig === sig) return hit.promise;
  const promise = (async () => {
    const [wines, image] = await Promise.all([
      wineLabelsFor(r),
      r.bild_url ? loadImageForPdf(r.bild_url).catch(() => null) : Promise.resolve(null),
    ]);
    const { blob, filename } = await buildRecipePdf(r, { wines, image });
    return { blob, filename, file: new File([blob], filename, { type: "application/pdf" }) };
  })();
  PDF_CACHE.set(r.id, { sig, promise });
  promise.catch(() => { if (PDF_CACHE.get(r.id)?.promise === promise) PDF_CACHE.delete(r.id); });
  return promise;
}

function canShareFile(file) {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); }
  catch (_e) { return false; }
}

function downloadPdf(pdf) {
  const url = URL.createObjectURL(pdf.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pdf.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function shareRecipe(r) {
  if (shareBtn.getAttribute("aria-busy") === "true") return;
  shareBtn.setAttribute("aria-busy", "true");
  let pdf;
  try {
    pdf = await getRecipePdf(r);
  } catch (e) {
    showToast("PDF konnte nicht erstellt werden: " + e.message, true);
    return;
  } finally {
    shareBtn.removeAttribute("aria-busy");
  }
  if (canShareFile(pdf.file)) {
    try {
      await navigator.share({ files: [pdf.file], title: r.titel, text: r.titel });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // Nutzer hat das Teilen-Menü geschlossen
      // sonst (z. B. NotAllowedError): Auswahl-Dialog als Rückfallebene
    }
  }
  showShareDialog(r, pdf);
}

function showShareDialog(r, pdf) {
  const canShare = canShareFile(pdf.file);
  const subject = `Rezept: ${r.titel}`;
  const body = `Hallo\n\nHier ist das Rezept „${r.titel}“ als PDF.\n`;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  modalBox.innerHTML = `
    <h3>Rezept als PDF teilen</h3>
    <p>${canShare
      ? "Das Teilen-Menü konnte nicht automatisch geöffnet werden."
      : "Dieser Browser kann PDFs nicht direkt an andere Apps übergeben."}
      Lade das PDF herunter und hänge es in Outlook, Mail oder WhatsApp an.</p>
    <div class="share-options">
      ${canShare ? `<button class="btn btn-primary" id="m-share">Teilen …</button>` : ""}
      <button class="btn ${canShare ? "" : "btn-primary"}" id="m-download">PDF herunterladen</button>
      <a class="btn" id="m-mail" href="${esc(mailto)}">E-Mail-Entwurf öffnen</a>
      <button class="btn" id="m-close">Schliessen</button>
    </div>
  `;
  modalBackdrop.hidden = false;
  document.getElementById("m-close").addEventListener("click", closeModal);
  document.getElementById("m-download").addEventListener("click", () => { downloadPdf(pdf); showToast("PDF heruntergeladen."); });
  const shareNow = document.getElementById("m-share");
  if (shareNow) shareNow.addEventListener("click", async () => {
    try { await navigator.share({ files: [pdf.file], title: r.titel, text: r.titel }); closeModal(); }
    catch (e) { if (!e || e.name !== "AbortError") showToast("Teilen nicht möglich – bitte PDF herunterladen.", true); }
  });
}

function renderDetailActions(r) {
  detailActions.hidden = false;
  shareBtn.hidden = false;
  shareBtn.onclick = () => shareRecipe(r);
  document.getElementById("edit-btn").onclick = () => requireEdit(() => showForm(r));
  document.getElementById("delete-btn").onclick = () => requireEdit(() => confirmDelete(r));
}

// ---------- form (neu / bearbeiten) ----------
async function showForm(existing) {
  const r = existing || { titel: "", kategorie: currentCategory || (CATEGORIES[0] && CATEGORIES[0].name) || "", portionen: "", zubereitungszeit_min: "", wartezeit_min: "", schwierigkeit: "", bewertung: 0, zutaten: "", zubereitung: "", notizen: "", quelle: "", bild_url: null, wein_empfehlung_ids: [] };
  let bewertung = r.bewertung || 0;
  let selectedImageFile = null;
  let imageRemoved = false;
  const originalBildUrl = r.bild_url || null;
  let selectedWineIds = [...(r.wein_empfehlung_ids || [])];

  detailActions.hidden = true;
  shareBtn.hidden = true;
  detailBody.innerHTML = `<div class="loading-state">Lade Formular …</div>`;
  await ensureWinesLoaded();
  setView("detail");
  detailBody.innerHTML = `
    <h2 style="margin-top:0">${existing ? "Rezept bearbeiten" : "Neues Rezept"}</h2>
    <div class="form-grid cols-2">
      <div class="field span-2">
        <label for="f-titel">Titel</label>
        <input id="f-titel" type="text" value="${esc(r.titel)}">
      </div>
      <div class="field">
        <label for="f-kategorie">Kategorie</label>
        <select id="f-kategorie">${(CATEGORIES.some((c) => c.name === r.kategorie) || !r.kategorie ? CATEGORIES.map((c) => c.name) : [r.kategorie, ...CATEGORIES.map((c) => c.name)]).map((c) => `<option value="${esc(c)}" ${c === r.kategorie ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="f-schwierigkeit">Schwierigkeit</label>
        <select id="f-schwierigkeit">
          <option value="">–</option>
          ${SCHWIERIGKEIT_OPTIONS.map((s) => `<option value="${s}" ${s === r.schwierigkeit ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="f-portionen">Portionen</label>
        <input id="f-portionen" type="number" min="1" value="${r.portionen ?? ""}">
      </div>
      <div class="field">
        <label for="f-zeit">Zubereitungszeit (Min.)</label>
        <input id="f-zeit" type="number" min="0" value="${r.zubereitungszeit_min ?? ""}">
      </div>
      <div class="field">
        <label for="f-wartezeit">Warte-/Ruhezeit (Min.)</label>
        <input id="f-wartezeit" type="number" min="0" value="${r.wartezeit_min ?? ""}">
      </div>
      <div class="field">
        <label>Bewertung</label>
        <div id="f-bewertung"></div>
      </div>
      <div class="field span-2">
        <label>Bild</label>
        <div class="image-field">
          ${originalBildUrl
            ? `<img class="image-preview" id="f-image-preview" src="${esc(originalBildUrl)}" alt="">`
            : `<div class="image-preview image-preview-empty" id="f-image-preview">Kein Bild</div>`}
          <div class="image-field-actions">
            <label class="btn" for="f-image-input">Bild wählen …</label>
            <input id="f-image-input" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            <button type="button" class="btn" id="f-image-remove" ${originalBildUrl ? "" : "hidden"}>Entfernen</button>
          </div>
        </div>
        <p class="field-hint">JPEG, PNG oder WebP, max. 3 MB.</p>
      </div>
      <div class="field span-2">
        <label for="f-zutaten">Zutaten (eine pro Zeile)</label>
        <textarea id="f-zutaten" rows="8">${esc(r.zutaten)}</textarea>
      </div>
      <div class="field span-2">
        <label for="f-zubereitung">Zubereitung</label>
        <textarea id="f-zubereitung" rows="8">${esc(r.zubereitung)}</textarea>
      </div>
      <div class="field span-2">
        <label for="f-notizen">Notizen</label>
        <textarea id="f-notizen" rows="3">${esc(r.notizen)}</textarea>
      </div>
      <div class="field span-2">
        <label for="f-quelle">Quelle</label>
        <input id="f-quelle" type="text" value="${esc(r.quelle)}">
      </div>
      <div class="field span-2">
        <label for="f-wein-search">Weinempfehlung</label>
        <div class="wine-picker">
          <div class="wine-chips" id="f-wine-chips"></div>
          <input id="f-wein-search" type="text" placeholder="Wein suchen, z. B. Name oder Weingut …" autocomplete="off">
          <div class="wine-suggestions" id="f-wine-suggestions" hidden></div>
        </div>
        <p class="field-hint">${ALL_WINES && ALL_WINES.length ? "Aus dem Weinkeller auswählen." : "Keine Weine im Weinkeller gefunden."}</p>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn" id="f-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="f-save">Speichern</button>
    </div>
  `;
  const starHolder = document.getElementById("f-bewertung");
  function renderStars() {
    starHolder.innerHTML = "";
    starHolder.appendChild(starRow(bewertung, true, (i) => { bewertung = bewertung === i ? 0 : i; renderStars(); }));
  }
  renderStars();

  // ---- Bild-Feld ----
  const imagePreview = document.getElementById("f-image-preview");
  const imageInput = document.getElementById("f-image-input");
  const imageRemoveBtn = document.getElementById("f-image-remove");
  function setPreview(src) {
    const el = document.createElement(src ? "img" : "div");
    el.id = "f-image-preview";
    if (src) { el.className = "image-preview"; el.src = src; el.alt = ""; }
    else { el.className = "image-preview image-preview-empty"; el.textContent = "Kein Bild"; }
    imagePreview.replaceWith(el);
    return el;
  }
  let previewEl = imagePreview;
  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { showToast("Nur JPEG, PNG oder WebP erlaubt.", true); imageInput.value = ""; return; }
    if (file.size > MAX_IMAGE_BYTES) { showToast("Bild ist grösser als 3 MB.", true); imageInput.value = ""; return; }
    selectedImageFile = file;
    imageRemoved = false;
    previewEl = setPreview(URL.createObjectURL(file));
    imageRemoveBtn.hidden = false;
  });
  imageRemoveBtn.addEventListener("click", () => {
    selectedImageFile = null;
    imageRemoved = true;
    imageInput.value = "";
    previewEl = setPreview(null);
    imageRemoveBtn.hidden = true;
  });

  // ---- Weinempfehlung-Auswahl ----
  const wineChipsEl = document.getElementById("f-wine-chips");
  const wineSearchEl = document.getElementById("f-wein-search");
  const wineSuggestionsEl = document.getElementById("f-wine-suggestions");
  function renderWineChips() {
    wineChipsEl.innerHTML = selectedWineIds.map((id) => {
      const w = WINES_BY_ID[id];
      const label = w ? wineLabel(w) : id;
      return `<span class="chip" data-id="${esc(id)}">${esc(label)}<button type="button" class="chip-remove" data-id="${esc(id)}" aria-label="Entfernen">×</button></span>`;
    }).join("");
    wineChipsEl.querySelectorAll(".chip-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedWineIds = selectedWineIds.filter((id) => id !== btn.dataset.id);
        renderWineChips();
      });
    });
  }
  renderWineChips();
  function renderWineSuggestions(query) {
    const ql = query.trim().toLowerCase();
    const pool = (ALL_WINES || []).filter((w) => !selectedWineIds.includes(w.id));
    const matches = ql
      ? pool.filter((w) => wineLabel(w).toLowerCase().includes(ql)).slice(0, 8)
      : [];
    if (!matches.length) { wineSuggestionsEl.hidden = true; wineSuggestionsEl.innerHTML = ""; return; }
    wineSuggestionsEl.innerHTML = matches.map((w) => `<button type="button" class="wine-suggestion" data-id="${esc(w.id)}">${esc(wineLabel(w))}</button>`).join("");
    wineSuggestionsEl.hidden = false;
    wineSuggestionsEl.querySelectorAll(".wine-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedWineIds.push(btn.dataset.id);
        wineSearchEl.value = "";
        wineSuggestionsEl.hidden = true;
        renderWineChips();
      });
    });
  }
  wineSearchEl.addEventListener("input", () => renderWineSuggestions(wineSearchEl.value));
  wineSearchEl.addEventListener("blur", () => setTimeout(() => { wineSuggestionsEl.hidden = true; }, 150));

  document.getElementById("f-cancel").addEventListener("click", () => {
    if (existing) showDetail(existing); else backFromDetail();
  });
  document.getElementById("f-save").addEventListener("click", async () => {
    const saveBtn = document.getElementById("f-save");
    const payload = {
      titel: document.getElementById("f-titel").value.trim(),
      kategorie: document.getElementById("f-kategorie").value,
      schwierigkeit: document.getElementById("f-schwierigkeit").value || null,
      portionen: numOrNull(document.getElementById("f-portionen").value),
      zubereitungszeit_min: numOrNull(document.getElementById("f-zeit").value),
      wartezeit_min: numOrNull(document.getElementById("f-wartezeit").value),
      bewertung: bewertung || null,
      zutaten: document.getElementById("f-zutaten").value,
      zubereitung: document.getElementById("f-zubereitung").value,
      notizen: document.getElementById("f-notizen").value || null,
      quelle: document.getElementById("f-quelle").value || null,
      wein_empfehlung_ids: selectedWineIds.length ? selectedWineIds : null,
    };
    if (!payload.titel) { showToast("Bitte einen Titel angeben.", true); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = "Speichern …";
    try {
      if (selectedImageFile) {
        payload.bild_url = await uploadRecipeImage(selectedImageFile);
        if (originalBildUrl) await deleteRecipeImage(originalBildUrl);
      } else if (imageRemoved) {
        payload.bild_url = null;
        if (originalBildUrl) await deleteRecipeImage(originalBildUrl);
      } else {
        payload.bild_url = originalBildUrl;
      }
    } catch (e) {
      showToast("Bild-Upload fehlgeschlagen: " + e.message, true);
      saveBtn.disabled = false;
      saveBtn.textContent = "Speichern";
      return;
    }
    await saveRecipe(payload, existing ? existing.id : null);
  });
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function saveRecipe(payload, id) {
  let error;
  if (id) {
    ({ error } = await supabase.from("rezepte").update(payload).eq("id", id));
  } else {
    ({ error } = await supabase.from("rezepte").insert(payload));
  }
  if (error) {
    showToast("Speichern fehlgeschlagen: " + error.message, true);
    return;
  }
  showToast(id ? "Rezept aktualisiert." : "Rezept angelegt.");
  await loadRecipes();
  if (currentCategory) showList(currentCategory);
  else setView("home");
}

function confirmDelete(r) {
  modalBox.innerHTML = `
    <h3>Rezept löschen?</h3>
    <p>„${esc(r.titel)}“ wird dauerhaft aus der Datenbank entfernt. Das kann nicht rückgängig gemacht werden.</p>
    <div class="form-actions">
      <button class="btn" id="m-cancel">Abbrechen</button>
      <button class="btn btn-danger" id="m-delete">Löschen</button>
    </div>
  `;
  modalBackdrop.hidden = false;
  document.getElementById("m-cancel").addEventListener("click", closeModal);
  document.getElementById("m-delete").addEventListener("click", async () => {
    const { error } = await supabase.from("rezepte").delete().eq("id", r.id);
    closeModal();
    if (error) { showToast("Löschen fehlgeschlagen: " + error.message, true); return; }
    showToast("Rezept gelöscht.");
    await loadRecipes();
    if (currentCategory) showList(currentCategory); else setView("home");
  });
}

function backFromDetail() {
  if (currentSearchTerm || (!currentCategory && filtersActive())) showResults(currentSearchTerm);
  else if (currentCategory) showList(currentCategory);
  else setView("home");
}

// ---------- auth ----------
// Die ganze App erfordert eine Anmeldung (wie bei der Weinkeller-App); die Rolle
// "viewer" darf laut Datenbank-Regeln aber nichts anlegen/ändern/löschen — dafür
// werden Bearbeiten-/Löschen-/Neu-Icons per CSS ausgeblendet (body.can-edit).
function requireEdit(action) {
  if (canEdit()) { action(); return; }
  showToast("Diese Anmeldung hat nur Lesezugriff.", true);
}

let recipesLoadedOnce = false;

function showLoginGate() {
  loginGate.hidden = false;
  appShell.hidden = true;
  loginError.textContent = "";
  loginPassword.value = "";
  loginEmail.focus();
}

async function showAppShell() {
  loginGate.hidden = true;
  appShell.hidden = false;
  if (!recipesLoadedOnce) {
    recipesLoadedOnce = true;
    await loadRecipes();
  }
}

function updateAuthUi(session) {
  document.body.classList.toggle("can-edit", canEdit());
  if (session) showAppShell();
  else { recipesLoadedOnce = false; showLoginGate(); }
}

async function doLogin() {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  loginSubmit.disabled = true;
  try {
    await signIn(email, password);
    loginError.textContent = "";
  } catch (e) {
    loginError.textContent = "Anmeldung fehlgeschlagen. E-Mail/Passwort prüfen.";
  } finally {
    loginSubmit.disabled = false;
  }
}
loginSubmit.addEventListener("click", doLogin);
[loginEmail, loginPassword].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); }));

authBtn.addEventListener("click", async () => {
  await signOut();
  resetFilters();
  filterPanel.hidden = true;
  filterToggle.setAttribute("aria-expanded", "false");
  updateFilterUi(0);
  search.value = "";
  currentSearchTerm = "";
  currentCategory = null;
  showToast("Abgemeldet.");
});

onAuthChange(updateAuthUi);

// ---------- global events ----------
function goHome() {
  resetFilters();
  updateFilterUi(RECIPES.length);
  search.value = "";
  currentSearchTerm = "";
  currentCategory = null;
  setView("home");
}
document.getElementById("home-btn").addEventListener("click", goHome);
document.getElementById("home-btn").addEventListener("keypress", (e) => { if (e.key === "Enter") goHome(); });
document.getElementById("list-back").addEventListener("click", goHome);
document.getElementById("list-home").addEventListener("click", goHome);
document.getElementById("detail-back").addEventListener("click", backFromDetail);
document.getElementById("detail-home").addEventListener("click", goHome);
document.getElementById("add-btn").addEventListener("click", () => requireEdit(() => showForm(null)));
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

let searchTimer;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    applyHomeState();
  }, 120);
});

filterToggle.addEventListener("click", () => {
  filterPanel.hidden = !filterPanel.hidden;
  filterToggle.setAttribute("aria-expanded", String(!filterPanel.hidden));
  updateFilterUi(RECIPES.length);
});
Object.values(FL).forEach((el) => {
  el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyHomeState, 150);
  });
});
document.getElementById("filter-reset").addEventListener("click", () => {
  resetFilters();
  applyHomeState();
});

// ---------- init ----------
(async function init() {
  setView("home");
  const session = await initAuth();
  await updateAuthUi(session);
})();

// ---------- PWA: Service Worker registrieren (Installierbarkeit) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* PWA-Installation ist ein Extra, kein hartes Erfordernis */ });
  });
}
