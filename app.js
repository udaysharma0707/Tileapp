// Configuration — set this to your deployed Apps Script web app URL
const ENDPOINT = "https://script.google.com/macros/s/AKfycbwBqdE5aDrRr-79SOE31rzvhT0QfSxQJdcGa9lXqlZVhauBzVdQUoylHmP8-arl7Ep69Q/exec";
const SHARED_TOKEN = "shopSecret2025";

// Tunables
const JSONP_TIMEOUT_MS = 20000;   // JSONP timeout

// runtime
const activeSubmissions = new Set(); // submissionIds being processed

// ---------- helpers ----------
function updateStatus() {
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

// JSONP helper (returns Promise)
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

// Build JSONP URL and call
function sendToServerJSONP(formData, clientTs, opts) {
  var params = [];
  function add(k,v){ if (v === undefined || v === null) v=""; params.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v))); }
  add("token", SHARED_TOKEN);

  add("purchasedItem", formData.purchasedItem || "");
  add("purchasedFrom", formData.purchasedFrom || "");
  add("modeOfPayment", formData.modeOfPayment || "");
  // send breakdown so server can attach a comment/note
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

// collect data from DOM — collects selected subitems with qtys and mode breakdown
function collectFormData(){
  const selectedParts = [];

  // helper - push if checked
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

  // Floor subitems
  if (document.getElementById('p_floor') && document.getElementById('p_floor').checked) {
    pushIfSub('sub_floor_vitrified','q_floor_vitrified','Vitrified tiles');
    pushIfSub('sub_floor_ceramic','q_floor_ceramic','Ceramic tiles');
    pushIfSub('sub_floor_porcelain','q_floor_porcelain','Porcelain tiles');
    pushIfSub('sub_floor_marble','q_floor_marble','Marble finish tiles');
    pushIfSub('sub_floor_granite','q_floor_granite','Granite finish tiles');
  }

  // Wall subitems
  if (document.getElementById('p_wall') && document.getElementById('p_wall').checked) {
    pushIfSub('sub_wall_kitchen','q_wall_kitchen','Kitchen wall tiles (backsplash)');
    pushIfSub('sub_wall_bath','q_wall_bath','Bathroom wall tiles (glazed/anti-skid)');
    pushIfSub('sub_wall_decor','q_wall_decor','Decorative / designer wall tiles');
  }

  // Sanitary subitems
  if (document.getElementById('p_san') && document.getElementById('p_san').checked) {
    pushIfSub('sub_san_wash','q_san_wash','Washbasins');
    pushIfSub('sub_san_wc','q_san_wc','WC');
    pushIfSub('sub_san_urinal','q_san_urinal','Urinals');
  }

  // Accessories subitems
  if (document.getElementById('p_acc') && document.getElementById('p_acc').checked) {
    pushIfSub('sub_acc_grout','q_acc_grout','Tile grout & adhesives');
    pushIfSub('sub_acc_spacers','q_acc_spacers','Spacers');
    pushIfSub('sub_acc_sealants','q_acc_sealants','Sealants');
    pushIfSub('sub_acc_chem','q_acc_chem','Chemicals');
    pushIfSub('sub_acc_skirting','q_acc_skirting','Skirting & border tiles');
    pushIfSub('sub_acc_mosaic','q_acc_mosaic','Mosaic tiles for decoration');
  }

  // Others main: if checked, we allow a custom text with qty
  if (document.getElementById('p_other') && document.getElementById('p_other').checked) {
    const otherTxt = (document.getElementById('purchasedOtherText') || {}).value || "";
    const otherQty = (document.getElementById('q_other') || {}).value || "";
    const label = otherTxt.trim() !== "" ? otherTxt.trim() : "Others";
    if (otherQty !== "") selectedParts.push(otherQty + " " + label);
    else selectedParts.push(label);
  }

  // collect modeOfPayment as a comma-separated string (robust, in case index.html didn't set first-checked)
  const selectedModes = [];
  const modeEls = Array.from(document.querySelectorAll('input[name="modeOfPayment"]'));
  modeEls.forEach(m => { if (m.checked) selectedModes.push((m.value || "").toString()); });
  const modeStr = selectedModes.join(", ");

  // build mode breakdown: Cash Rs.x, Online Rs.y, Credit Rs.z (only include checked entries)
  const parts = [];
  const amtCash = document.getElementById('amt_cash');
  const amtOnline = document.getElementById('amt_online');
  const amtCredit = document.getElementById('amt_credit');
  if (document.getElementById('mode_cash') && document.getElementById('mode_cash').checked) {
    const v = (amtCash && amtCash.value) ? Number(amtCash.value) : 0;
    parts.push('Cash Rs.' + (v || 0));
  }
  if (document.getElementById('mode_online') && document.getElementById('mode_online').checked) {
    const v = (amtOnline && amtOnline.value) ? Number(amtOnline.value) : 0;
    parts.push('Online Rs.' + (v || 0));
  }
  if (document.getElementById('mode_credit') && document.getElementById('mode_credit').checked) {
    const v = (amtCredit && amtCredit.value) ? Number(amtCredit.value) : 0;
    parts.push('Credit Rs.' + (v || 0));
  }
  const modeBreakdown = parts.join(', ');

  return {
    purchasedItem: selectedParts.join(", "),
    purchasedFrom: document.getElementById('purchasedFrom').value.trim(),
    modeOfPayment: modeStr,
    modeBreakdown: modeBreakdown,
    paymentPaid: document.getElementById('paymentPaid').value,
    otherInfo: document.getElementById('otherInfo').value.trim()
  };
}

