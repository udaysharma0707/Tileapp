// Configuration — set this to your deployed Apps Script web app URL
const ENDPOINT = "https://script.google.com/macros/s/AKfycbyz61XscD2cYXa3ATJmN9O934tEAKsE-akbQlHiczqgZPe2AO5gEQuHyFYXvppHNCtUyw/exec";
const SHARED_TOKEN = "shopSecret2025";
const JSONP_TIMEOUT_MS = 20000;
const activeSubmissions = new Set();

// ---------- small helpers (unchanged semantics) ----------
function updateStatus(){
  const s = document.getElementById('status');
  const s2 = document.getElementById('status-duplicate');
  const offlineNotice = document.getElementById('offlineNotice');
  const on = navigator.onLine;
  if (s) s.textContent = on ? 'online' : 'offline';
  if (s2) s2.textContent = on ? 'online' : 'offline';
  const msg = document.getElementById('msg');
  const submitBtn = document.getElementById('submitBtn');
  if (!offlineNotice) return;
  if (!on) {
    offlineNotice.style.display = 'block';
    if (msg) { msg.style.display = 'none'; }
    try { if (submitBtn) submitBtn.disabled = true; } catch(e){}
  } else {
    offlineNotice.style.display = 'none';
    try { if (submitBtn) submitBtn.disabled = false; } catch(e){}
  }
}
window.addEventListener('online', ()=>{ updateStatus(); });
window.addEventListener('offline', ()=>{ updateStatus(); });

function jsonpRequest(url, timeoutMs) {
  timeoutMs = timeoutMs || JSONP_TIMEOUT_MS;
  return new Promise(function(resolve, reject) {
    var cbName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random()*100000);
    window[cbName] = function(data) {
      try { resolve(data); } finally {
        try { delete window[cbName]; } catch(e){}
        var s = document.getElementById(cbName);
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }
    };
    url = url.replace(/(&|\?)?callback=[^&]*/i, "");
    var full = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + encodeURIComponent(cbName);
    var script = document.createElement('script');
    script.id = cbName;
    script.src = full;
    script.async = true;
    script.onerror = function() {
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('JSONP script load error'));
    };
    var timer = setTimeout(function(){
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('JSONP timeout'));
    }, timeoutMs);
    document.body.appendChild(script);
  });
}

// wrapper to call your spreadsheet webapp for form submissions
function sendToServerJSONP(formData, clientTs, opts) {
  var params = [];
  function add(k,v){ if (v === undefined || v === null) v=""; params.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v))); }
  add("token", SHARED_TOKEN);

  add("purchasedItem", formData.purchasedItem || "");
  add("purchasedFrom", formData.purchasedFrom || "");
  add("modeOfPayment", formData.modeOfPayment || "");
  // extra breakdown for comment/note
  add("modeBreakdown", formData.modeBreakdown || "");
  add("paymentPaid", formData.paymentPaid === undefined ? "" : String(formData.paymentPaid));
  add("otherInfo", formData.otherInfo || "");
  if (formData.submissionId) { add("submissionId", formData.submissionId); add("clientId", formData.submissionId); }
  if (clientTs) add("clientTs", String(clientTs));

  var base = ENDPOINT;
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + params.join("&");
  if (url.length > 1900) return Promise.reject(new Error("Payload too large for JSONP"));
  return jsonpRequest(url, JSONP_TIMEOUT_MS);
}

/* ---------- Config persistence helpers (get/save config on server) ---------- */

/**
 * loadConfigFromServer()
 * Calls ENDPOINT?action=getConfig&token=... and expects response { success:true, config: <object> }
 * If no server or failure, resolves to null.
 */
function loadConfigFromServer(timeoutMs) {
  const base = ENDPOINT;
  const url = base + (base.indexOf('?') === -1 ? '?' : '&') + "action=getConfig" + "&token=" + encodeURIComponent(SHARED_TOKEN);
  return jsonpRequest(url, timeoutMs || JSONP_TIMEOUT_MS).then(resp => {
    if (!resp) return null;
    if (resp.success && resp.config) {
      try {
        return typeof resp.config === 'object' ? resp.config : JSON.parse(resp.config);
      } catch(e) {
        return null;
      }
    }
    return null;
  }).catch(e=>{ console.warn('loadConfigFromServer err', e); return null; });
}

