// Configuration — set this to your deployed Apps Script web app URL
const ENDPOINT = "https://script.google.com/macros/s/AKfycbzscPoB_TYIrk-Dad6byZy1v7wmbD0nN5rblLDvmOimEAX8yzGAA8KhF6hZHI7jDkfFNQ/exec";
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

  // show persistent "Connect to internet" when offline and disable submit
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
window.addEventListener('online', ()=>{ updateStatus(); /* do not queue or flush */ });
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

  // purchasedItem is a comma-separated string containing "QTY Item" entries
  add("purchasedItem", formData.purchasedItem || "");
  add("purchasedFrom", formData.purchasedFrom || "");
  add("modeOfPayment", formData.modeOfPayment || "");
  add("paymentPaid", formData.paymentPaid === undefined ? "" : String(formData.paymentPaid));
  add("otherInfo", formData.otherInfo || "");
  if (formData.submissionId) { add("submissionId", formData.submissionId); add("clientId", formData.submissionId); }
  if (clientTs) add("clientTs", String(clientTs));

  var base = ENDPOINT;
  var url = base + (base.indexOf('?') === -1 ? '?' : '&') + params.join("&");
  if (url.length > 1900) return Promise.reject(new Error("Payload too large for JSONP"));
  return jsonpRequest(url, JSONP_TIMEOUT_MS);
}

// collect data from DOM — now reads per-item qty inputs
function collectFormData(){
  // list of the items and their checkbox & qty ids (keep in sync with html)
  const items = [
    {chk: 'p_floor', qty: 'q_floor', label: 'Floor Tiles'},
    {chk: 'p_wall',  qty: 'q_wall',  label: 'Wall Tiles'},
    {chk: 'p_san',   qty: 'q_san',   label: 'Sanitaryware'},
    {chk: 'p_acc',   qty: 'q_acc',   label: 'Accessories'},
    {chk: 'p_other', qty: 'q_other', label: 'Others'}
  ];

  const selectedParts = [];
  items.forEach(it => {
    const cb = document.getElementById(it.chk);
    if (!cb) return;
    if (cb.checked) {
      const qEl = document.getElementById(it.qty);
      const qty = qEl ? (qEl.value === undefined ? "" : String(qEl.value).trim()) : "";
      // For 'Other' prefer the typed other text if present
      let name = it.label;
      if (it.chk === 'p_other') {
        const otherTxtEl = document.getElementById('purchasedOtherText');
        if (otherTxtEl && otherTxtEl.value && otherTxtEl.value.trim() !== "") name = otherTxtEl.value.trim();
      }
      // Build entry as "QTY Name" (if qty present) else just "Name"
      if (qty !== "") {
        // keep numeric appearance — but do not force integer parsing here; server will sanitize
        selectedParts.push(qty + " " + name);
      } else {
        // empty qty — return name only (but validation should prevent this)
        selectedParts.push(name);
      }
    }
  });

  var modeEl = document.querySelector('input[name="modeOfPayment"]:checked');
  return {
    purchasedItem: selectedParts.join(", "),
    purchasedFrom: document.getElementById('purchasedFrom').value.trim(),
    modeOfPayment: modeEl ? modeEl.value : "",
    paymentPaid: document.getElementById('paymentPaid').value,
    otherInfo: document.getElementById('otherInfo').value.trim()
  };
}