function showMessage(text){
  var m = document.getElementById('msg');
  if (!m) { console.log('[UI]', text); return; }
  m.textContent = text; m.style.display='block';
  setTimeout(()=>{ if (m && navigator.onLine) m.style.display='none'; }, 4000);
}
function clearForm(){
  try {
    // uncheck main and sub checkboxes
    document.querySelectorAll('.purchased').forEach(ch => { ch.checked = false; });
    document.querySelectorAll('.subitem').forEach(ch => { ch.checked = false; });
    // clear all qtys and disable sub qtys
    document.querySelectorAll('.qty').forEach(q => { q.value = ''; q.disabled = true; });
    // hide all sublists
    document.querySelectorAll('.sublist').forEach(s => s.style.display = 'none');
    // clear others text and other fields
    const otherEl = document.getElementById('purchasedOtherText'); if (otherEl) otherEl.value = '';
    document.getElementById('purchasedFrom').value = '';
    document.querySelectorAll('input[name="modeOfPayment"]').forEach(el=>{ el.checked=false; });
    // clear mode amounts
    const amts = ['amt_cash','amt_online','amt_credit'];
    amts.forEach(id => { const el = document.getElementById(id); if (el) { el.value=''; el.disabled = true; }});
    document.getElementById('paymentPaid').value = '';
    document.getElementById('otherInfo').value = '';
  } catch(e){ console.warn('clearForm error', e); }
}

// small generator for submissionId
function makeSubmissionId() {
  return "s_" + Date.now() + "_" + Math.floor(Math.random()*1000000);
}

// Expose submitForm global so index.html's inline call works
window.submitForm = async function() {
  const btn = document.getElementById('submitBtn');
  if (btn) btn.click();
  else await doSubmitFlow();
};

