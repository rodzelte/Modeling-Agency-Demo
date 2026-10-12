// Reads every talent listed in CDS (go.cdsglobal.com/Talent.aspx) and hands the
// General-tab identity fields to the 42 dashboard window that opened this one
// (Dashboard → CDS Import → "1. Open CDS"). Run it in that CDS window's console
// with the board filter set to "* ALL ACTIVE *". It runs in the background; read
// window.__cdsImport for progress.
//
// Read-only: it only GETs ModelEdit.aspx pages, and it reads only the fields
// below. Banking, Legal, Medical, passwords, notes and documents are never read.
(() => {
  const DASHBOARD = "https://42-model-management-kappa.vercel.app";
  const state = (window.__cdsImport = { phase: "starting", listed: 0, read: 0, sent: 0, errors: [] });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const toDate = (value) => {
    const m = (value || "").match(/^([A-Za-z]{3})\/(\d{1,2})\/(\d{4})$/);
    return m && MONTHS[m[1]] ? `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}` : null;
  };

  // postMessage to the dashboard, resolved when it confirms the batch was saved.
  const send = (payload) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("message", onAck); reject(new Error("The dashboard did not answer")); }, 120000);
    function onAck(event) {
      if (event.origin !== DASHBOARD || event.data?.type !== "cds-import/ack" || event.data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onAck);
      if (event.data.ok) resolve(event.data); else reject(new Error(event.data.error || "Not saved"));
    }
    window.addEventListener("message", onAck);
    window.opener.postMessage({ type: "cds-import/batch", requestId, payload }, DASHBOARD);
  });

  async function talentIds() {
    const grid = window.TalentGrid;
    const pageDone = () => new Promise((resolve) => { const done = () => { grid.EndCallback.RemoveHandler(done); resolve(); }; grid.EndCallback.AddHandler(done); });
    const ids = [];
    for (let page = 0; page < grid.GetPageCount(); page += 1) {
      if (grid.GetPageIndex() !== page) { const loaded = pageDone(); grid.GotoPage(page); await loaded; }
      const top = grid.GetTopVisibleIndex();
      for (let row = 0; row < grid.GetVisibleRowsOnPage(); row += 1) ids.push(String(grid.GetRowKey(top + row)));
    }
    return [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  }

  async function readTalent(id) {
    const html = await fetch(`/ModelEdit.aspx?ID=${id}&dt=0`, { credentials: "include" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const field = (name) => (doc.getElementById(`ASPxPageControl1_ASPxCallbackPanelGeneralTab_${name}_I`)?.value || "").trim() || null;
    return {
      cds_id: id,
      first_name: field("ASPxTextBoxName") ?? "",
      last_name: field("ASPxTextBoxLastName") ?? "",
      email: field("ASPxCallbackPanelDummy_ASPxTextBoxDummy"),
      phone: field("ASPxTextBoxMobile") ?? field("ASPxTextBoxPhone"),
      gender: field("ASPxComboBoxGender"),
      location: field("ASPxComboBoxLocation"),
      profile: {
        date_of_birth: toDate(field("ASPxDateEditDoB")),
        date_joined: toDate(field("ASPxDateEditDateJoined")),
        birth_place: field("ASPxTextBoxBirthPlace"),
        nationality: field("ASPxTextBoxNationality"),
        website: field("ASPxTextBoxWebsite"),
      },
    };
  }

  (async () => {
    if (!window.opener) throw new Error("Open this window from Dashboard → CDS Import");
    const ids = await talentIds();
    state.listed = ids.length;
    state.phase = "reading";
    let batch = [];
    for (const id of ids) {
      try { batch.push(await readTalent(id)); } catch (error) { state.errors.push(`${id}: ${error.message}`); }
      state.read += 1;
      if (batch.length === 20) { await send({ talents: batch }); state.sent += batch.length; batch = []; }
      await sleep(250);
    }
    if (batch.length) { await send({ talents: batch }); state.sent += batch.length; }
    state.phase = "done";
  })().catch((error) => { state.phase = "failed"; state.errors.push(String(error?.message || error)); });
  return "started";
})();
