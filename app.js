const ENDPOINT = "https://script.google.com/macros/s/AKfycbwsKGlbmcbrw3cm_jqKyhXJXup1P_mIodLoIXR8ZvmVUEQNSA9yympNYBRulM9r4VOfhA/exec";
const SHARED_TOKEN = "shopSecret2025";
const JSONP_TIMEOUT_MS = 20000;
const activeSubmissions = new Set();


// ---------- helpers ----------
function updateStatus(){ /* same as before - unchanged */
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


// JSONP helper (returns Promise) - reused for form submits and config load/save
function jsonpRequest(url, timeoutMs) {
  timeoutMs = timeoutMs || JSONP_TIMEOUT_MS;
  return new Promise(function(resolve, reject) {
    var cbName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random()*100000);
    var timer = null;
    window[cbName] = function(data) {
      try { resolve(data); } finally {
        // cleanup
        try { delete window[cbName]; } catch(e){}
        var s = document.getElementById(cbName);
        if (s && s.parentNode) s.parentNode.removeChild(s);
        if (timer) clearTimeout(timer);
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
      if (timer) clearTimeout(timer);
      reject(new Error('JSONP script load error'));
    };
    timer = setTimeout(function(){
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('JSONP timeout'));
    }, timeoutMs);
    document.body.appendChild(script);
  });
}

// Build JSONP URL and call (form submit)
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

  // NEW: include structured items JSON so server records edited labels
  try {
    if (formData.items && Array.isArray(formData.items)) {
      add("itemsJSON", JSON.stringify(formData.items));
    }
  } catch (e) {
    // ignore if JSON stringify fails
    console.warn('itemsJSON stringify failed', e);
  }

  var base = ENDPOINT;
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + params.join("&");
  if (url.length > 1900) return Promise.reject(new Error("Payload too large for JSONP"));
  return jsonpRequest(url, JSONP_TIMEOUT_MS);
}

// ---------- Unit Preference Management ----------
function loadUnitPreferences() {
  try {
    const stored = localStorage.getItem('unitPreferences_v1');
    return stored ? JSON.parse(stored) : {};
  } catch(e) {
    console.error('Error loading unit preferences:', e);
    return {};
  }
}

function saveUnitPreferences(preferences) {
  try {
    localStorage.setItem('unitPreferences_v1', JSON.stringify(preferences));
  } catch(e) {
    console.error('Error saving unit preferences:', e);
  }
}

function saveUnitPreference(productId, unitValue) {
  const preferences = loadUnitPreferences();
  preferences[productId] = unitValue;
  saveUnitPreferences(preferences);
}

function loadGlobalUnits() {
  try {
    const stored = localStorage.getItem('globalUnits_v1');
    return stored ? JSON.parse(stored) : [];
  } catch(e) {
    console.error('Error loading global units:', e);
    return [];
  }
}

function saveGlobalUnits(units) {
  try {
    localStorage.setItem('globalUnits_v1', JSON.stringify(units));
  } catch(e) {
    console.error('Error saving global units:', e);
  }
}