// ---------- DOM bindings (no offline queueing) ----------
document.addEventListener('DOMContentLoaded', function() {
  updateStatus();
  const submitBtn = document.getElementById('submitBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (submitBtn && !navigator.onLine) {
    try { submitBtn.disabled = true; } catch(e){}
  }

  if (!submitBtn) { console.warn('[INIT] submitBtn not found in DOM'); return; }
  try { submitBtn.setAttribute('type','button'); } catch(e){}

  // Prevent double-handling between touchend and click
  let ignoreNextClick = false;

  // Helper to validate: for each checked main category ensure at least one subitem is selected
  function validateMainSubSelection() {
    const errors = [];
    // floor
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
      if (!navigator.onLine) {
        alert('Connect to internet. Your entry cannot be saved while offline.');
        updateStatus();
        return;
      }

      // basic checks
      const anyMainChecked = Array.from(document.querySelectorAll('.purchased')).some(cb => cb.checked);
      if (!anyMainChecked) { alert('Please select at least one purchased main category.'); return; }

      const validationList = validateMainSubSelection();
      if (validationList.length > 0) { alert(validationList.join('\n')); return; }

      // verify each selected subitem has qty > 0
      const selectedSubboxes = Array.from(document.querySelectorAll('.subitem')).filter(s => s.checked);
      for (let sb of selectedSubboxes) {
        const qid = 'q' + sb.id.slice(3); // e.g. sub_floor_ceramic -> q_floor_ceramic
        const qEl = document.getElementById(qid);
        const val = qEl ? (String(qEl.value || "").trim()) : "";
        if (!val || isNaN(Number(val)) || Number(val) <= 0) {
          alert('Please enter a valid quantity (>0) for: ' + (sb.value || 'selected item'));
          return;
        }
      }

      // for Others main, if used ensure qty >0
      if (document.getElementById('p_other') && document.getElementById('p_other').checked) {
        const q = (document.getElementById('q_other') || {}).value || "";
        if (!q || isNaN(Number(q)) || Number(q) <= 0) {
          alert('Please enter a valid quantity (>0) for Others or uncheck Others.');
          return;
        }
      }

      // payment & mode validations
      const payment = (document.getElementById('paymentPaid') || {}).value || "";
      const modeChecked = document.querySelector('input[name="modeOfPayment"]:checked');
      if (!modeChecked) { alert('Please select a mode of payment.'); return; }
      if (!payment || isNaN(Number(payment)) ) { alert('Please enter a valid payment amount.'); return; }

      // collect form
      var formData = collectFormData();
      // ensure we did actually collect at least one sub-entry
      if (!formData.purchasedItem || formData.purchasedItem.trim() === "") {
        alert('No sub-item selected. Please select at least one specific item and quantity.');
        return;
      }

      // assign submission id
      if (!formData.submissionId) formData.submissionId = makeSubmissionId();
      if (activeSubmissions.has(formData.submissionId)) {
        showMessage('Submission in progress — please wait');
        return;
      }
      activeSubmissions.add(formData.submissionId);

      // UI feedback
      submitBtn.disabled = true;
      const origLabel = submitBtn.textContent;
      submitBtn.textContent = 'Saving...';
      showMessage('Submitting — please wait...');
      // clear UI immediately (we keep formData local)
      clearForm();

      // send
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

  // touch & click wiring
  function onTouchEndSubmit(ev) { if (!ev) return; ev.preventDefault && ev.preventDefault(); ev.stopPropagation && ev.stopPropagation(); ignoreNextClick = true; setTimeout(()=>{ ignoreNextClick = false; }, 800); doSubmitFlow(); }
  function onClickSubmit(ev) { if (ignoreNextClick) { ev && ev.preventDefault(); return; } doSubmitFlow(); }

  submitBtn.addEventListener('touchend', onTouchEndSubmit, { passive:false });
  submitBtn.addEventListener('click', onClickSubmit, { passive:false });

  // clear button
  if (clearBtn) {
    clearBtn.addEventListener('touchend', function(ev){ ev && ev.preventDefault(); clearForm(); showMessage('Form cleared'); }, { passive:false });
    clearBtn.addEventListener('click', function(ev){ clearForm(); showMessage('Form cleared'); }, { passive:false });
  }

  // unregister service workers & clear caches as previously
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.getRegistrations().then(function(regs){ regs.forEach(r => { r.unregister().catch(()=>{}); }); }).catch(()=>{}); } catch(e){ console.warn('sw unregister err', e); }
  }
  if ('caches' in window) {
    try { caches.keys().then(keys => { keys.forEach(k => caches.delete(k)); }).catch(()=>{}); } catch(e){ console.warn('cache clear err', e); }
  }

}); // DOMContentLoaded end

