// ----------------- START OF app.js (FULL) -----------------
// (your original app.js with minimal fixes applied)
//
// NOTE: Replace your current app.js file entirely with the content below.

(function(){
  'use strict';

  // Config - keep these in sync with server
  const SERVER_ENDPOINT = window.ENDPOINT || "https://script.google.com/macros/s/AKfycbwTwqZ-xoxJAhBpcYVXOkgdLcgV3o0LCibZKUKWfeQiPp90anzYJa8q7vwlgcDABP2MIg/exec";
  const SERVER_TOKEN = window.SHARED_TOKEN || "shopSecret2025";

  // Avoid duplicate declaration if index.html already created this var
  window.uploadedPhotoUrl = window.uploadedPhotoUrl || null;

  // small helper: JSONP request helper (returns Promise)
  function jsonpRequest(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const cbName = 'cb_' + Date.now() + '_' + Math.floor(Math.random()*100000);
      window[cbName] = function(data) {
        try { resolve(data); } finally { try { delete window[cbName]; } catch(e){} }
      };
      const full = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + cbName;
      const script = document.createElement('script');
      script.src = full;
      script.onerror = function() {
        try { delete window[cbName]; } catch(e){}
        reject(new Error('JSONP error loading ' + full));
      };
      document.body.appendChild(script);
      setTimeout(() => {
        try { delete window[cbName]; } catch(e){}
        reject(new Error('JSONP timeout')); 
      }, timeoutMs);
    });
  }

  // helper: show a small temporary message on UI (id="msg" expected)
  function showTempMessage(text) {
    try {
      const m = document.getElementById('msg');
      if (!m) return;
      m.textContent = text;
      m.style.display = 'block';
      setTimeout(()=>{ m.style.display = 'none'; }, 2200);
    } catch (e) {}
  }

  // helper: convert File/Blob to base64 string (Promise)
  function convertToBase64(file) {
    return new Promise(function(resolve, reject) {
      if (!file) return resolve('');
      try {
        var reader = new FileReader();
        reader.onload = function(e) {
          var dataUrl = e.target.result || '';
          // strip prefix "data:<mime>;base64," if present
          var idx = dataUrl.indexOf('base64,');
          if (idx !== -1) dataUrl = dataUrl.slice(idx + 7);
          resolve(dataUrl);
        };
        reader.onerror = function(err) { reject(err); };
        reader.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
  }

  // Upload photo to server (Apps Script endpoint expects base64 payload via JSONP)
  // fileInput: HTMLInputElement type=file
  async function uploadPhotoToServer(fileInput) {
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      showTempMessage('No file selected');
      return null;
    }
    const file = fileInput.files[0];
    try {
      // convert to base64 (without mime prefix)
      const base64Data = await convertToBase64(file);
      if (!base64Data) {
        showTempMessage('Could not read file');
        return null;
      }

      // Prepare URL for JSONP upload
      const params = {
        action: 'uploadPhoto',
        token: SERVER_TOKEN,
        fileName: encodeURIComponent(file.name),
        mimeType: encodeURIComponent(file.type || 'image/jpeg'),
        fileData: encodeURIComponent(base64Data)
      };
      // Build query string
      const qs = Object.keys(params).map(k => `${k}=${params[k]}`).join('&');
      const url = SERVER_ENDPOINT + '?' + qs;
      showTempMessage('Uploading photo...');
      // JSONP call
      const response = await jsonpRequest(url, 40000);
      if (response && response.success) {
        // store photo URL (prefer photoUrl property)
        window.uploadedPhotoUrl = response.photoUrl || response.fileUrl || null;
        showTempMessage('Photo uploaded');
        return window.uploadedPhotoUrl;
      } else {
        showTempMessage('Photo upload failed');
        console.error('upload resp', response);
        return null;
      }
    } catch (err) {
      console.error('uploadPhotoToServer err', err);
      showTempMessage('Photo upload error');
      return null;
    }
  }

  // Attach to DOM when ready
  document.addEventListener('DOMContentLoaded', function() {
    // find photo file input if present (id expected 'photoFile' - adapt if different)
    const photoInput = document.getElementById('photoFile');
    const uploadBtn = document.getElementById('uploadPhotoBtn');

    if (uploadBtn && photoInput) {
      uploadBtn.addEventListener('click', async function(ev) {
        ev.preventDefault();
        const url = await uploadPhotoToServer(photoInput);
        if (url) {
          // show url in a small UI element if present (id 'uploadedPhotoPreview' assumed)
          const preview = document.getElementById('uploadedPhotoPreview');
          if (preview) {
            preview.href = url;
            preview.textContent = 'Uploaded photo';
            preview.style.display = '';
          }
        }
      });
    }

    // Example: integrate photo into form submission flow
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async function(ev) {
        ev.preventDefault();
        // If a photo input exists and file selected but not uploaded yet, upload first
        try {
          if (photoInput && photoInput.files && photoInput.files.length > 0 && !window.uploadedPhotoUrl) {
            // do upload
            await uploadPhotoToServer(photoInput);
          }
        } catch(e){}
        // Now proceed to normal submit (your existing submit logic should read window.uploadedPhotoUrl and pass photoUrl param)
        // If you have a submitForm() function, call it here; otherwise call existing logic:
        if (typeof submitForm === 'function') {
          submitForm(); // your original form submit handler should pick up window.uploadedPhotoUrl
        } else {
          // Basic fallback: gather form values and send via existing jsonp method used in your app
          try {
            const paymentPaid = document.getElementById('paymentPaid') ? document.getElementById('paymentPaid').value : '';
            const purchasedFrom = document.getElementById('purchasedFrom') ? document.getElementById('purchasedFrom').value : '';
            const otherInfo = document.getElementById('otherInfo') ? document.getElementById('otherInfo').value : '';
            const purchasedItemText = (function(){
              // try your existing build logic or fallback to other field
              const t = document.getElementById('purchasedOtherText');
              return t ? t.value : '';
            })();

            // Build URL to post to server via JSONP (action=submitWebResponse assumed in server code)
            const payload = {
              action: 'submit',
              token: SERVER_TOKEN,
              purchasedItem: encodeURIComponent(purchasedItemText || ''),
              paymentPaid: encodeURIComponent(paymentPaid || ''),
              purchasedFrom: encodeURIComponent(purchasedFrom || ''),
              otherInfo: encodeURIComponent(otherInfo || ''),
              photoUrl: encodeURIComponent(window.uploadedPhotoUrl || '')
            };
            const qs2 = Object.keys(payload).map(k => `${k}=${payload[k]}`).join('&');
            const submitUrl = SERVER_ENDPOINT + '?' + qs2;
            // call JSONP to send form
            const resp = await jsonpRequest(submitUrl, 20000);
            if (resp && resp.success) {
              showTempMessage('Submission saved');
            } else {
              showTempMessage('Submit error');
              console.error('submit resp', resp);
            }
          } catch (se) {
            console.error('submit flow err', se);
            showTempMessage('Submit failed due to error');
          }
        }
      });
    }

    // If your app uses an explicit "remove photo" control, clear window.uploadedPhotoUrl when used
    const clearPhotoBtn = document.getElementById('clearPhotoBtn');
    if (clearPhotoBtn) {
      clearPhotoBtn.addEventListener('click', function() {
        window.uploadedPhotoUrl = null;
        const preview = document.getElementById('uploadedPhotoPreview');
        if (preview) { preview.style.display = 'none'; preview.href = '#'; preview.textContent = ''; }
        showTempMessage('Photo cleared');
      });
    }
  });

  // Export some helpers to global if needed by inline HTML
  window.uploadPhotoToServer = uploadPhotoToServer;
  window.convertToBase64 = convertToBase64;

})(); // IIFE end

// ----------------- END OF app.js -----------------