// ---------- MAIN: collectFormData (updated to read edited labels and build items array) ----------
function collectFormData(){
  const selectedParts = [];
  const items = []; // structured items: { id, qty, unit, label }

  // track which sub ids we've explicitly pushed (to avoid duplicates when scanning generic subitems)
  const addedSubIds = new Set();

  // helper to fetch the editable label for a checkbox/subitem by id
  function getLabelFor(checkboxId, fallback) {
    try {
      // first try data-config-id pattern: checkboxId + "_label"
      var cfgSel = '[data-config-id="' + checkboxId + '_label"]';
      var el = document.querySelector(cfgSel);
      if (!el) {
        // fallback: element with id "label_" + checkboxId
        el = document.getElementById('label_' + checkboxId);
      }
      if (el && (el.textContent || el.innerText)) {
        return (el.textContent || el.innerText).toString().trim();
      }
    } catch (e) { /* ignore */ }
    return (fallback || "").toString().trim();
  }

  // helper: read unit for a suffix (suffix = checkboxId.slice(4) for sub_* items; 'other' for p_other)
  function getUnitForSuffix(suffix) {
    try {
      if (!suffix) return "";
      const sel = document.getElementById('unit_' + suffix);
      const custom = document.getElementById('unit_custom_' + suffix);
      if (sel) {
        const v = sel.value || '';
        // Check if custom input is visible and has value
        if (custom && custom.style.display !== 'none' && custom.value && custom.value.trim()) {
          return custom.value.trim();
        } else {
          return v || '';
        }
      }
    } catch (e){}
    return "";
  }

  function pushIfSub(checkboxId, qtyId, labelFallback) {
    const cb = document.getElementById(checkboxId);
    if (!cb || !cb.checked) return;
    const qtyEl = document.getElementById(qtyId);
    const qtyVal = qtyEl ? (String(qtyEl.value || "").trim()) : "";
    const label = getLabelFor(checkboxId, labelFallback || cb.value || "");
    // compute suffix for unit id: remove leading 'sub_' => suffix
    const suffix = (checkboxId && checkboxId.indexOf('sub_') === 0) ? checkboxId.slice(4) : (checkboxId || "");
    const unitVal = getUnitForSuffix(suffix);

    // Save unit preference when item is selected
    if (unitVal) {
      const unitSelectId = 'unit_' + suffix;
      saveUnitPreference(unitSelectId, unitVal);
    }

    if (qtyVal !== "") {
      if (unitVal) selectedParts.push(qtyVal + " " + unitVal + " " + label);
      else selectedParts.push(qtyVal + " " + label);
    } else {
      if (unitVal) selectedParts.push(unitVal + " " + label);
      else selectedParts.push(label);
    }
    // add structured item (include unit)
    items.push({ id: checkboxId, qty: qtyVal || "", unit: unitVal || "", label: label });
    addedSubIds.add(checkboxId);
  }

  // floor (hard-coded ones kept for backward-compatibility)
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
    // for Others label, prefer the editable label for the main 'p_other' if present
    const mainOtherLabel = getLabelFor('p_other', 'Others');
    const label = otherTxt.trim() !== "" ? otherTxt.trim() : mainOtherLabel;
    const unitOther = getUnitForSuffix('other');
    
    // Save unit preference for Others
    if (unitOther) {
      saveUnitPreference('unit_other', unitOther);
    }
    
    if (otherQty !== "") {
      if (unitOther) selectedParts.push(otherQty + " " + unitOther + " " + label);
      else selectedParts.push(otherQty + " " + label);
    } else {
      if (unitOther) selectedParts.push(unitOther + " " + label);
      else selectedParts.push(label);
    }
    items.push({ id: 'p_other', qty: otherQty || "", unit: unitOther || "", label: label });
    addedSubIds.add('p_other');
  }

  // ----- NEW: generic scan for any dynamic .subitem elements not covered above -----
  try {
    const allSubitems = Array.from(document.querySelectorAll('.subitem'));
    allSubitems.forEach(function(cb) {
      if (!cb || !cb.id) return;
      if (addedSubIds.has(cb.id)) return; // already processed
      if (!cb.checked) return;
      // qty id uses same convention: 'q' + checkboxId.slice(3)
      const qtyId = 'q' + cb.id.slice(3);
      const qtyEl = document.getElementById(qtyId);
      const qtyVal = qtyEl ? (String(qtyEl.value || "").trim()) : "";
      const label = getLabelFor(cb.id, cb.value || "");
      const suffix = (cb.id && cb.id.indexOf('sub_') === 0) ? cb.id.slice(4) : (cb.id || "");
      const unitVal = getUnitForSuffix(suffix);
      
      // Save unit preference
      if (unitVal) {
        const unitSelectId = 'unit_' + suffix;
        saveUnitPreference(unitSelectId, unitVal);
      }
      
      if (qtyVal !== "") {
        if (unitVal) selectedParts.push(qtyVal + " " + unitVal + " " + label);
        else selectedParts.push(qtyVal + " " + label);
      } else {
        if (unitVal) selectedParts.push(unitVal + " " + label);
        else selectedParts.push(label);
      }
      items.push({ id: cb.id, qty: qtyVal || "", unit: unitVal || "", label: label });
      addedSubIds.add(cb.id);
    });
  } catch (e) {
    console.warn('generic subitem scan failed', e);
  }

  // --------- MODE handling (dedupe + canonicalize) ----------
  // Build an array of mode objects (checkbox element, display label, amount if present)
  const rawModeEls = Array.from(document.querySelectorAll('input[name="modeOfPayment"]'));
  const modeObjs = rawModeEls.map(function(cb) {
    const id = cb.id || '';
    // prefer editable label span text if present
    const displayLabel = getLabelFor(id, cb.value || '');
    // amount input: try id 'amt_'+id, else first .mode-amount within same .mode-row, else input[data-mode-amount] with matching id
    let amtInput = null;
    if (id) amtInput = document.getElementById('amt_' + id);
    if (!amtInput) {
      const parent = cb.closest ? cb.closest('.mode-row') : null;
      if (parent) amtInput = parent.querySelector('input.mode-amount');
    }
    if (!amtInput) {
      // fallback: find any input with data-mode-amount that has attribute matching label (rare)
      amtInput = document.querySelector('input[data-mode-amount][id="amt_' + id + '"]') || null;
    }
    const amtVal = amtInput && amtInput.value ? Number(amtInput.value) : 0;
    return { el: cb, id: id, label: (displayLabel || '').toString().trim(), amountInput: amtInput, amount: amtVal };
  });

  const rawSelected = modeObjs.filter(m => m.el && m.el.checked).map(m => m.label).filter(Boolean);

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

  // --------- modeBreakdown: amounts ----------
  const breakdownParts = [];
  try {
    // Use the modeObjs to gather amounts for checked modes (this covers dynamic/custom modes)
    modeObjs.forEach(function(mo) {
      if (mo && mo.el && mo.el.checked) {
        // prefer numeric amount; if missing, treat as 0 (keep previous behavior)
        const amt = (mo.amountInput && mo.amountInput.value) ? Number(mo.amountInput.value) : (mo.amount || 0);
        breakdownParts.push((mo.label || mo.el.value || '').trim() + ' Rs.' + (amt || 0));
      }
    });

    // If breakdownParts is still empty, fallback to scanning any inputs with data-mode-amount (non-checkbox-linked amounts)
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
    // NOTE: join by newline so the sheet cell will show each entry on its own line
    purchasedItem: selectedParts.join("\n"),
    purchasedFrom: (document.getElementById('purchasedFromSelect') || {}).value === 'Other' 
      ? ((document.getElementById('purchasedFrom') || {}).value || '').trim()
      : ((document.getElementById('purchasedFromSelect') || {}).value || '').trim(),
    modeOfPayment: modeStr,
    modeBreakdown: modeBreakdown,
    paymentPaid: (document.getElementById('paymentPaid') || {}).value || '',
    otherInfo: (document.getElementById('otherInfo') || {}).value ? document.getElementById('otherInfo').value.trim() : '',
    // Structured items array - server will prefer this if present (now includes unit)
    items: items
  };
}

