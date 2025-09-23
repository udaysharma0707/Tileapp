// Configuration — set this to your deployed Apps Script web app URL
const ENDPOINT = "https://script.google.com/macros/s/AKfycbzscPoB_TYIrk-Dad6byZy1v7wmbD0nN5rblLDvmOimEAX8yzGAA8KhF6hZHI7jDkfFNQ/exec";
const SHARED_TOKEN = "shopSecret2025";
const JSONP_TIMEOUT_MS = 20000;
const activeSubmissions = new Set();

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

/* ---------- MAIN: collectFormData (updated) ---------- */
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
  // collect all elements named modeOfPayment (works for radio or checkbox)
  const rawModeEls = Array.from(document.querySelectorAll('input[name="modeOfPayment"]'));
  const rawSelected = rawModeEls.filter(m=>m.checked).map(m=> (m.value || "").toString().trim() ).filter(x=>x!=="");

  // canonicalizer for common labels
  function canonicalLabel(v){
    if(!v) return v;
    const s = v.toString().toLowerCase();
    if (s.indexOf('cash') !== -1) return 'Cash';
    if (s.indexOf('online') !== -1) return 'Online';
    if (s.indexOf('credit') !== -1) return 'Credit';
    // return as-is (but trim)
    return v.trim();
  }

  // preferred order for canonical modes
  const preferred = ['Cash','Online','Credit'];
  const present = new Set();
  const orderedModes = [];

  // add canonical modes in preferred order if present among rawSelected
  const rawLower = rawSelected.map(s=>s.toLowerCase());
  preferred.forEach(pref => {
    if (rawLower.some(r => r.indexOf(pref.toLowerCase()) !== -1)) {
      orderedModes.push(pref);
      present.add(pref);
    }
  });
  // append any remaining (non-canonical or custom) in the order they were selected (deduped)
  rawSelected.forEach(r => {
    const can = canonicalLabel(r);
    if (!present.has(can)) { orderedModes.push(can); present.add(can); }
  });

  const modeStr = orderedModes.join(', ');

  // --------- modeBreakdown: look for specific amount inputs (robust fallback) ----------
  // Try id-based amounts if present (amt_cash, amt_online, amt_credit) or fallback to elements with data-amt
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
    // fallback: if none of the specific amount ids exist, look for inputs with [data-mode-amount] attribute (optional)
    if (breakdownParts.length === 0) {
      const amtEls = Array.from(document.querySelectorAll('input[data-mode-amount]'));
      amtEls.forEach(el => {
        const modeName = el.getAttribute('data-mode-amount') || '';
        const val = el.value ? Number(el.value) : 0;
        if (modeName && val) breakdownParts.push(modeName + ' Rs.' + val);
      });
    }
  } catch (e) { /* ignore and proceed */ }

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

/* showMessage, clearForm, makeSubmissionId - keep same semantics as before (clearForm also clears amt inputs if present) */
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
    // clear mode checkboxes/radios
    document.querySelectorAll('input[name="modeOfPayment"]').forEach(el=>{ el.checked=false; });
    // clear amount fields (if present)
    ['amt_cash','amt_online','amt_credit'].forEach(id=>{
      const e = document.getElementById(id);
      if (e) { e.value=''; e.disabled = true; }
    });
    document.getElementById('paymentPaid').value = '';
    document.getElementById('otherInfo').value = '';
  } catch(e){ console.warn('clearForm error', e); }
}
function makeSubmissionId() { return "s_" + Date.now() + "_" + Math.floor(Math.random()*1000000); }

window.submitForm = async function() {
  const btn = document.getElementById('submitBtn');
  if (btn) btn.click();
  else await doSubmitFlow();
};

document.addEventListener('DOMContentLoaded', function() {
  updateStatus();
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

  // unregister service workers & clear caches (as before)
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.getRegistrations().then(function(regs){ regs.forEach(r => { r.unregister().catch(()=>{}); }); }).catch(()=>{}); } catch(e){ console.warn('sw unregister err', e); }
  }
  if ('caches' in window) {
    try { caches.keys().then(keys => { keys.forEach(k => caches.delete(k)); }).catch(()=>{}); } catch(e){ console.warn('cache clear err', e); }
  }

}); // DOMContentLoaded end
