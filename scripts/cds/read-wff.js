// Reads every talent in WebForFashion (CDS's media module) — CDS boards, stats,
// skills, portfolios and the complete photo / digital / video list — and hands it
// to the 42 dashboard window that opened this one (Dashboard → CDS Import →
// "2. Open WebForFashion"). Run it in that window's console on the Talent search
// page ("All active"). It runs in the background; read window.__cdsImport.
//
// Read-only: GET requests and the gallery's own "load more" only. Photo files
// are never downloaded here: in photo mode (window.__cdsMode = "photos") the
// signed links are handed to the dashboard, whose server copies the files. Ethnicity, rates,
// commission, billing and documents are never read.
(() => {
  const DASHBOARD = "https://42-model-management-kappa.vercel.app";
  const state = (window.__cdsImport = { phase: "starting", listed: 0, read: 0, sent: 0, unmatched: [], errors: [] });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Background tabs throttle timers, so a wait is tied to the request the page
  // itself starts (jQuery "ajaxComplete"). The page keeps one long request open,
  // so "all requests finished" never happens; returns false if none started.
  const whenLoaded = async (win, trigger) => {
    const $ = win.jQuery;
    if (!$) { trigger(); await sleep(1500); return true; }
    const before = $.active;
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 30000);
      $(win.document).one("ajaxComplete", () => { clearTimeout(timer); resolve(true); });
    });
    trigger();
    if ($.active <= before) return false;
    return done;
  };
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const get = (path) => fetch(path, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } })
    .then((r) => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r; });
  const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

  const send = (payload) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("message", onAck); reject(new Error("The dashboard did not answer")); }, 180000);
    function onAck(event) {
      if (event.origin !== DASHBOARD || event.data?.type !== "cds-import/ack" || event.data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onAck);
      if (event.data.ok) resolve(event.data); else reject(new Error(event.data.error || "Not saved"));
    }
    window.addEventListener("message", onAck);
    window.opener.postMessage({ type: "cds-import/batch", requestId, payload }, DASHBOARD);
  });

  // Talent search lists 15 at a time as you scroll; scroll until all are shown.
  async function talentIds() {
    const count = () => Number((document.body.innerText.match(/(\d+)\s+results?/i) || [])[1] || 0);
    for (let wait = 0; wait < 30 && !count(); wait += 1) await sleep(1000);
    const total = count();
    if (!total) throw new Error("The talent list did not load; reload this window and run again");
    const collect = () => [...new Set([...document.querySelectorAll("a[href]")]
      .map((a) => (a.getAttribute("href").match(/^(?:https:\/\/app\.webforfashion\.com)?\/(?:imaging\/talent|talent\/edit)\/(\d+)$/) || [])[1]).filter(Boolean))];
    let ids = collect();
    for (let round = 0, still = 0; round < 60 && ids.length < total && still < 4; round += 1) {
      await whenLoaded(window, () => { window.scrollTo(0, document.body.scrollHeight); window.jQuery?.(window).trigger("scroll"); });
      const next = collect();
      still = next.length === ids.length ? still + 1 : 0;
      ids = next;
    }
    window.scrollTo(0, 0);
    return ids;
  }

  // Loads a gallery page in a hidden frame and keeps calling its own "load more"
  // until every item is present; returns the media cards in display order.
  async function galleryItems(path) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;height:900px;visibility:hidden";
    const loaded = new Promise((resolve) => { frame.onload = resolve; });
    frame.src = path;
    document.body.appendChild(frame);
    try {
      await loaded;
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const ids = () => new Set([...doc.querySelectorAll("[data-media-id]")].map((e) => e.getAttribute("data-media-id"))).size;
      const total = () => Number((doc.body.innerText.match(/\(\s*\d+\s*\/\s*(\d+)\s*(images?|digitals?|videos?|photos?)\)/i) || [])[1] || 0);
      for (let round = 0, still = 0; round < 200 && typeof win.loadMorePhotos === "function" && still < 3 && (!total() || ids() < total()); round += 1) {
        const before = ids();
        if (!(await whenLoaded(win, () => win.loadMorePhotos()))) break;
        still = ids() === before ? still + 1 : 0;
      }
      // On the Digitals page the id is on the <li> and the signed link on its <img>.
      const seen = new Set();
      return [...doc.querySelectorAll("[data-media-id]")].map((el) => {
        const id = el.getAttribute("data-media-id");
        if (!/^\d+$/.test(id) || seen.has(id)) return null;
        seen.add(id);
        const card = el.closest(".imaging-widget-media") || el.parentElement;
        return { id, web: /\bWEB\b/.test(card?.innerText || ""), primary: Boolean(card?.querySelector(".fa-star")), big: el.getAttribute("data-src-big") || el.querySelector("[data-src-big]")?.getAttribute("data-src-big") || "" };
      }).filter(Boolean);
    } finally {
      frame.remove();
    }
  }

  function profileFields(doc) {
    const value = (el) => {
      if (el.tagName === "SELECT") { const text = el.selectedOptions[0]?.textContent.trim() || ""; return text === "..." ? "" : text; }
      if (el.type === "checkbox" || el.type === "radio") return el.checked ? el.value : "";
      return (el.value || "").trim();
    };
    const byName = (name) => [...doc.getElementsByName(name)].map(value).find(Boolean) || "";
    const boardNames = Object.fromEntries([...doc.querySelectorAll('select[name="switch-boards"] option')].map((o) => [o.value, o.textContent.trim()]));

    const stats = {};
    const SKIP = /ethnic|commission|tax|tariff|rate|billing|address|password/i;
    for (const el of doc.querySelectorAll('[name^="talent_form["]')) {
      const m = el.name.match(/^talent_form\[(official_|real_)?([a-z_]+)\]$/);
      if (!m || SKIP.test(m[2]) || /^(firstname|lastname|birthplace|is_resident|nationalities)$/.test(m[2])) continue;
      const v = value(el);
      if (!v || v === "...") continue;
      const key = m[1] === "real_" ? `real_${m[2]}` : m[2];
      if (!(key in stats)) stats[key] = v.slice(0, 120);
    }
    for (const label of doc.querySelectorAll('[name^="talent_form[talent_characteristics]"][name$="[label]"]')) {
      const status = byName(label.name.replace("[label]", "[status]"));
      if (status && status !== "...") stats[`characteristic_${label.value.toLowerCase().replace(/\W+/g, "_")}`] = status.slice(0, 120);
    }
    // The skill field is a list: keep the option's name, not its id.
    const skills = [...doc.querySelectorAll('[name^="talent_form[talent_skills]"][name$="[skill]"]')].map((el) => ({
      skill: el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent || "").trim() : el.value.trim(), level: byName(el.name.replace("[skill]", "[level]")) || null,
    })).filter((s) => s.skill && !/^\d+$/.test(s.skill));
    const month = byName("talent_form[birthdate][month]"), day = byName("talent_form[birthdate][day]"), year = byName("talent_form[birthdate][year]");
    return {
      first_name: byName("talent_form[firstname]"),
      last_name: byName("talent_form[lastname]"),
      emails: [...doc.querySelectorAll('[name^="talent_form[emails]"][name$="[email]"]')].map((el) => el.value.trim()).filter(Boolean),
      phones: [...doc.querySelectorAll('[name^="talent_form[phones]"][name$="[number]"]')].map((el) => el.value.trim()).filter(Boolean),
      cds_boards: [...doc.querySelectorAll('input[name="talent_form[talent_company_company_departments][]"]:checked')].map((el) => boardNames[el.value]).filter(Boolean),
      profile: { date_of_birth: MONTHS[month] && day && year ? `${year}-${MONTHS[month]}-${day.padStart(2, "0")}` : null, stats, skills },
    };
  }

  async function portfolios(id) {
    const doc = parse(await (await get(`/imaging/talent/${id}/portfolios`)).text());
    const list = [...doc.querySelectorAll("[data-load-portfolio][data-portfolio-id]")];
    const result = [];
    for (const item of list) {
      const portfolioId = item.getAttribute("data-portfolio-id");
      if (result.some((p) => p.id === portfolioId)) continue;
      const name = (doc.querySelector(`[data-portfolio-id="${portfolioId}"][data-portfolio-name]`)?.getAttribute("data-portfolio-name") || item.textContent).trim();
      const body = await (await get(item.getAttribute("data-load-portfolio"))).json();
      const html = parse(body.html || "");
      const media = [...new Set([...html.querySelectorAll("[data-media-id]")].map((e) => e.getAttribute("data-media-id")).filter((m) => /^\d+$/.test(m)))];
      result.push({ id: portfolioId, name: name.slice(0, 120), website: /Website Available since/i.test(body.html || "") || /Website Available since/i.test(item.parentElement?.textContent || ""), media });
    }
    return result;
  }

  async function readTalent(id) {
    const profile = profileFields(parse(await (await get(`/talent/edit/${id}`)).text()));
    const images = await galleryItems(`/imaging/talent/${id}`);
    const digitals = await galleryItems(`/imaging/talent/${id}/digitals`);
    const videos = await galleryItems(`/imaging/talent/${id}/videos`);
    // Digitals are also in the full image list: keep one entry, marked digital.
    const digitalIds = new Set(digitals.map((m) => m.id));
    const media = [
      ...images.map((m, i) => ({ id: m.id, kind: digitalIds.has(m.id) ? "digital" : "image", position: i, metadata: { web: m.web, primary: m.primary } })),
      ...digitals.filter((m) => !images.some((i) => i.id === m.id)).map((m, i) => ({ id: m.id, kind: "digital", position: images.length + i, metadata: {} })),
      ...videos.map((m, i) => ({ id: m.id, kind: "video", position: i, metadata: {} })),
    ];
    return { wff_id: id, ...profile, portfolios: await portfolios(id), media };
  }

  // Photo mode (window.__cdsMode = "photos"): asks the dashboard which photos to
  // copy, reads each one's signed full-size link from the gallery, and hands the
  // links over a few at a time; the dashboard's server copies the files. Nothing
  // is downloaded in this browser.
  async function copyPhotos() {
    const plan = (await send({ plan: true })).result;
    const only = Array.isArray(window.__cdsOnly) ? new Set(window.__cdsOnly) : null;
    const talents = plan.talents.filter((t) => !only || only.has(t.wff_id));
    Object.assign(state, { phase: "copying", listed: talents.length, photos: 0, failed: 0, missing: [] });
    for (const talent of talents) {
      try {
        if (talent.media.length) {
          const wanted = new Set(talent.media);
          const found = new Map();
          for (const path of [`/imaging/talent/${talent.wff_id}`, `/imaging/talent/${talent.wff_id}/digitals`]) {
            for (const item of await galleryItems(path)) if (wanted.has(item.id) && item.big && !found.has(item.id)) found.set(item.id, item.big);
          }
          if (found.size < wanted.size) state.missing.push(`${talent.name}: ${wanted.size - found.size} not found`);
          const items = [...found].map(([id, url]) => ({ id, url }));
          for (let start = 0; start < items.length; start += 6) {
            const result = (await send({ photos: items.slice(start, start + 6) })).result;
            state.photos += result.imported + result.duplicate;
            state.failed += result.failed;
          }
        }
        await send({ finish: talent.wff_id, name: talent.name });
        state.sent += 1;
      } catch (error) { state.errors.push(`${talent.name}: ${error.message}`); }
      state.read += 1;
    }
    state.phase = "done";
  }

  (async () => {
    if (!window.opener) throw new Error("Open this window from Dashboard → CDS Import");
    if (window.__cdsMode === "photos") return copyPhotos();
    // window.__cdsOnly = ["138421"] limits a run to chosen talents (pilot).
    const ids = Array.isArray(window.__cdsOnly) ? window.__cdsOnly : await talentIds();
    state.listed = ids.length;
    state.phase = "reading";
    for (const id of ids) {
      try {
        const talent = await readTalent(id);
        const ack = await send({ wff: [talent] });
        state.sent += 1;
        if (ack.unmatched?.length) state.unmatched.push(...ack.unmatched);
      } catch (error) { state.errors.push(`${id}: ${error.message}`); }
      state.read += 1;
    }
    state.phase = "done";
  })().catch((error) => { state.phase = "failed"; state.errors.push(String(error?.message || error)); });
  return "started";
})();