// showMessage, clearForm, makeSubmissionId - keep same semantics as before
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
    const fromEl = document.getElementById('purchasedFrom'); if (fromEl) fromEl.value = '';
    const fromSel = document.getElementById('purchasedFromSelect'); if (fromSel) fromSel.selectedIndex = 0;
    document.querySelectorAll('input[name="modeOfPayment"]').forEach(el=>{ el.checked=false; });
    ['amt_cash','amt_online','amt_credit'].forEach(id=>{
      const e = document.getElementById(id);
      if (e) { e.value=''; e.disabled = true; }
    });
    // clear unit selects/customs but preserve saved preferences
    document.querySelectorAll('.unit-select').forEach(u => { 
      try { 
        u.selectedIndex = 0; 
        u.disabled = true; 
        // Apply saved preference after reset
        const preferences = loadUnitPreferences();
        const savedUnit = preferences[u.id];
        if (savedUnit) {
          const opts = Array.from(u.options).map(o => o.value);
          if (opts.includes(savedUnit)) {
            u.value = savedUnit;
          }
        }
      } catch(e){} 
    });
    document.querySelectorAll('.unit-custom').forEach(uc => { 
      try { 
        uc.value=''; 
        uc.style.display='none'; 
        uc.disabled = true; 
      } catch(e){} 
    });
    const payEl = document.getElementById('paymentPaid'); if (payEl) payEl.value = '';
    const oi = document.getElementById('otherInfo'); if (oi) oi.value = '';
  } catch(e){ console.warn('clearForm error', e); }
}

function makeSubmissionId() { return "s_" + Date.now() + "_" + Math.floor(Math.random()*1000000); }