function showMessage(text){
  var m = document.getElementById('msg');
  if (!m) { console.log('[UI]', text); return; }
  m.textContent = text; m.style.display='block';
  // auto-hide only when online and message isn't the offline notice
  setTimeout(()=>{ if (m && navigator.onLine) m.style.display='none'; }, 4000);
}
function clearForm(){
  try {
    // uncheck all purchased checkboxes and clear qtys
    document.querySelectorAll('.purchased').forEach(ch => { ch.checked = false; });
    document.querySelectorAll('.qty').forEach(q => { q.value = ''; q.disabled = true; });
    // other fields
    document.getElementById('purchasedFrom').value = '';
    document.querySelectorAll('input[name="modeOfPayment"]').forEach(el=>el.checked=false);
    document.getElementById('paymentPaid').value = '';
    document.getElementById('otherInfo').value = '';
    const otherEl = document.getElementById('purchasedOtherText');
    if (otherEl) otherEl.value = '';
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

  // disable submit immediately if offline
  if (submitBtn && !navigator.onLine) {
    try { submitBtn.disabled = true; } catch(e){}
  }

  if (!submitBtn) {
    console.warn('[INIT] submitBtn not found in DOM');
    return;
  }

  // Ensure button is type=button
  try { submitBtn.setAttribute('type','button'); } catch(e){}

  // Prevent double-handling between touchend and click
  let ignoreNextClick = false;

  async function doSubmitFlow() {
    try {
      // If offline, block submission and inform user
      if (!navigator.onLine) {
        alert('Connect to internet. Your entry cannot be saved while offline.');
        updateStatus();
        return;
      }

      // Basic client validation
      var purchasedChecked = document.querySelectorAll('.purchased:checked');
      var payment = (document.getElementById('paymentPaid') || {}).value || "";
      var modeChecked = document.querySelector('input[name="modeOfPayment"]:checked');

      if (!purchasedChecked || purchasedChecked.length === 0) { alert("Please select at least one purchased item."); return; }
      // for each selected purchased item, ensure its qty is present and > 0
      for (let ch of purchasedChecked) {
        const id = ch.id;
        const qtyEl = document.querySelector('#q_' + id.slice(2)); // expects pattern p_xxx -> q_xxx
        // fallback robust lookup if pattern mismatches
        let foundQty = qtyEl;
        if (!foundQty) {
          // try to find sibling with class qty
          foundQty = ch.closest('.item-row') ? ch.closest('.item-row').querySelector('.qty') : null;
        }
        const val = foundQty ? (foundQty.value || "").toString().trim() : "";
        if (!val || isNaN(Number(val)) || Number(val) <= 0) {
          alert("Please enter a valid quantity (>0) for the selected item: " + (ch.nextSibling ? ch.nextSibling.textContent : ch.value || "Item"));
          return;
        }
      }

      if (payment.trim() === "") { alert("Payment paid is required."); return; }
      if (!modeChecked) { alert("Please select a mode of payment."); return; }

      // collect
      var formData = collectFormData();

      // assign a submissionId
      if (!formData.submissionId) formData.submissionId = makeSubmissionId();

      // if this id is already active (somehow), stop
      if (activeSubmissions.has(formData.submissionId)) {
        console.log('[SUBMIT] submission already in-flight id=', formData.submissionId);
        showMessage('Submission in progress — please wait');
        return;
      }

      // mark active so we don't double-send same id
      activeSubmissions.add(formData.submissionId);

      // immediate visible feedback
      submitBtn.disabled = true;
      const origLabel = submitBtn.textContent;
      submitBtn.textContent = 'Saving...';

      // clear UI immediately
      showMessage('Submitting — please wait...');
      clearForm();

      // background send (online)
      (async function backgroundSend(localForm) {
        try {
          // Attempt send current item (direct submit)
          const clientTs = Date.now();
          try {
            const resp = await sendToServerJSONP(localForm, clientTs);
            if (resp && resp.success) {
              showMessage('Saved — Serial: ' + resp.serial);
            } else if (resp && resp.error) {
              // server validation error -> inform user
              alert('Server rejected submission: ' + resp.error);
            } else {
              // unknown server response
              alert('Unexpected server response. Please retry while online.');
            }
          } catch (errSend) {
            // network/JSONP error -> report to user (do NOT queue)
            console.error('send failed; not queuing (offline not allowed)', errSend);
            alert('Network error occurred. Please ensure you are online and try again.');
          }

        } catch (bgErr) {
          console.error('backgroundSend unexpected', bgErr);
          alert('Unexpected error occurred. Please retry.');
        } finally {
          // done processing this id
          try { activeSubmissions.delete(localForm.submissionId); } catch(e){}
          // restore button label
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

  // touchend handler to support mobile taps
  function onTouchEndSubmit(ev) {
    if (!ev) return;
    ev.preventDefault && ev.preventDefault();
    ev.stopPropagation && ev.stopPropagation();
    ignoreNextClick = true;
    setTimeout(()=>{ ignoreNextClick = false; }, 800);
    doSubmitFlow();
  }
  function onClickSubmit(ev) {
    if (ignoreNextClick) { ev && ev.preventDefault(); console.log('[APP] ignored click after touch'); return; }
    doSubmitFlow();
  }

  // Attach event listeners (touch first, then click)
  submitBtn.addEventListener('touchend', onTouchEndSubmit, { passive:false });
  submitBtn.addEventListener('click', onClickSubmit, { passive:false });

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('touchend', function(ev){ ev && ev.preventDefault(); clearForm(); showMessage('Form cleared'); }, { passive:false });
    clearBtn.addEventListener('click', function(ev){ clearForm(); showMessage('Form cleared'); }, { passive:false });
  }

  // unregister any existing service workers so cached SW can't re-enable offline writes
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(r => { r.unregister().catch(()=>{}); });
      }).catch(()=>{});
    } catch(e){ console.warn('sw unregister err', e); }
  }

  // clear caches if available
  if ('caches' in window) {
    try {
      caches.keys().then(keys => { keys.forEach(k => caches.delete(k)); }).catch(()=>{});
    } catch(e){ console.warn('cache clear err', e); }
  }

  // No offline queueing or flush attempts — offline entries are not supported.
}); // DOMContentLoaded end