/**
 * saveConfigToServer(cfg)
 * Calls ENDPOINT?action=saveConfig&token=...&config=<encoded JSON>
 * Returns a Promise that resolves to server response or rejects on error.
 */
function saveConfigToServer(cfg) {
  try {
    const cfgStr = JSON.stringify(cfg);
    const base = ENDPOINT;
    const params = "action=saveConfig&token=" + encodeURIComponent(SHARED_TOKEN) + "&config=" + encodeURIComponent(cfgStr);
    const url = base + (base.indexOf('?') === -1 ? '?' : '&') + params;
    return jsonpRequest(url, JSONP_TIMEOUT_MS).then(resp => {
      return resp;
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

// expose saveConfigToServer globally so index.html's modal can call it
window.saveConfigToServer = saveConfigToServer;

/* ---------- UI renderFromConfig: apply the config to the existing DOM (best-effort) ---------- */
/*
  The function updates:
    - #appTitle text
    - label texts for purchasedWhat, purchasedFrom, modeOfPayment, paymentPaid, otherInfo
    - For each configured purchased item, attempts to find element with id 'p_<id>' and update label and visibility.
    - For each subitem attempts to find 'sub_<subid>' checkbox and updates label and visibility.
  If the config contains items not present in DOM, they are ignored (you can extend this to dynamically create nodes).
*/
function setLabelTextForCheckbox(checkboxEl, text) {
  if (!checkboxEl) return;
  // find closest label
  const labelEl = checkboxEl.closest('label');
  if (!labelEl) return;
  // remove all nodes except the input element
  const input = checkboxEl;
  // detach children and re-append input and text
  while (labelEl.firstChild) labelEl.removeChild(labelEl.firstChild);
  labelEl.appendChild(input);
  labelEl.appendChild(document.createTextNode(' ' + text));
}

function renderFromConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  window.__ACTIVE_CONFIG__ = cfg;

  // update title & labels
  try {
    if (cfg.title) {
      const t = document.getElementById('appTitle');
      if (t) t.textContent = cfg.title;
      document.title = cfg.title || document.title;
    }
    if (cfg.labels) {
      if (cfg.labels.purchasedWhat) {
        const e = document.getElementById('labelPurchasedWhat'); if (e) e.textContent = cfg.labels.purchasedWhat;
      }
      if (cfg.labels.purchasedFrom) {
        const e = document.getElementById('labelPurchasedFrom'); if (e) e.textContent = cfg.labels.purchasedFrom;
      }
      if (cfg.labels.modeOfPayment) {
        const e = document.getElementById('labelModeOfPayment'); if (e) e.textContent = cfg.labels.modeOfPayment;
      }
      if (cfg.labels.paymentPaid) {
        const e = document.getElementById('labelPaymentPaid'); if (e) e.textContent = cfg.labels.paymentPaid;
      }
      if (cfg.labels.otherInfo) {
        const e = document.getElementById('labelOtherInfo'); if (e) e.textContent = cfg.labels.otherInfo;
      }
    }
  } catch (e) { console.warn('renderFromConfig label update err', e); }

  // purchased mapping: for each item in config try to map to DOM
  if (Array.isArray(cfg.purchased)) {
    cfg.purchased.forEach(item => {
      try {
        const mainId = 'p_' + item.id;
        const mainCb = document.getElementById(mainId);
        if (mainCb) {
          // label and enable/disable visibility
          if (item.name) setLabelTextForCheckbox(mainCb, item.name);
          const row = mainCb.closest('.item-row');
          if (row) row.style.display = item.enabled === false ? 'none' : 'flex';
        }
        // subitems
        if (Array.isArray(item.subitems)) {
          item.subitems.forEach(sub => {
            try {
              const subId = 'sub_' + sub.id; // config sub.id should be like floor_vitrified -> sub_floor_vitrified in DOM
              const subCb = document.getElementById(subId);
              if (subCb) {
                if (sub.name) setLabelTextForCheckbox(subCb, sub.name);
                const subRow = subCb.closest('.sub-item');
                if (subRow) subRow.style.display = sub.enabled === false ? 'none' : 'flex';
              }
            } catch(e){ /* ignore sub errors */ }
          });
        }
        // handle standalone Others: label is purchasedOtherText placeholder and main label
        if (item.id === 'other' && item.name) {
          const mainOthers = document.getElementById('p_other');
          if (mainOthers) setLabelTextForCheckbox(mainOthers, item.name);
          const otherText = document.getElementById('purchasedOtherText');
          if (otherText) otherText.placeholder = "If " + (item.name || 'Others') + " — specify (e.g. 'Grout, Adhesive')";
        }
      } catch(e){ /* ignore individual item failures */ }
    });
  }

  // modes
  if (Array.isArray(cfg.modes)) {
    // iterate configured modes and update the label text for matching DOM inputs (mode_cash, mode_online, mode_credit)
    cfg.modes.forEach(m => {
      try {
        const id = 'mode_' + (m.id || '').toString().toLowerCase();
        const el = document.getElementById(id);
        if (el) {
          // update label text by manipulating closest label
          if (m.name) setLabelTextForCheckbox(el, m.name);
          const container = el.closest('.mode-row');
          if (container) container.style.display = m.enabled === false ? 'none' : 'flex';
        }
      } catch(e){}
    });
  }

  // dispatch an event so other parts of app can react if they need to
  window.dispatchEvent(new CustomEvent('configRendered', { detail: cfg }));
}
// expose globally
window.renderFromConfig = renderFromConfig;

/* ---------- Collect form data (updated, robust) ---------- */
function collectFormData(){
  const selectedParts = [];

  function pushIfSub(checkboxId, qtyId, labelOverride) {
    const cb = document.getElementById(checkboxId);
    if (!cb || !cb.checked) return;
    const qtyEl = document.getElementById(qtyId);
    const qtyVal = qtyEl ? (String(qtyEl.value || "").trim()) : "";
    const label = labelOverride || cb.value || "";
    if (qtyVal !== "") {
      selectedParts.push(qtyVal + " " + label);
    } else {
      selectedParts.push(label);
    }
  }

  // floor
  if (document.getElementById('p_floor') && document.getElementById('p_floor').checked) {
    pushIfSub('sub_floor_vitrified','q_floor_vitrified','Vitrified tiles');
    pushIfSub('sub_floor_ceramic','q_floor_ceramic','Ceramic tiles');
    pushIfSub('sub_floor_porcelain','q_floor_porcelain','Porcelain tiles');
    pushIfSub('sub_floor_marble','q_floor_marble','Marble finish tiles');
    pushIfSub('sub_floor_granite','q_floor_granite','Granite finish tiles');
  }
  // wall
  if (document.getElementById('p_wall') && document.getElementById('p_wall').checked) {
    pushIfSub('sub_wall_kitchen','q_wall_kitchen','Kitchen wall tiles (backsplash)');
    pushIfSub('sub_wall_bath','q_wall_bath','Bathroom wall tiles (glazed/anti-skid)');
    pushIfSub('sub_wall_decor','q_wall_decor','Decorative / designer wall tiles');
  }
  // sanitary
  if (document.getElementById('p_san') && document.getElementById('p_san').checked) {
    pushIfSub('sub_san_wash','q_san_wash','Washbasins');
    pushIfSub('sub_san_wc','q_san_wc','WC');
    pushIfSub('sub_san_urinal','q_san_urinal','Urinals');
  }
  // accessories
  if (document.getElementById('p_acc') && document.getElementById('p_acc').checked) {
    pushIfSub('sub_acc_grout','q_acc_grout','Tile grout & adhesives');
    pushIfSub('sub_acc_spacers','q_acc_spacers','Spacers');
    pushIfSub('sub_acc_sealants','q_acc_sealants','Sealants');
    pushIfSub('sub_acc_chem','q_acc_chem','Chemicals');
    pushIfSub('sub_acc_skirting','q_acc_skirting','Skirting & border tiles');
    pushIfSub('sub_acc_mosaic','q_acc_mosaic','Mosaic tiles for decoration');
  }
  // others main
  if (document.getElementById('p_other') && document.getElementById('p_other').checked) {
    const otherTxt = (document.getElementById('purchasedOtherText') || {}).value || "";
    const otherQty = (document.getElementById('q_other') || {}).value || "";
    const label = otherTxt.trim() !== "" ? otherTxt.trim() : "Others";
    if (otherQty !== "") selectedParts.push(otherQty + " " + label);
    else selectedParts.push(label);
  }

  // --------- MODE handling (dedupe + canonicalize) ----------
  const rawModeEls = Array.from(document.querySelectorAll('input[name="modeOfPayment"]'));
  const rawSelected = rawModeEls.filter(m=>m.checked).map(m=> (m.value || "").toString().trim() ).filter(x=>x!=="");

  function canonicalLabel(v){
    if(!v) return v;
    const s = v.toString().toLowerCase();
    if (s.indexOf('cash') !== -1) return 'Cash';
    if (s.indexOf('online') !== -1) return 'Online';
    if (s.indexOf('credit') !== -1) return 'Credit';
    return v.trim();
  }

  const preferred = ['Cash','Online','Credit'];
  const present = new Set();
  const orderedModes = [];
  const rawLower = rawSelected.map(s=>s.toLowerCase());
  preferred.forEach(pref => {
    if (rawLower.some(r => r.indexOf(pref.toLowerCase()) !== -1)) {
      orderedModes.push(pref);
      present.add(pref);
    }
  });
  rawSelected.forEach(r => {
    const can = canonicalLabel(r);
    if (!present.has(can)) { orderedModes.push(can); present.add(can); }
  });

  const modeStr = orderedModes.join(', ');

  // --------- modeBreakdown: read amount inputs if present ----------
  const breakdownParts = [];
  try {
    const amtCashEl = document.getElementById('amt_cash');
    const amtOnlineEl = document.getElementById('amt_online');
    const amtCreditEl = document.getElementById('amt_credit');
    if (document.getElementById('mode_cash') && document.getElementById('mode_cash').checked) {
      const v = amtCashEl && amtCashEl.value ? Number(amtCashEl.value) : 0;
      breakdownParts.push('Cash Rs.' + (v || 0));
    }
    if (document.getElementById('mode_online') && document.getElementById('mode_online').checked) {
      const v = amtOnlineEl && amtOnlineEl.value ? Number(amtOnlineEl.value) : 0;
      breakdownParts.push('Online Rs.' + (v || 0));
    }
    if (document.getElementById('mode_credit') && document.getElementById('mode_credit').checked) {
      const v = amtCreditEl && amtCreditEl.value ? Number(amtCreditEl.value) : 0;
      breakdownParts.push('Credit Rs.' + (v || 0));
    }
    if (breakdownParts.length === 0) {
      const amtEls = Array.from(document.querySelectorAll('input[data-mode-amount]'));
      amtEls.forEach(el => {
        const modeName = el.getAttribute('data-mode-amount') || '';
        const val = el.value ? Number(el.value) : 0;
        if (modeName && val) breakdownParts.push(modeName + ' Rs.' + val);
      });
    }
  } catch (e) { /* ignore */ }

  const modeBreakdown = breakdownParts.join(', ');

  return {
    purchasedItem: selectedParts.join(", "),
    purchasedFrom: document.getElementById('purchasedFrom').value.trim(),
    modeOfPayment: modeStr,
    modeBreakdown: modeBreakdown,
    paymentPaid: document.getElementById('paymentPaid').value,
    otherInfo: document.getElementById('otherInfo').value.trim()
  };
}

/* ---------- UI helpers: show/hide sublists + enable qtys + payment mode behaviours ---------- */

function setupPurchasedUIBindings() {
  const mainToSub = {
    'p_floor': 'sublist_floor',
    'p_wall': 'sublist_wall',
    'p_san':  'sublist_san',
    'p_acc':  'sublist_acc'
  };
  Object.keys(mainToSub).forEach(mainId => {
    const mainCb = document.getElementById(mainId);
    const subDiv = document.getElementById(mainToSub[mainId]);
    if (!mainCb || !subDiv) return;
    function update() {
      subDiv.style.display = mainCb.checked ? 'block' : 'none';
      if (!mainCb.checked) {
        subDiv.querySelectorAll('.subitem').forEach(sb => { sb.checked = false; });
        subDiv.querySelectorAll('.subqty').forEach(q => { q.value=''; q.disabled = true; });
      }
    }
    mainCb.addEventListener('change', update);
    update();
  });

  // generic subitem checkbox -> enable its qty input
  document.querySelectorAll('.subitem').forEach(function(subCb) {
    const id = subCb.id; // e.g. sub_floor_ceramic
    const qtyId = 'q' + id.slice(3); // 'q_floor_ceramic'
    const qtyEl = document.getElementById(qtyId);
    subCb.addEventListener('change', function() {
      if (qtyEl) {
        qtyEl.disabled = !subCb.checked;
        if (!subCb.checked) qtyEl.value = '';
      }
    });
    if (qtyEl) qtyEl.disabled = !subCb.checked;
  });

  // Others main checkbox -> enable its qty and optionally focus the other-text
  const otherMain = document.getElementById('p_other');
  const otherQty = document.getElementById('q_other');
  if (otherMain && otherQty) {
    function updOther() {
      otherQty.disabled = !otherMain.checked;
      if (!otherMain.checked) otherQty.value = '';
    }
    otherMain.addEventListener('change', updOther);
    updOther();
  }
}

function setupPaymentUIBindings() {
  const modeCash = document.getElementById('mode_cash');
  const modeOnline = document.getElementById('mode_online');
  const modeCredit = document.getElementById('mode_credit');
  const amtCash = document.getElementById('amt_cash');
  const amtOnline = document.getElementById('amt_online');
  const amtCredit = document.getElementById('amt_credit');
  const totalInput = document.getElementById('paymentPaid');
  const otherInfo = document.getElementById('otherInfo');

  let manualTotalOverride = false;

  function recomputeTotalFromParts() {
    if (manualTotalOverride) return;
    const v1 = parseFloat(amtCash && amtCash.value ? amtCash.value : 0) || 0;
    const v2 = parseFloat(amtOnline && amtOnline.value ? amtOnline.value : 0) || 0;
    const v3 = parseFloat(amtCredit && amtCredit.value ? amtCredit.value : 0) || 0;
    const sum = (v1 + v2 + v3);
    totalInput.value = sum ? (Math.round(sum * 100) / 100) : '';
  }

  function updateModeEnabled(cb, amtEl) {
    if (!cb || !amtEl) return;
    amtEl.disabled = !cb.checked;
    if (!cb.checked) amtEl.value = '';
    amtEl.removeEventListener('input', amtEl._recomputeListener);
    amtEl._recomputeListener = function() {
      manualTotalOverride = false;
      recomputeTotalFromParts();
    };
    amtEl.addEventListener('input', amtEl._recomputeListener, { passive: true });
  }

  [modeCash, modeOnline, modeCredit].forEach((cb, idx) => {
    const amtEl = (idx === 0 ? amtCash : (idx === 1 ? amtOnline : amtCredit));
    if (!cb) return;
    cb.addEventListener('change', function() {
      updateModeEnabled(cb, amtEl);
      manualTotalOverride = false;
      recomputeTotalFromParts();
      writeCombinedModeValue();
    });
    updateModeEnabled(cb, amtEl);
  });

  if (totalInput) {
    totalInput.addEventListener('input', function() {
      manualTotalOverride = true;
    }, { passive:true });
  }

  function writeCombinedModeValue() {
    const selected = [];
    if (modeCash && modeCash.checked) selected.push((modeCash.value || 'Cash').toString().trim());
    if (modeOnline && modeOnline.checked) selected.push((modeOnline.value || 'Online').toString().trim());
    if (modeCredit && modeCredit.checked) selected.push((modeCredit.value || 'Credit').toString().trim());
    const combined = selected.join(', ');
    // reset values to defaults first
    if (modeCash) modeCash.value = 'Cash';
    if (modeOnline) modeOnline.value = 'Online';
    if (modeCredit) modeCredit.value = 'Credit';
    if (selected.length === 0) return;
    const firstChecked = document.querySelector('input[name="modeOfPayment"]:checked');
    if (firstChecked) firstChecked.value = combined;
  }

  function buildPaymentBreakdownString() {
    const parts = [];
    if (modeCash && modeCash.checked) {
      const v = (amtCash && amtCash.value && amtCash.value.toString().trim() !== '') ? Number(amtCash.value) : 0;
      parts.push('Cash Rs.' + (v || 0));
    }
    if (modeOnline && modeOnline.checked) {
      const v = (amtOnline && amtOnline.value && amtOnline.value.toString().trim() !== '') ? Number(amtOnline.value) : 0;
      parts.push('Online Rs.' + (v || 0));
    }
    if (modeCredit && modeCredit.checked) {
      const v = (amtCredit && amtCredit.value && amtCredit.value.toString().trim() !== '') ? Number(amtCredit.value) : 0;
      parts.push('Credit Rs.' + (v || 0));
    }
    return parts.join(', ');
  }

  // expose helper for pre-submit
  window.__recomputeTotalFromParts = recomputeTotalFromParts;
  window.__writeCombinedModeValue = writeCombinedModeValue;
  window.__buildPaymentBreakdownString = buildPaymentBreakdownString;

  // initial write
  writeCombinedModeValue();
}

/* ---------- show message, clear form, make id (same semantics) ---------- */
function showMessage(text){
  var m = document.getElementById('msg');
  if (!m) { console.log('[UI]', text); return; }
  m.textContent = text; m.style.display='block';
  setTimeout(()=>{ if (m && navigator.onLine) m.style.display='none'; }, 4000);
}
function clearForm(){
  try {
    document.querySelectorAll('.purchased').forEach(ch => { ch.checked = false; });
    document.querySelectorAll('.subitem').forEach(ch => { ch.checked = false; });
    document.querySelectorAll('.qty').forEach(q => { q.value = ''; q.disabled = true; });
    document.querySelectorAll('.sublist').forEach(s => s.style.display = 'none');
    const otherEl = document.getElementById('purchasedOtherText'); if (otherEl) otherEl.value = '';
    document.getElementById('purchasedFrom').value = '';
    document.querySelectorAll('input[name="modeOfPayment"]').forEach(el=>{ el.checked=false; });
    ['amt_cash','amt_online','amt_credit'].forEach(id=>{
      const e = document.getElementById(id);
      if (e) { e.value=''; e.disabled = true; }
    });
    document.getElementById('paymentPaid').value = '';
    document.getElementById('otherInfo').value = '';
  } catch(e){ console.warn('clearForm error', e); }
}
function makeSubmissionId() { return "s_" + Date.now() + "_" + Math.floor(Math.random()*1000000); }

// Expose submitForm for inline calls
window.submitForm = async function() {
  const btn = document.getElementById('submitBtn');
  if (btn) btn.click();
  else await doSubmitFlow();
};

/* ---------- DOMContentLoaded: initialize UI, load config, wire submit ---------- */
document.addEventListener('DOMContentLoaded', function() {
  updateStatus();

  // Try to load config from server; if found render; otherwise rely on existing DOM.
  loadConfigFromServer().then(cfg => {
    if (cfg) {
      try { renderFromConfig(cfg); } catch(e) { console.warn('renderFromConfig failed on load', e); }
    }
  }).catch(()=>{ /* ignore load errors */ });

  // listen for modal preview/save events (index.html dispatches these)
  window.addEventListener('configApplied', function(ev){
    try { renderFromConfig(ev && ev.detail ? ev.detail : null); }
    catch(e){ console.warn('configApplied handler err', e); }
  });
  window.addEventListener('configSaved', function(ev){
    try { renderFromConfig(ev && ev.detail ? ev.detail : null); }
    catch(e){ console.warn('configSaved handler err', e); }
  });
  window.addEventListener('configSavedLocal', function(ev){
    try { renderFromConfig(ev && ev.detail ? ev.detail : null); }
    catch(e){ console.warn('configSavedLocal handler err', e); }
  });

  // wire UI behaviour (purchased lists and payment modes)
  setupPurchasedUIBindings();
  setupPaymentUIBindings();

  const submitBtn = document.getElementById('submitBtn');
  const clearBtn = document.getElementById('clearBtn');
  if (submitBtn && !navigator.onLine) try { submitBtn.disabled = true; } catch(e){}

  if (!submitBtn) { console.warn('[INIT] submitBtn not found in DOM'); return; }
  try { submitBtn.setAttribute('type','button'); } catch(e){}

  let ignoreNextClick = false;

  function validateMainSubSelection() {
    const errors = [];
    if (document.getElementById('p_floor') && document.getElementById('p_floor').checked) {
      const any = Array.from(document.querySelectorAll('#sublist_floor .subitem')).some(s=>s.checked);
      if (!any) errors.push('Floor Tiles: select at least one sub-item and enter quantity.');
    }
    if (document.getElementById('p_wall') && document.getElementById('p_wall').checked) {
      const any = Array.from(document.querySelectorAll('#sublist_wall .subitem')).some(s=>s.checked);
      if (!any) errors.push('Wall Tiles: select at least one sub-item and enter quantity.');
    }
    if (document.getElementById('p_san') && document.getElementById('p_san').checked) {
      const any = Array.from(document.querySelectorAll('#sublist_san .subitem')).some(s=>s.checked);
      if (!any) errors.push('Sanitaryware: select at least one sub-item and enter quantity.');
    }
    if (document.getElementById('p_acc') && document.getElementById('p_acc').checked) {
      const any = Array.from(document.querySelectorAll('#sublist_acc .subitem')).some(s=>s.checked);
      if (!any) errors.push('Accessories: select at least one sub-item and enter quantity.');
    }
    if (document.getElementById('p_other') && document.getElementById('p_other').checked) {
      const q = (document.getElementById('q_other') || {}).value || "";
      const txt = (document.getElementById('purchasedOtherText') || {}).value || "";
      if (!q && txt.trim() === "") {
        errors.push('Others: please specify the item name and quantity (or uncheck Others).');
      }
    }
    return errors;
  }

  async function doSubmitFlow() {
    try {
      if (!navigator.onLine) { alert('Connect to internet. Your entry cannot be saved while offline.'); updateStatus(); return; }

      const anyMainChecked = Array.from(document.querySelectorAll('.purchased')).some(cb => cb.checked);
      if (!anyMainChecked) { alert('Please select at least one purchased main category.'); return; }

      const validationList = validateMainSubSelection();
      if (validationList.length > 0) { alert(validationList.join('\n')); return; }

      // verify selected subitems have qty > 0
      const selectedSubboxes = Array.from(document.querySelectorAll('.subitem')).filter(s => s.checked);
      for (let sb of selectedSubboxes) {
        const qid = 'q' + sb.id.slice(3);
        const qEl = document.getElementById(qid);
        const val = qEl ? (String(qEl.value || "").trim()) : "";
        if (!val || isNaN(Number(val)) || Number(val) <= 0) {
          alert('Please enter a valid quantity (>0) for: ' + (sb.value || 'selected item'));
          return;
        }
      }

      if (document.getElementById('p_other') && document.getElementById('p_other').checked) {
        const q = (document.getElementById('q_other') || {}).value || "";
        if (!q || isNaN(Number(q)) || Number(q) <= 0) {
          alert('Please enter a valid quantity (>0) for Others or uncheck Others.');
          return;
        }
      }

      // payment validation: at least one mode checked and total valid
      const payment = (document.getElementById('paymentPaid') || {}).value || "";
      const anyModeChecked = Array.from(document.querySelectorAll('input[name="modeOfPayment"]')).some(m=>m.checked);
      if (!anyModeChecked) { alert('Please select a mode of payment.'); return; }
      if (!payment || isNaN(Number(payment)) ) { alert('Please enter a valid payment amount.'); return; }

      // before collecting, ensure combined mode value & total recompute if needed
      try { if (typeof window.__recomputeTotalFromParts === 'function') window.__recomputeTotalFromParts(); } catch(e){}
      try { if (typeof window.__writeCombinedModeValue === 'function') window.__writeCombinedModeValue(); } catch(e){}
      // also ensure breakdown in otherInfo if blank
      try {
        const otherInfo = document.getElementById('otherInfo');
        if (otherInfo && (!otherInfo.value || otherInfo.value.trim() === '') && typeof window.__buildPaymentBreakdownString === 'function') {
          otherInfo.value = window.__buildPaymentBreakdownString();
        }
      } catch(e){}

      var formData = collectFormData();
      if (!formData.purchasedItem || formData.purchasedItem.trim() === "") {
        alert('No sub-item selected. Please select at least one specific item and quantity.');
        return;
      }

      if (!formData.submissionId) formData.submissionId = makeSubmissionId();
      if (activeSubmissions.has(formData.submissionId)) { showMessage('Submission in progress — please wait'); return; }
      activeSubmissions.add(formData.submissionId);

      submitBtn.disabled = true;
      const origLabel = submitBtn.textContent;
      submitBtn.textContent = 'Saving...';
      showMessage('Submitting — please wait...');
      clearForm();

      (async function(backgroundForm){
        try {
          const clientTs = Date.now();
          const resp = await sendToServerJSONP(backgroundForm, clientTs);
          if (resp && resp.success) {
            showMessage('Saved — Serial: ' + resp.serial);
          } else if (resp && resp.error) {
            alert('Server rejected submission: ' + resp.error);
          } else {
            alert('Unexpected server response. Please retry while online.');
          }
        } catch (errSend) {
          console.error('send failed', errSend);
          alert('Network error occurred. Please ensure you are online and try again.');
        } finally {
          try { activeSubmissions.delete(backgroundForm.submissionId); } catch(e){}
          try { submitBtn.disabled = false; submitBtn.textContent = origLabel || 'Submit'; } catch(e){}
          updateStatus();
        }
      })(formData);

    } catch (ex) {
      console.error('submit handler exception', ex);
      alert('Unexpected error. Try again.');
      submitBtn.disabled = false; submitBtn.textContent = 'Submit';
    }
  }

  function onTouchEndSubmit(ev) { if (!ev) return; ev.preventDefault && ev.preventDefault(); ev.stopPropagation && ev.stopPropagation(); ignoreNextClick = true; setTimeout(()=>{ ignoreNextClick = false; }, 800); doSubmitFlow(); }
  function onClickSubmit(ev) { if (ignoreNextClick) { ev && ev.preventDefault(); return; } doSubmitFlow(); }

  submitBtn.addEventListener('touchend', onTouchEndSubmit, { passive:false });
  submitBtn.addEventListener('click', onClickSubmit, { passive:false });

  if (clearBtn) {
    clearBtn.addEventListener('touchend', function(ev){ ev && ev.preventDefault(); clearForm(); showMessage('Form cleared'); }, { passive:false });
    clearBtn.addEventListener('click', function(ev){ clearForm(); showMessage('Form cleared'); }, { passive:false });
  }

  // unregister service workers & clear caches (best-effort)
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(r => { r.unregister().catch(()=>{}); });
      }).catch(()=>{});
    } catch(e){ console.warn('sw unregister err', e); }
  }
  if ('caches' in window) {
    try { caches.keys().then(keys => { keys.forEach(k => caches.delete(k)); }).catch(()=>{}); } catch(e){ console.warn('cache clear err', e); }
  }

}); // DOMContentLoaded end