// small helper to show last serial prominently (creates/updates a floating badge)
function updateSerialBadge(serial) {
  try {
    if (!serial && serial !== 0) return;
    var existing = document.getElementById('lastSerialBadge');
    if (existing) {
      existing.textContent = 'Last Serial: ' + String(serial);
      return;
    }
    var badge = document.createElement('div');
    badge.id = 'lastSerialBadge';
    badge.style.position = 'fixed';
    badge.style.right = '18px';
    badge.style.bottom = '18px';
    badge.style.background = '#2c7be5';
    badge.style.color = '#fff';
    badge.style.padding = '8px 12px';
    badge.style.borderRadius = '8px';
    badge.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
    badge.style.zIndex = 2000;
    badge.style.cursor = 'pointer';
    badge.title = 'Click to copy serial to clipboard';
    badge.textContent = 'Last Serial: ' + String(serial);
    badge.addEventListener('click', function(){
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(serial)).then(function(){ showMessage('Serial copied to clipboard'); }).catch(function(){ showMessage('Could not copy'); });
      } else {
        showMessage('Copy not supported');
      }
    });
    document.body.appendChild(badge);
  } catch (e) { console.warn('updateSerialBadge err', e); }
}

window.submitForm = async function() {
  const btn = document.getElementById('submitBtn');
  if (btn) btn.click();
  else await doSubmitFlow();
};

// ---------- Config helpers (server-backed) ----------
function loadSavedConfig() {
  const url = ENDPOINT + '?action=getConfig&token=' + encodeURIComponent(SHARED_TOKEN);
  return jsonpRequest(url, JSONP_TIMEOUT_MS).then(function(resp) {
    if (resp && resp.success && resp.config) {
      try {
        const cfg = resp.config;
        if (typeof window.applyConfig === 'function') {
          try { window.applyConfig(cfg); } catch(e) { console.warn('applyConfig threw', e); }
        } else {
          if (cfg.title) {
            const t = document.getElementById('appTitle');
            if (t) t.textContent = cfg.title;
          }
          if (cfg.labels) {
            Object.keys(cfg.labels).forEach(key => {
              const sel = '[data-config-id="' + key + '"]';
              const el = document.querySelector(sel) || document.getElementById(key);
              if (el) el.textContent = cfg.labels[key];
            });
          }
        }
      } catch(e) {
        console.warn('apply config failed', e);
      }
      return resp.config;
    }
    return null;
  }).catch(function(err){
    console.warn('loadSavedConfig error', err);
    return null;
  });
}

function saveConfigToServer(cfg) {
  try {
    const cfgStr = JSON.stringify(cfg || {});
    const url = ENDPOINT + '?action=saveConfig&token=' + encodeURIComponent(SHARED_TOKEN) + '&config=' + encodeURIComponent(cfgStr);
    return jsonpRequest(url, JSONP_TIMEOUT_MS).then(function(resp){
      return resp;
    }).catch(function(err){
      console.warn('saveConfigToServer error', err);
      throw err;
    });
  } catch(e) {
    return Promise.reject(e);
  }
}

// expose functions for index.html/customization UI
window.loadSavedConfig = loadSavedConfig;
window.saveConfigToServer = saveConfigToServer;
window.getCurrentCustomization = function() {
  try {
    const cfg = { title: '', labels: {}, structure: { mainItems: [], modes: [] } };
    return cfg;
  } catch (e) {
    return { title: '', labels: {}, structure: { mainItems: [], modes: [] } };
  }
};

// ---------- NEW: global units helpers used to persist custom units ----------------
const DEFAULT_GLOBAL_UNITS = ['Boxes','Pieces','Kg'];

function addGlobalUnitIfMissing(unit) {
  try {
    unit = (unit || "").toString().trim();
    if (!unit) return false;
    const list = loadGlobalUnits();
    if (list.indexOf(unit) === -1) {
      list.push(unit);
      saveGlobalUnits(list);
      // if page exposes a rebuild function from index.html, call it
      if (typeof window.rebuildAllUnitSelects === 'function') {
        try { window.rebuildAllUnitSelects(); } catch(e){}
      } else {
        // perform a simple rebuild here
        rebuildUnitSelectsSimple();
      }
      return true;
    }
  } catch(e){ console.warn('addGlobalUnitIfMissing err', e); }
  return false;
}

// simple fallback rebuild (if index.html does not provide rebuildAllUnitSelects)
function rebuildUnitSelectsSimple() {
  try {
    const defaultUnits = DEFAULT_GLOBAL_UNITS.slice();
    const globalUnits = loadGlobalUnits();
    const allUnits = [...defaultUnits, ...globalUnits];
    const preferences = loadUnitPreferences();
    
    document.querySelectorAll('.unit-select').forEach(sel => {
      const cur = sel.value;
      const selectId = sel.id;
      sel.innerHTML = '';
      
      // Add all units (no Custom option)
      allUnits.forEach(u => {
        const op = document.createElement('option'); 
        op.value = u; 
        op.textContent = u; 
        sel.appendChild(op);
      });
      
      // Apply saved preference
      if (selectId && preferences[selectId]) {
        const preferredUnit = preferences[selectId];
        const allOptions = Array.from(sel.options).map(opt => opt.value);
        if (allOptions.includes(preferredUnit)) {
          sel.value = preferredUnit;
        } else {
          // Add custom unit as option if not found
          const tempOption = document.createElement('option');
          tempOption.value = preferredUnit;
          tempOption.textContent = preferredUnit;
          sel.appendChild(tempOption);
          sel.value = preferredUnit;
        }
      } else if (cur && Array.from(sel.options).some(o=>o.value===cur)) {
        sel.value = cur;
      } else {
        sel.selectedIndex = 0;
      }
      
      sel.dispatchEvent(new Event('change'));
    });
  } catch(e){ console.warn('rebuildUnitSelectsSimple err', e); }
}

// ---------- new behavior: recompute paymentPaid when mode amounts / mode toggles change ----------
function recomputePaymentFromModes() {
  try {
    const rows = Array.from(document.querySelectorAll('.mode-row'));
    let sum = 0;
    rows.forEach(r => {
      const cb = r.querySelector('input[name="modeOfPayment"], input[type="checkbox"], input[type="radio"]');
      const amtInput = r.querySelector('input.mode-amount');
      if (cb && cb.checked && amtInput && amtInput.value) {
        const v = Number(amtInput.value);
        if (!isNaN(v)) sum += v;
      }
    });
    // Also include any standalone data-mode-amount entries where checkbox may not exist (rare)
    const fallbackAmtEls = Array.from(document.querySelectorAll('input[data-mode-amount]'));
    fallbackAmtEls.forEach(el => {
      const parent = el.closest('.mode-row');
      if (parent) return; // already handled
      const v = el.value ? Number(el.value) : 0;
      if (!isNaN(v)) sum += v;
    });

    const payEl = document.getElementById('paymentPaid');
    if (payEl) {
      payEl.value = sum ? Number(sum.toFixed(2)) : '';
    }
  } catch (e) { console.warn('recomputePaymentFromModes err', e); }
}

// ---------- MAIN DOM bindings ----------
document.addEventListener('DOMContentLoaded', function() {
  updateStatus();
  const submitBtn = document.getElementById('submitBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (submitBtn && !navigator.onLine) try { submitBtn.disabled = true; } catch(e){}

  if (!submitBtn) { console.warn('[INIT] submitBtn not found in DOM'); return; }
  try { submitBtn.setAttribute('type','button'); } catch(e){}

  // attempt to load saved customization (apply if present)
  (async function(){
    try {
      await loadSavedConfig();
    } catch(e) { /* ignore */ }
    // after config applied, ensure unit selects use saved global units and preferences
    try {
      if (typeof window.rebuildAllUnitSelects === 'function') {
        window.rebuildAllUnitSelects();
      } else {
        rebuildUnitSelectsSimple();
      }
      
      // Apply unit preferences after rebuild
      setTimeout(() => {
        const preferences = loadUnitPreferences();
        Object.keys(preferences).forEach(selectId => {
          const selectEl = document.getElementById(selectId);
          if (selectEl && preferences[selectId]) {
            const preferredUnit = preferences[selectId];
            const allOptions = Array.from(selectEl.options).map(opt => opt.value);
            if (allOptions.includes(preferredUnit)) {
              selectEl.value = preferredUnit;
              selectEl.dispatchEvent(new Event('change'));
            }
          }
        });
      }, 100);
    } catch(e){}
    // also recompute mode total in case config restored amounts
    recomputePaymentFromModes();
  })();

  // Prevent double-handling between touchend and click
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

      const payment = (document.getElementById('paymentPaid') || {}).value || "";
      const modeChecked = Array.from(document.querySelectorAll('input[name="modeOfPayment"]')).some(m=>m.checked);
      if (!modeChecked) { alert('Please select a mode of payment.'); return; }
      if (!payment || isNaN(Number(payment)) ) { alert('Please enter a valid payment amount.'); return; }

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
            // Prefer explicit serial returned by server. If not present, show row or debug to help troubleshooting.
            const serial = (resp.serial !== undefined && resp.serial !== null) ? resp.serial : null;
            if (serial !== null) {
              showMessage('Saved — Serial: ' + serial);
              updateSerialBadge(serial);
            } else {
              // serial not returned — surface helpful info
              if (resp.row) {
                showMessage('Saved (row: ' + resp.row + '). Serial not returned by server.');
              } else {
                showMessage('Saved — (serial not returned).');
              }
              console.warn('Server response missing serial', resp);
            }
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

  // ---------- Delegated handlers for unit-select / unit_custom & mode totals ----------
  // Unit select change -> show/hide custom input and save preference
  document.body.addEventListener('change', function(ev) {
    const t = ev.target;
    if (!t) return;
    
    // unit selector changed
    if (t.matches('.unit-select')) {
      const unitValue = t.value || '';
      const selectId = t.id || '';
      
      // Save unit preference immediately when changed
      if (selectId && unitValue) {
        saveUnitPreference(selectId, unitValue);
      }
      
      // Handle custom unit input visibility (even though Custom is removed from dropdown)
      if (selectId && selectId.indexOf('unit_') === 0) {
        const suffix = selectId.slice(5);
        const customEl = document.getElementById('unit_custom_' + suffix);
        if (customEl) {
          // Hide custom input since we removed Custom option
          customEl.style.display = 'none';
          customEl.disabled = true;
        }
      }
    }

    // mode checkbox toggled -> enable/disable amount and recompute total
    if (t.matches('input[name="modeOfPayment"], .mode-row input[type="checkbox"], .mode-row input[type="radio"]')) {
      // allow existing bindModeToggle to also run; small delay to let it enable amt input
      setTimeout(recomputePaymentFromModes, 20);
    }
  }, { passive:true });

  // unit_custom input -> when user types a custom unit, persist it and add to globalUnits
  document.body.addEventListener('input', function(ev) {
    const t = ev.target;
    if (!t) return;
    
    if (t.matches('.unit-custom')) {
      const id = t.id || '';
      if (!id || id.indexOf('unit_custom_') !== 0) return;
      const suffix = id.slice('unit_custom_'.length);
      const val = (t.value || '').trim();
      if (val) {
        // save custom value to globalUnits so it appears in other selects
        addGlobalUnitIfMissing(val);
        // Save as unit preference
        const unitSelectId = 'unit_' + suffix;
        saveUnitPreference(unitSelectId, val);
        // Update the corresponding select to show this custom value
        const sel = document.getElementById(unitSelectId);
        if (sel) {
          const existingOptions = Array.from(sel.options).map(opt => opt.value);
          if (!existingOptions.includes(val)) {
            const newOption = document.createElement('option');
            newOption.value = val;
            newOption.textContent = val;
            sel.appendChild(newOption);
          }
          sel.value = val;
        }
      }
    }

    // mode amount input changed -> recompute total
    if (t.matches('.mode-amount')) {
      // recompute after a tiny debounce to avoid excessive writes while typing
      if (t._mode_debounce_timer) clearTimeout(t._mode_debounce_timer);
      t._mode_debounce_timer = setTimeout(function(){ recomputePaymentFromModes(); t._mode_debounce_timer = null; }, 180);
    }

  }, { passive:true });

  // also listen for clicks changing mode checkboxes (immediate recompute)
  document.body.addEventListener('click', function(ev){
    const t = ev.target;
    if (t && (t.matches && t.matches('input[name="modeOfPayment"], .mode-row input[type="checkbox"], .mode-row input[type="radio"]'))) {
      setTimeout(recomputePaymentFromModes, 10);
    }
  }, { passive:true });

  // Unregister service workers & clear caches (as before)
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.getRegistrations().then(function(regs){ regs.forEach(r => { r.unregister().catch(()=>{}); }); }).catch(()=>{}); } catch(e){ console.warn('sw unregister err', e); }
  }
  if ('caches' in window) {
    try { caches.keys().then(keys => { keys.forEach(k => caches.delete(k)); }).catch(()=>{}); } catch(e){ console.warn('cache clear err', e); }
  }

}); // DOMContentLoaded end















