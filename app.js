const ENDPOINT = "https://script.google.com/macros/s/AKfycbx42uFYDmwQ3EGMCWKqkbL6yWaZmfJsm3KMA2ZttpX9tjU-y6x2v_w0tnBaoAezbJKAMQ/exec";
const SHARED_TOKEN = "shopSecret2025";
const JSONP_TIMEOUT_MS = 20000;
const activeSubmissions = new Set();

// Global variable to store uploaded photo URL
let uploadedPhotoUrl = null;

// ---------- helpers ----------
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

// JSONP helper (returns Promise) - FIXED with better error handling
function jsonpRequest(url, timeoutMs) {
  timeoutMs = timeoutMs || JSONP_TIMEOUT_MS;
  return new Promise(function(resolve, reject) {
    const cbName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random()*100000);
    let timer = null;
    let scriptAdded = false;
    
    window[cbName] = function(data) {
      try { 
        resolve(data); 
      } finally {
        // cleanup
        try { delete window[cbName]; } catch(e){}
        const s = document.getElementById(cbName);
        if (s && s.parentNode) {
          try {
            s.parentNode.removeChild(s);
          } catch(e){}
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    };
    
    url = url.replace(/(&|\?)?callback=[^&]*/i, "");
    const full = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + encodeURIComponent(cbName);
    
    const script = document.createElement('script');
    script.id = cbName;
    script.src = full;
    script.async = true;
    
    script.onerror = function() {
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) {
        try {
          script.parentNode.removeChild(script);
        } catch(e){}
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      reject(new Error('JSONP script load error'));
    };
    
    timer = setTimeout(function(){
      try { delete window[cbName]; } catch(e){}
      if (script.parentNode) {
        try {
          script.parentNode.removeChild(script);
        } catch(e){}
      }
      reject(new Error('JSONP timeout'));
    }, timeoutMs);
    
    try {
      document.body.appendChild(script);
      scriptAdded = true;
    } catch(e) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try { delete window[cbName]; } catch(e){}
      reject(new Error('Failed to add script to DOM'));
    }
  });
}

// ---------- Photo Upload Functions ----------
function convertToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoToServer(file) {
  try {
    setPhotoUploadStatus('uploading', 'Uploading photo...');
    
    const base64Data = await convertToBase64(file);
    
    // Build URL parameters manually to avoid encoding issues
    const params = [];
    params.push('action=uploadPhoto');
    params.push('token=' + encodeURIComponent(SHARED_TOKEN));
    params.push('fileName=' + encodeURIComponent(file.name || 'photo.jpg'));
    params.push('mimeType=' + encodeURIComponent(file.type || 'image/jpeg'));
    params.push('fileData=' + encodeURIComponent(base64Data.split(',')[1])); // Remove data:image/jpeg;base64, part

    const url = ENDPOINT + '?' + params.join('&');

    console.log('Uploading photo to:', ENDPOINT);
    const response = await jsonpRequest(url, 60000); // 60 second timeout for photo upload
    console.log('Upload response:', response);

    if (response && response.success && response.photoUrl) {
      uploadedPhotoUrl = response.photoUrl;
      setPhotoUploadStatus('success', 'Photo uploaded successfully!');
      console.log('Photo uploaded successfully:', response.photoUrl);
      return response.photoUrl;
    } else {
      throw new Error(response ? response.error || 'Photo upload failed' : 'No response from server');
    }
  } catch (error) {
    console.error('Photo upload error:', error);
    setPhotoUploadStatus('error', 'Photo upload failed: ' + error.message);
    throw error;
  }
}

function setPhotoUploadStatus(type, message) {
  const statusEl = document.getElementById('photoUploadStatus');
  if (statusEl) {
    statusEl.className = `photo-upload-status ${type}`;
    statusEl.textContent = message;
    statusEl.style.display = 'block';
    
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        if (statusEl) statusEl.style.display = 'none';
      }, 5000);
    }
  }
}

function displayPhotoPreview(file) {
  const preview = document.getElementById('photoPreview');
  const previewImg = document.getElementById('previewImage');
  const photoInfo = document.getElementById('photoInfo');

  if (preview && previewImg && photoInfo) {
    const reader = new FileReader();
    reader.onload = function(e) {
      previewImg.src = e.target.result;
      preview.style.display = 'block';
      
      const fileSize = (file.size / 1024 / 1024).toFixed(2); // MB
      photoInfo.textContent = `${file.name} (${fileSize} MB)`;
    };
    reader.readAsDataURL(file);
  }
}

function removePhoto() {
  const preview = document.getElementById('photoPreview');
  const previewImg = document.getElementById('previewImage');
  const photoInfo = document.getElementById('photoInfo');
  const cameraInput = document.getElementById('photoFileInputCamera');
  const galleryInput = document.getElementById('photoFileInputGallery');
  const statusEl = document.getElementById('photoUploadStatus');

  if (preview) preview.style.display = 'none';
  if (previewImg) previewImg.src = '';
  if (photoInfo) photoInfo.textContent = '';
  if (cameraInput) cameraInput.value = '';
  if (galleryInput) galleryInput.value = '';
  if (statusEl) statusEl.style.display = 'none';
  
  uploadedPhotoUrl = null;
}

// Expose photo functions globally
window.convertToBase64 = convertToBase64;
window.uploadPhotoToServer = uploadPhotoToServer;
window.setPhotoUploadStatus = setPhotoUploadStatus;
window.displayPhotoPreview = displayPhotoPreview;
window.removePhoto = removePhoto;

// Build JSONP URL and call (form submit) - Updated to include photo URL
function sendToServerJSONP(formData, clientTs, opts) {
  const params = [];
  function add(k,v){ 
    if (v === undefined || v === null) v=""; 
    params.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v))); 
  }
  
  add("token", SHARED_TOKEN);
  add("purchasedItem", formData.purchasedItem || "");
  add("purchasedFrom", formData.purchasedFrom || "");
  add("modeOfPayment", formData.modeOfPayment || "");
  add("modeBreakdown", formData.modeBreakdown || "");
  add("paymentPaid", formData.paymentPaid === undefined ? "" : String(formData.paymentPaid));
  add("otherInfo", formData.otherInfo || "");
  add("photoUrl", formData.photoUrl || uploadedPhotoUrl || "");
  
  if (formData.submissionId) { 
    add("submissionId", formData.submissionId); 
    add("clientId", formData.submissionId); 
  }
  if (clientTs) add("clientTs", String(clientTs));

  // include structured items JSON 
  try {
    if (formData.items && Array.isArray(formData.items)) {
      add("itemsJSON", JSON.stringify(formData.items));
    }
  } catch (e) {
    console.warn('itemsJSON stringify failed', e);
  }

  const url = ENDPOINT + (ENDPOINT.indexOf('?') === -1 ? '?' : '&') + params.join("&");
  
  if (url.length > 8000) {
    return Promise.reject(new Error("Payload too large for JSONP"));
  }
  
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

// ---------- CRITICAL: Sub-item Show/Hide Functionality ----------
function bindMainToSubHandlers() {
  console.log('=== Setting up main-to-sub bindings ===');
  
  // Main category to sublist mapping
  const mainToSubMapping = {
    'p_floor': 'sublist_floor',
    'p_wall': 'sublist_wall', 
    'p_san': 'sublist_san',
    'p_acc': 'sublist_acc'
  };

  Object.keys(mainToSubMapping).forEach(mainId => {
    const mainCheckbox = document.getElementById(mainId);
    const sublistDiv = document.getElementById(mainToSubMapping[mainId]);
    
    if (!mainCheckbox || !sublistDiv) {
      console.warn(`Missing elements: ${mainId} or ${mainToSubMapping[mainId]}`);
      return;
    }

    console.log(`Binding ${mainId} to ${mainToSubMapping[mainId]}`);

    // Remove existing listeners to avoid duplicates
    if (mainCheckbox._mainToSubHandler) {
      mainCheckbox.removeEventListener('change', mainCheckbox._mainToSubHandler);
    }

    // Create the handler function
    const handler = function() {
      const isChecked = mainCheckbox.checked;
      console.log(`${mainId} changed: ${isChecked}`);
      
      // Show/hide the sublist
      sublistDiv.style.display = isChecked ? 'block' : 'none';
      
      // If unchecking main category, also uncheck all sub-items and clear quantities
      if (!isChecked) {
        const subItems = sublistDiv.querySelectorAll('.subitem');
        const quantities = sublistDiv.querySelectorAll('.subqty');
        const unitSelects = sublistDiv.querySelectorAll('.unit-select');
        const unitCustoms = sublistDiv.querySelectorAll('.unit-custom');
        
        subItems.forEach(sub => { sub.checked = false; });
        quantities.forEach(qty => { 
          qty.value = ''; 
          qty.disabled = true; 
        });
        unitSelects.forEach(unit => { 
          unit.selectedIndex = 0; 
          unit.disabled = true; 
        });
        unitCustoms.forEach(custom => { 
          custom.value = ''; 
          custom.style.display = 'none'; 
          custom.disabled = true; 
        });
      }
    };

    // Bind the handler
    mainCheckbox._mainToSubHandler = handler;
    mainCheckbox.addEventListener('change', handler);
    
    // Apply initial state
    handler();
  });
}

// ---------- CRITICAL: Sub-item Quantity/Unit Handlers ----------
function bindSubItemHandlers() {
  console.log('=== Setting up sub-item handlers ===');
  
  document.querySelectorAll('.subitem').forEach(subCheckbox => {
    if (!subCheckbox.id) return;
    
    const subId = subCheckbox.id; // e.g., 'sub_floor_vitrified'
    const suffix = subId.replace('sub_', ''); // e.g., 'floor_vitrified'
    const qtyId = 'q_' + suffix; // e.g., 'q_floor_vitrified'
    const unitId = 'unit_' + suffix; // e.g., 'unit_floor_vitrified'
    const unitCustomId = 'unit_custom_' + suffix;
    
    const qtyInput = document.getElementById(qtyId);
    const unitSelect = document.getElementById(unitId);
    const unitCustom = document.getElementById(unitCustomId);
    
    console.log(`Binding sub-item: ${subId} -> qty:${qtyId}, unit:${unitId}`);

    // Remove existing handler to avoid duplicates
    if (subCheckbox._subItemHandler) {
      subCheckbox.removeEventListener('change', subCheckbox._subItemHandler);
    }

    // Create handler for sub-item checkbox
    const handler = function() {
      const isChecked = subCheckbox.checked;
      console.log(`${subId} changed: ${isChecked}`);
      
      // Enable/disable quantity input
      if (qtyInput) {
        qtyInput.disabled = !isChecked;
        if (!isChecked) qtyInput.value = '';
      }
      
      // Enable/disable unit select
      if (unitSelect) {
        unitSelect.disabled = !isChecked;
        if (!isChecked) {
          unitSelect.selectedIndex = 0;
        } else {
          // Apply saved unit preference when enabling
          const preferences = loadUnitPreferences();
          const savedUnit = preferences[unitId];
          if (savedUnit) {
            const opts = Array.from(unitSelect.options).map(o => o.value);
            if (opts.includes(savedUnit)) {
              unitSelect.value = savedUnit;
            }
          }
        }
      }
      
      // Handle custom unit input
      if (unitCustom) {
        unitCustom.disabled = !isChecked;
        if (!isChecked) {
          unitCustom.value = '';
          unitCustom.style.display = 'none';
        }
      }
    };

    // Bind the handler
    subCheckbox._subItemHandler = handler;
    subCheckbox.addEventListener('change', handler);
    
    // Apply initial state
    handler();

    // Unit select change handler
    if (unitSelect) {
      if (unitSelect._unitChangeHandler) {
        unitSelect.removeEventListener('change', unitSelect._unitChangeHandler);
      }
      
      const unitChangeHandler = function() {
        const selectedUnit = unitSelect.value;
        
        // Handle custom unit visibility
        if (unitCustom) {
          if (selectedUnit === 'Custom') {
            unitCustom.style.display = 'inline-block';
            unitCustom.disabled = !subCheckbox.checked;
            if (subCheckbox.checked) unitCustom.focus();
          } else {
            unitCustom.style.display = 'none';
            unitCustom.value = '';
            unitCustom.disabled = true;
          }
        }
        
        // Save unit preference
        if (subCheckbox.checked && selectedUnit) {
          saveUnitPreference(unitId, selectedUnit);
        }
      };
      
      unitSelect._unitChangeHandler = unitChangeHandler;
      unitSelect.addEventListener('change', unitChangeHandler);
      
      // Apply initial state
      unitChangeHandler();
    }
  });
}

// ---------- CRITICAL: Others Main Item Handler ----------
function bindOthersHandler() {
  console.log('=== Setting up Others handler ===');
  
  const othersMain = document.getElementById('p_other');
  const othersQty = document.getElementById('q_other');
  const othersUnit = document.getElementById('unit_other');
  const othersCustom = document.getElementById('unit_custom_other');
  
  if (!othersMain) {
    console.warn('Others main checkbox not found');
    return;
  }

  // Remove existing handler
  if (othersMain._othersHandler) {
    othersMain.removeEventListener('change', othersMain._othersHandler);
  }

  const handler = function() {
    const isChecked = othersMain.checked;
    console.log(`Others changed: ${isChecked}`);
    
    if (othersQty) {
      othersQty.disabled = !isChecked;
      if (!isChecked) othersQty.value = '';
    }
    
    if (othersUnit) {
      othersUnit.disabled = !isChecked;
      if (!isChecked) {
        othersUnit.selectedIndex = 0;
      } else {
        // Apply saved preference
        const preferences = loadUnitPreferences();
        const savedUnit = preferences['unit_other'];
        if (savedUnit) {
          const opts = Array.from(othersUnit.options).map(o => o.value);
          if (opts.includes(savedUnit)) {
            othersUnit.value = savedUnit;
          }
        }
      }
    }
    
    if (othersCustom) {
      othersCustom.disabled = !isChecked;
      if (!isChecked) {
        othersCustom.value = '';
        othersCustom.style.display = 'none';
      }
    }
  };

  othersMain._othersHandler = handler;
  othersMain.addEventListener('change', handler);
  
  // Apply initial state
  handler();

  // Others unit select handler
  if (othersUnit) {
    if (othersUnit._othersUnitHandler) {
      othersUnit.removeEventListener('change', othersUnit._othersUnitHandler);
    }
    
    const unitHandler = function() {
      const selectedUnit = othersUnit.value;
      
      if (othersCustom) {
        if (selectedUnit === 'Custom') {
          othersCustom.style.display = 'inline-block';
          othersCustom.disabled = !othersMain.checked;
          if (othersMain.checked) othersCustom.focus();
        } else {
          othersCustom.style.display = 'none';
          othersCustom.value = '';
          othersCustom.disabled = true;
        }
      }
      
      if (othersMain.checked && selectedUnit) {
        saveUnitPreference('unit_other', selectedUnit);
      }
    };
    
    othersUnit._othersUnitHandler = unitHandler;
    othersUnit.addEventListener('change', unitHandler);
    
    // Apply initial state
    unitHandler();
  }
}

// ---------- CRITICAL: Payment Mode Handlers ----------
function bindPaymentModeHandlers() {
  console.log('=== Setting up payment mode handlers ===');
  
  document.querySelectorAll('input[name="modeOfPayment"]').forEach(modeCheckbox => {
    if (!modeCheckbox.id) return;
    
    const modeId = modeCheckbox.id; // e.g., 'mode_cash'
    const amountId = 'amt_' + modeId; // e.g., 'amt_mode_cash'
    const amountInput = document.getElementById(amountId) || 
                       modeCheckbox.closest('.mode-row')?.querySelector('.mode-amount');
    
    if (!amountInput) {
      console.warn(`Amount input not found for ${modeId}`);
      return;
    }

    console.log(`Binding payment mode: ${modeId} -> ${amountInput.id || 'amount input'}`);

    // Remove existing handler
    if (modeCheckbox._paymentModeHandler) {
      modeCheckbox.removeEventListener('change', modeCheckbox._paymentModeHandler);
    }

    const handler = function() {
      const isChecked = modeCheckbox.checked;
      console.log(`${modeId} changed: ${isChecked}`);
      
      amountInput.disabled = !isChecked;
      if (!isChecked) {
        amountInput.value = '';
      }
    };

    modeCheckbox._paymentModeHandler = handler;
    modeCheckbox.addEventListener('change', handler);
    
    // Apply initial state
    handler();
  });
}

// ---------- MAIN: collectFormData (FIXED - but simpler and more reliable) ----------
function collectFormData(){
  const selectedParts = [];
  const items = [];
  
  console.log('=== Starting collectFormData ===');

  // Helper function to safely get element value
  function getElementValue(id, defaultValue = '') {
    const el = document.getElementById(id);
    return el ? (el.value || '').toString().trim() : defaultValue;
  }

  // Helper function to check if element is checked
  function isChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  // Helper function to get label text
  function getLabelText(checkboxId, fallback = '') {
    let labelText = fallback;
    try {
      const configEl = document.querySelector(`[data-config-id="${checkboxId}_label"]`);
      if (configEl && configEl.textContent) {
        labelText = configEl.textContent.trim();
      } else {
        const labelEl = document.getElementById(`label_${checkboxId}`);
        if (labelEl && labelEl.textContent) {
          labelText = labelEl.textContent.trim();
        } else {
          const checkboxEl = document.getElementById(checkboxId);
          if (checkboxEl && checkboxEl.value) {
            labelText = checkboxEl.value.trim();
          }
        }
      }
    } catch (e) {
      console.warn('Error getting label for', checkboxId, e);
    }
    return labelText || fallback;
  }

  // Helper function to get unit value
  function getUnitValue(suffix) {
    const unitSelectId = `unit_${suffix}`;
    const unitCustomId = `unit_custom_${suffix}`;
    
    const unitSelect = document.getElementById(unitSelectId);
    const unitCustom = document.getElementById(unitCustomId);
    
    if (unitSelect) {
      const selectedUnit = unitSelect.value || '';
      if (unitCustom && unitCustom.style.display !== 'none' && unitCustom.value && unitCustom.value.trim()) {
        return unitCustom.value.trim();
      }
      return selectedUnit;
    }
    return '';
  }

  // Process each main category and its sub-items
  const mainCategories = [
    {
      mainId: 'p_floor',
      subItems: [
        { id: 'sub_floor_vitrified', qtyId: 'q_floor_vitrified', label: 'Vitrified tiles' },
        { id: 'sub_floor_ceramic', qtyId: 'q_floor_ceramic', label: 'Ceramic tiles' },
        { id: 'sub_floor_porcelain', qtyId: 'q_floor_porcelain', label: 'Porcelain tiles' },
        { id: 'sub_floor_marble', qtyId: 'q_floor_marble', label: 'Marble finish tiles' },
        { id: 'sub_floor_granite', qtyId: 'q_floor_granite', label: 'Granite finish tiles' }
      ]
    },
    {
      mainId: 'p_wall',
      subItems: [
        { id: 'sub_wall_kitchen', qtyId: 'q_wall_kitchen', label: 'Kitchen wall tiles (backsplash)' },
        { id: 'sub_wall_bath', qtyId: 'q_wall_bath', label: 'Bathroom wall tiles (glazed/anti-skid)' },
        { id: 'sub_wall_decor', qtyId: 'q_wall_decor', label: 'Decorative / designer wall tiles' }
      ]
    },
    {
      mainId: 'p_san',
      subItems: [
        { id: 'sub_san_wash', qtyId: 'q_san_wash', label: 'Washbasins' },
        { id: 'sub_san_wc', qtyId: 'q_san_wc', label: 'WC' },
        { id: 'sub_san_urinal', qtyId: 'q_san_urinal', label: 'Urinals' }
      ]
    },
    {
      mainId: 'p_acc',
      subItems: [
        { id: 'sub_acc_grout', qtyId: 'q_acc_grout', label: 'Tile grout & adhesives' },
        { id: 'sub_acc_spacers', qtyId: 'q_acc_spacers', label: 'Spacers' },
        { id: 'sub_acc_sealants', qtyId: 'q_acc_sealants', label: 'Sealants' },
        { id: 'sub_acc_chem', qtyId: 'q_acc_chem', label: 'Chemicals' },
        { id: 'sub_acc_skirting', qtyId: 'q_acc_skirting', label: 'Skirting & border tiles' },
        { id: 'sub_acc_mosaic', qtyId: 'q_acc_mosaic', label: 'Mosaic tiles for decoration' }
      ]
    }
  ];

  // Process main categories
  mainCategories.forEach(category => {
    if (isChecked(category.mainId)) {
      console.log(`Processing main category: ${category.mainId}`);
      
      category.subItems.forEach(subItem => {
        if (isChecked(subItem.id)) {
          const quantity = getElementValue(subItem.qtyId);
          const label = getLabelText(subItem.id, subItem.label);
          const suffix = subItem.id.replace('sub_', '');
          const unit = getUnitValue(suffix);
          
          console.log(`Sub-item ${subItem.id}: qty=${quantity}, unit=${unit}, label=${label}`);
          
          if (quantity && !isNaN(Number(quantity)) && Number(quantity) > 0) {
            const itemText = unit ? `${quantity} ${unit} ${label}` : `${quantity} ${label}`;
            selectedParts.push(itemText);
            items.push({ 
              id: subItem.id, 
              qty: quantity, 
              unit: unit, 
              label: label 
            });
            
            // Save unit preference
            if (unit) {
              saveUnitPreference(`unit_${suffix}`, unit);
            }
          }
        }
      });
    }
  });

  // Handle "Others" main item
  if (isChecked('p_other')) {
    console.log('Processing Others item');
    
    const otherQty = getElementValue('q_other');
    const otherText = getElementValue('purchasedOtherText');
    const otherLabel = getLabelText('p_other', 'Others');
    const otherUnit = getUnitValue('other');
    
    console.log(`Others: qty=${otherQty}, text=${otherText}, unit=${otherUnit}`);
    
    const finalLabel = otherText || otherLabel;
    
    if (otherQty && !isNaN(Number(otherQty)) && Number(otherQty) > 0) {
      const itemText = otherUnit ? `${otherQty} ${otherUnit} ${finalLabel}` : `${otherQty} ${finalLabel}`;
      selectedParts.push(itemText);
      items.push({ 
        id: 'p_other', 
        qty: otherQty, 
        unit: otherUnit, 
        label: finalLabel 
      });
      
      // Save unit preference
      if (otherUnit) {
        saveUnitPreference('unit_other', otherUnit);
      }
    }
  }

  // Scan for any additional dynamic sub-items
  try {
    const allSubitems = document.querySelectorAll('.subitem');
    const processedIds = new Set(mainCategories.flatMap(c => c.subItems.map(s => s.id)));
    
    allSubitems.forEach(checkbox => {
      if (!checkbox.id || processedIds.has(checkbox.id) || !checkbox.checked) {
        return;
      }
      
      const qtyId = 'q' + checkbox.id.slice(3);
      const quantity = getElementValue(qtyId);
      const label = getLabelText(checkbox.id, checkbox.value);
      const suffix = checkbox.id.replace('sub_', '');
      const unit = getUnitValue(suffix);
      
      console.log(`Dynamic sub-item ${checkbox.id}: qty=${quantity}, unit=${unit}, label=${label}`);
      
      if (quantity && !isNaN(Number(quantity)) && Number(quantity) > 0) {
        const itemText = unit ? `${quantity} ${unit} ${label}` : `${quantity} ${label}`;
        selectedParts.push(itemText);
        items.push({ 
          id: checkbox.id, 
          qty: quantity, 
          unit: unit, 
          label: label 
        });
        
        if (unit) {
          saveUnitPreference(`unit_${suffix}`, unit);
        }
      }
    });
  } catch (e) {
    console.warn('Error scanning dynamic sub-items:', e);
  }

  // Process payment modes
  const modeLabels = [];
  const modeBreakdownParts = [];
  
  try {
    const modeCheckboxes = document.querySelectorAll('input[name="modeOfPayment"]:checked');
    modeCheckboxes.forEach(checkbox => {
      const modeLabel = getLabelText(checkbox.id, checkbox.value);
      if (modeLabel) {
        modeLabels.push(modeLabel);
        
        // Try to find amount input
        const amountInput = document.getElementById(`amt_${checkbox.id}`) ||
                           checkbox.closest('.mode-row')?.querySelector('.mode-amount');
        
        const amount = amountInput && amountInput.value ? Number(amountInput.value) : 0;
        modeBreakdownParts.push(`${modeLabel} Rs.${amount}`);
      }
    });
  } catch (e) {
    console.warn('Error processing payment modes:', e);
  }

  // Get other form data
  const purchasedFrom = getElementValue('purchasedFromSelect') === 'Other' 
    ? getElementValue('purchasedFrom')
    : getElementValue('purchasedFromSelect');

  const result = {
    purchasedItem: selectedParts.join('\n'),
    purchasedFrom: purchasedFrom,
    modeOfPayment: modeLabels.join(', '),
    modeBreakdown: modeBreakdownParts.join(', '),
    paymentPaid: getElementValue('paymentPaid'),
    otherInfo: getElementValue('otherInfo'),
    photoUrl: uploadedPhotoUrl || '',
    items: items
  };

  console.log('=== collectFormData result ===', {
    purchasedItemLength: result.purchasedItem.length,
    itemsCount: result.items.length,
    selectedPartsCount: selectedParts.length,
    purchasedItem: result.purchasedItem.substring(0, 100) + '...'
  });

  return result;
}

// Other utility functions
function showMessage(text){
  const m = document.getElementById('msg');
  if (!m) { console.log('[UI]', text); return; }
  m.textContent = text; 
  m.style.display='block';
  setTimeout(()=>{ if (m && navigator.onLine) m.style.display='none'; }, 4000);
}

function clearForm(){
  try {
    document.querySelectorAll('.purchased').forEach(ch => { ch.checked = false; });
    document.querySelectorAll('.subitem').forEach(ch => { ch.checked = false; });
    document.querySelectorAll('.qty').forEach(q => { q.value = ''; q.disabled = true; });
    document.querySelectorAll('.sublist').forEach(s => s.style.display = 'none');
    
    const otherEl = document.getElementById('purchasedOtherText'); 
    if (otherEl) otherEl.value = '';
    const fromEl = document.getElementById('purchasedFrom'); 
    if (fromEl) fromEl.value = '';
    const fromSel = document.getElementById('purchasedFromSelect'); 
    if (fromSel) fromSel.selectedIndex = 0;
    
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
    
    const payEl = document.getElementById('paymentPaid'); 
    if (payEl) payEl.value = '';
    const oi = document.getElementById('otherInfo'); 
    if (oi) oi.value = '';
    
    // Clear photo
    removePhoto();
    
    // Re-bind handlers after clearing
    bindMainToSubHandlers();
    bindSubItemHandlers();
    bindOthersHandler();
    bindPaymentModeHandlers();
  } catch(e){ 
    console.warn('clearForm error', e); 
  }
}

function makeSubmissionId() { 
  return "s_" + Date.now() + "_" + Math.floor(Math.random()*1000000); 
}

function updateSerialBadge(serial) {
  try {
    if (!serial && serial !== 0) return;
    let existing = document.getElementById('lastSerialBadge');
    if (existing) {
      existing.textContent = 'Last Serial: ' + String(serial);
      return;
    }
    const badge = document.createElement('div');
    badge.id = 'lastSerialBadge';
    badge.style.cssText = `
      position: fixed; right: 18px; bottom: 18px; background: #2c7be5; color: #fff;
      padding: 8px 12px; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.2);
      z-index: 2000; cursor: pointer; font-family: Arial, sans-serif;
    `;
    badge.title = 'Click to copy serial to clipboard';
    badge.textContent = 'Last Serial: ' + String(serial);
    badge.addEventListener('click', function(){
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(serial))
          .then(() => showMessage('Serial copied to clipboard'))
          .catch(() => showMessage('Could not copy'));
      } else {
        showMessage('Copy not supported');
      }
    });
    document.body.appendChild(badge);
  } catch (e) { 
    console.warn('updateSerialBadge err', e); 
  }
}

window.submitForm = async function() {
  const btn = document.getElementById('submitBtn');
  if (btn) btn.click();
  else await doSubmitFlow();
};

// Config helpers 
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
    return { title: '', labels: {}, structure: { mainItems: [], modes: [] } };
  } catch (e) {
    return { title: '', labels: {}, structure: { mainItems: [], modes: [] } };
  }
};

// global units helpers
const DEFAULT_GLOBAL_UNITS = ['Boxes','Pieces','Kg'];

function addGlobalUnitIfMissing(unit) {
  try {
    unit = (unit || "").toString().trim();
    if (!unit) return false;
    const list = loadGlobalUnits();
    if (list.indexOf(unit) === -1) {
      list.push(unit);
      saveGlobalUnits(list);
      if (typeof window.rebuildAllUnitSelects === 'function') {
        try { window.rebuildAllUnitSelects(); } catch(e){}
      } else {
        rebuildUnitSelectsSimple();
      }
      return true;
    }
  } catch(e){ console.warn('addGlobalUnitIfMissing err', e); }
  return false;
}

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
      
      allUnits.forEach(u => {
        const op = document.createElement('option'); 
        op.value = u; 
        op.textContent = u; 
        sel.appendChild(op);
      });
      
      if (selectId && preferences[selectId]) {
        const preferredUnit = preferences[selectId];
        const allOptions = Array.from(sel.options).map(opt => opt.value);
        if (allOptions.includes(preferredUnit)) {
          sel.value = preferredUnit;
        } else {
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
    
    const fallbackAmtEls = Array.from(document.querySelectorAll('input[data-mode-amount]'));
    fallbackAmtEls.forEach(el => {
      const parent = el.closest('.mode-row');
      if (parent) return;
      const v = el.value ? Number(el.value) : 0;
      if (!isNaN(v)) sum += v;
    });

    const payEl = document.getElementById('paymentPaid');
    if (payEl) {
      payEl.value = sum ? Number(sum.toFixed(2)) : '';
    }
  } catch (e) { console.warn('recomputePaymentFromModes err', e); }
}

// MAIN DOM bindings
document.addEventListener('DOMContentLoaded', function() {
  updateStatus();
  const submitBtn = document.getElementById('submitBtn');
  const clearBtn = document.getElementById('clearBtn');

  if (submitBtn && !navigator.onLine) {
    try { submitBtn.disabled = true; } catch(e){}
  }

  if (!submitBtn) { 
    console.warn('[INIT] submitBtn not found in DOM'); 
    return; 
  }
  
  try { submitBtn.setAttribute('type','button'); } catch(e){}

  // CRITICAL: Set up all the handlers that make sub-items work
  console.log('=== Initializing form handlers ===');
  bindMainToSubHandlers();
  bindSubItemHandlers();
  bindOthersHandler();
  bindPaymentModeHandlers();

  // Photo Upload Event Listeners Setup
  const photoUploadBtnCamera = document.getElementById('photoUploadBtnCamera');
  const photoUploadBtnGallery = document.getElementById('photoUploadBtnGallery');
  const photoFileInputCamera = document.getElementById('photoFileInputCamera');
  const photoFileInputGallery = document.getElementById('photoFileInputGallery');
  const removePhotoBtn = document.getElementById('removePhotoBtn');

  function handlePhotoFile(file) {
    if (!file) return;
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Photo size must be less than 10MB');
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }

    displayPhotoPreview(file);
    
    uploadPhotoToServer(file).catch(error => {
      console.error('Upload failed:', error);
    });
  }

  // Handle camera button and input
  if (photoUploadBtnCamera && photoFileInputCamera) {
    photoUploadBtnCamera.addEventListener('click', function() {
      photoFileInputCamera.click();
    });

    photoFileInputCamera.addEventListener('change', function(e) {
      handlePhotoFile(e.target.files[0]);
    });
  }

  // Handle gallery button and input
  if (photoUploadBtnGallery && photoFileInputGallery) {
    photoUploadBtnGallery.addEventListener('click', function() {
      photoFileInputGallery.click();
    });

    photoFileInputGallery.addEventListener('change', function(e) {
      handlePhotoFile(e.target.files[0]);
    });
  }

  if (removePhotoBtn) {
    removePhotoBtn.addEventListener('click', function() {
      removePhoto();
    });
  }

  // Load config and setup
  (async function(){
    try {
      await loadSavedConfig();
    } catch(e) { /* ignore */ }
    
    try {
      if (typeof window.rebuildAllUnitSelects === 'function') {
        window.rebuildAllUnitSelects();
      } else {
        rebuildUnitSelectsSimple();
      }
      
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
    
    recomputePaymentFromModes();
  })();

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
      console.log('=== Starting form submission ===');
      
      if (!navigator.onLine) { 
        alert('Connect to internet. Your entry cannot be saved while offline.'); 
        updateStatus(); 
        return; 
      }
      
      const anyMainChecked = Array.from(document.querySelectorAll('.purchased')).some(cb => cb.checked);
      if (!anyMainChecked) { 
        alert('Please select at least one purchased main category.'); 
        return; 
      }
      
      const validationList = validateMainSubSelection();
      if (validationList.length > 0) { 
        alert(validationList.join('\n')); 
        return; 
      }

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

      if (!payment || isNaN(Number(payment))) { 
        alert('Please enter a valid payment amount.'); 
        return; 
      }

      // Collect form data
      const formData = collectFormData();
      console.log('=== Form data collected ===', formData);
      
      if (!formData.purchasedItem || formData.purchasedItem.trim() === "") {
        console.error('No purchased items found in form data');
        alert('No items selected. Please select at least one specific item and enter a valid quantity.');
        return;
      }

      if (!formData.submissionId) formData.submissionId = makeSubmissionId();
      if (activeSubmissions.has(formData.submissionId)) { 
        showMessage('Submission in progress — please wait'); 
        return; 
      }
      
      activeSubmissions.add(formData.submissionId);

      submitBtn.disabled = true;
      const origLabel = submitBtn.textContent;
      submitBtn.textContent = 'Saving...';
      showMessage('Submitting — please wait...');

      // Don't clear form until after successful submission
      console.log('=== Sending to server ===');

      try {
        const clientTs = Date.now();
        const resp = await sendToServerJSONP(formData, clientTs);
        console.log('=== Server response ===', resp);
        
        if (resp && resp.success) {
          // Clear form only after successful submission
          clearForm();
          
          const serial = (resp.serial !== undefined && resp.serial !== null) ? resp.serial : null;
          if (serial !== null) {
            showMessage('Saved — Serial: ' + serial);
            updateSerialBadge(serial);
          } else {
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
          console.error('Unexpected server response:', resp);
        }
      } catch (errSend) {
        console.error('=== Send failed ===', errSend);
        alert('Network error occurred. Please ensure you are online and try again.');
      } finally {
        try { activeSubmissions.delete(formData.submissionId); } catch(e){}
        try { 
          submitBtn.disabled = false; 
          submitBtn.textContent = origLabel || 'Submit'; 
        } catch(e){}
        updateStatus();
      }

    } catch (ex) {
      console.error('=== Submit handler exception ===', ex);
      alert('Unexpected error during submission. Please try again.');
      try {
        submitBtn.disabled = false; 
        submitBtn.textContent = 'Submit';
      } catch(e){}
    }
  }

  function onTouchEndSubmit(ev) { 
    if (!ev) return; 
    ev.preventDefault && ev.preventDefault(); 
    ev.stopPropagation && ev.stopPropagation(); 
    ignoreNextClick = true; 
    setTimeout(()=>{ ignoreNextClick = false; }, 800); 
    doSubmitFlow(); 
  }
  
  function onClickSubmit(ev) { 
    if (ignoreNextClick) { 
      ev && ev.preventDefault(); 
      return; 
    } 
    doSubmitFlow(); 
  }

  submitBtn.addEventListener('touchend', onTouchEndSubmit, { passive:false });
  submitBtn.addEventListener('click', onClickSubmit, { passive:false });

  if (clearBtn) {
    clearBtn.addEventListener('touchend', function(ev){ 
      ev && ev.preventDefault(); 
      clearForm(); 
      showMessage('Form cleared'); 
    }, { passive:false });
    
    clearBtn.addEventListener('click', function(ev){ 
      clearForm(); 
      showMessage('Form cleared'); 
    }, { passive:false });
  }

  // Delegated handlers for unit-select / unit_custom & mode totals
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
      
      // Handle custom unit input visibility
      if (selectId && selectId.indexOf('unit_') === 0) {
        const suffix = selectId.slice(5);
        const customEl = document.getElementById('unit_custom_' + suffix);
        if (customEl) {
          if (unitValue === 'Custom') {
            customEl.style.display = 'inline-block';
            customEl.disabled = false;
            customEl.focus();
          } else {
            customEl.style.display = 'none';
            customEl.value = '';
            customEl.disabled = true;
          }
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
      t._mode_debounce_timer = setTimeout(function(){ 
        recomputePaymentFromModes(); 
        t._mode_debounce_timer = null; 
      }, 180);
    }

  }, { passive:true });

  // also listen for clicks changing mode checkboxes (immediate recompute)
  document.body.addEventListener('click', function(ev){
    const t = ev.target;
    if (t && (t.matches && t.matches('input[name="modeOfPayment"], .mode-row input[type="checkbox"], .mode-row input[type="radio"]'))) {
      setTimeout(recomputePaymentFromModes, 10);
    }
  }, { passive:true });

  // Unregister service workers & clear caches
  if ('serviceWorker' in navigator) {
    try { 
      navigator.serviceWorker.getRegistrations().then(function(regs){ 
        regs.forEach(r => { 
          r.unregister().catch(()=>{}); 
        }); 
      }).catch(()=>{}); 
    } catch(e){ 
      console.warn('sw unregister err', e); 
    }
  }
  
  if ('caches' in window) {
    try { 
      caches.keys().then(keys => { 
        keys.forEach(k => caches.delete(k)); 
      }).catch(()=>{}); 
    } catch(e){ 
      console.warn('cache clear err', e); 
    }
  }

}); // DOMContentLoaded end

// Additional helper functions for better form management
window.debugFormData = function() {
  console.log('=== DEBUG: Current form state ===');
  const formData = collectFormData();
  console.log('Form data:', formData);
  
  console.log('Checked main items:');
  document.querySelectorAll('.purchased:checked').forEach(cb => {
    console.log('  -', cb.id, cb.value);
  });
  
  console.log('Checked sub-items:');
  document.querySelectorAll('.subitem:checked').forEach(cb => {
    const qtyId = 'q' + cb.id.slice(3);
    const qtyEl = document.getElementById(qtyId);
    const qty = qtyEl ? qtyEl.value : 'N/A';
    console.log('  -', cb.id, cb.value, 'qty:', qty);
  });
  
  console.log('Payment modes:');
  document.querySelectorAll('input[name="modeOfPayment"]:checked').forEach(cb => {
    console.log('  -', cb.id, cb.value);
  });
  
  return formData;
};

window.testPhotoUpload = function() {
  console.log('Current photo URL:', uploadedPhotoUrl);
  if (uploadedPhotoUrl) {
    console.log('Photo is ready for submission');
  } else {
    console.log('No photo uploaded');
  }
};

// Enhanced form validation for better user experience
window.validateForm = function() {
  console.log('=== Running form validation ===');
  
  const issues = [];
  
  // Check main categories
  const anyMainChecked = Array.from(document.querySelectorAll('.purchased')).some(cb => cb.checked);
  if (!anyMainChecked) {
    issues.push('No main category selected');
  }
  
  // Check sub-items for each selected main category
  const mainCategories = ['p_floor', 'p_wall', 'p_san', 'p_acc'];
  mainCategories.forEach(mainId => {
    const mainEl = document.getElementById(mainId);
    if (mainEl && mainEl.checked) {
      const suffix = mainId.slice(2); // Remove 'p_' prefix
      const sublist = document.getElementById(`sublist_${suffix}`);
      if (sublist) {
        const hasCheckedSub = Array.from(sublist.querySelectorAll('.subitem')).some(s => s.checked);
        if (!hasCheckedSub) {
          issues.push(`${mainEl.value}: No sub-items selected`);
        }
      }
    }
  });
  
  // Check Others
  const othersMain = document.getElementById('p_other');
  if (othersMain && othersMain.checked) {
    const othersQty = document.getElementById('q_other');
    const othersText = document.getElementById('purchasedOtherText');
    const qty = othersQty ? othersQty.value : '';
    const text = othersText ? othersText.value : '';
    
    if (!qty && !text.trim()) {
      issues.push('Others: No quantity or description provided');
    }
  }
  
  // Check payment
  const paymentEl = document.getElementById('paymentPaid');
  const payment = paymentEl ? paymentEl.value : '';
  if (!payment || isNaN(Number(payment))) {
    issues.push('Invalid payment amount');
  }
  
  // Check payment modes
  const anyModeChecked = Array.from(document.querySelectorAll('input[name="modeOfPayment"]')).some(m => m.checked);
  if (!anyModeChecked) {
    issues.push('No payment mode selected');
  }
  
  console.log('Validation issues:', issues);
  return issues;
};

// Enhanced error handling and recovery
window.recoverFromError = function() {
  console.log('=== Attempting error recovery ===');
  
  // Reset submission state
  activeSubmissions.clear();
  
  // Re-enable submit button
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
  
  // Update status
  updateStatus();
  
  // Clear any error messages
  const msgEl = document.getElementById('msg');
  if (msgEl) {
    msgEl.style.display = 'none';
  }
  
  // Re-bind form handlers
  bindMainToSubHandlers();
  bindSubItemHandlers();
  bindOthersHandler();
  bindPaymentModeHandlers();
  
  console.log('Error recovery completed');
};

// Function to manually trigger sub-item visibility (for debugging)
window.showSubItems = function(mainId) {
  const mainCheckbox = document.getElementById(mainId);
  if (mainCheckbox) {
    mainCheckbox.checked = true;
    mainCheckbox.dispatchEvent(new Event('change'));
    console.log(`Manually triggered ${mainId} to show sub-items`);
  } else {
    console.warn(`Main checkbox ${mainId} not found`);
  }
};

// Function to test all form handlers
window.testFormHandlers = function() {
  console.log('=== Testing form handlers ===');
  
  // Test main category handlers
  ['p_floor', 'p_wall', 'p_san', 'p_acc', 'p_other'].forEach(mainId => {
    const mainEl = document.getElementById(mainId);
    if (mainEl) {
      console.log(`${mainId}: found, handler bound: ${!!mainEl._mainToSubHandler || !!mainEl._othersHandler}`);
    } else {
      console.warn(`${mainId}: not found`);
    }
  });
  
  // Test sub-item handlers
  const subItems = document.querySelectorAll('.subitem');
  console.log(`Found ${subItems.length} sub-items`);
  let handlerCount = 0;
  subItems.forEach(sub => {
    if (sub._subItemHandler) handlerCount++;
  });
  console.log(`${handlerCount}/${subItems.length} sub-items have handlers bound`);
  
  // Test payment mode handlers
  const paymentModes = document.querySelectorAll('input[name="modeOfPayment"]');
  console.log(`Found ${paymentModes.length} payment modes`);
  let paymentHandlerCount = 0;
  paymentModes.forEach(mode => {
    if (mode._paymentModeHandler) paymentHandlerCount++;
  });
  console.log(`${paymentHandlerCount}/${paymentModes.length} payment modes have handlers bound`);
};

// Auto-save functionality for form data
let autoSaveTimer = null;

function autoSaveFormData() {
  try {
    const formData = {
      purchasedItems: {},
      paymentPaid: document.getElementById('paymentPaid')?.value || '',
      otherInfo: document.getElementById('otherInfo')?.value || '',
      purchasedFrom: document.getElementById('purchasedFromSelect')?.value || '',
      photoUrl: uploadedPhotoUrl
    };
    
    // Save checked main items
    document.querySelectorAll('.purchased:checked').forEach(cb => {
      formData.purchasedItems[cb.id] = { checked: true, subitems: {} };
    });
    
    // Save sub-items and quantities
    document.querySelectorAll('.subitem:checked').forEach(cb => {
      const qtyId = 'q' + cb.id.slice(3);
      const qtyEl = document.getElementById(qtyId);
      const mainId = cb.id.includes('floor') ? 'p_floor' :
                   cb.id.includes('wall') ? 'p_wall' :
                   cb.id.includes('san') ? 'p_san' :
                   cb.id.includes('acc') ? 'p_acc' : 'p_other';
      
      if (!formData.purchasedItems[mainId]) {
        formData.purchasedItems[mainId] = { checked: false, subitems: {} };
      }
      
      formData.purchasedItems[mainId].subitems[cb.id] = {
        checked: true,
        quantity: qtyEl ? qtyEl.value : '',
        label: cb.value
      };
    });
    
    // Save payment modes
    formData.paymentModes = {};
    document.querySelectorAll('input[name="modeOfPayment"]:checked').forEach(cb => {
      const amountEl = document.getElementById(`amt_${cb.id}`) ||
                      cb.closest('.mode-row')?.querySelector('.mode-amount');
      formData.paymentModes[cb.id] = {
        checked: true,
        amount: amountEl ? amountEl.value : ''
      };
    });
    
    localStorage.setItem('tileapp_autosave', JSON.stringify(formData));
    console.log('Form data auto-saved');
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

function loadAutoSavedData() {
  try {
    const saved = localStorage.getItem('tileapp_autosave');
    if (!saved) return false;
    
    const formData = JSON.parse(saved);
    let restored = false;
    
    // Restore main items
    Object.keys(formData.purchasedItems || {}).forEach(mainId => {
      const mainEl = document.getElementById(mainId);
      const data = formData.purchasedItems[mainId];
      
      if (mainEl && data.checked) {
        mainEl.checked = true;
        restored = true;
        
        // Restore sub-items
        Object.keys(data.subitems || {}).forEach(subId => {
          const subEl = document.getElementById(subId);
          const subData = data.subitems[subId];
          
          if (subEl && subData.checked) {
            subEl.checked = true;
            
            // Restore quantity
            const qtyId = 'q' + subId.slice(3);
            const qtyEl = document.getElementById(qtyId);
            if (qtyEl && subData.quantity) {
              qtyEl.value = subData.quantity;
              qtyEl.disabled = false;
            }
          }
        });
      }
    });
    
    // Restore payment data
    if (formData.paymentPaid) {
      const paymentEl = document.getElementById('paymentPaid');
      if (paymentEl) paymentEl.value = formData.paymentPaid;
    }
    
    // Restore other info
    if (formData.otherInfo) {
      const otherEl = document.getElementById('otherInfo');
      if (otherEl) otherEl.value = formData.otherInfo;
    }
    
    // Restore purchased from
    if (formData.purchasedFrom) {
      const fromEl = document.getElementById('purchasedFromSelect');
      if (fromEl) fromEl.value = formData.purchasedFrom;
    }
    
    // Restore payment modes
    Object.keys(formData.paymentModes || {}).forEach(modeId => {
      const modeEl = document.getElementById(modeId);
      const modeData = formData.paymentModes[modeId];
      
      if (modeEl && modeData.checked) {
        modeEl.checked = true;
        
        const amountEl = document.getElementById(`amt_${modeId}`) ||
                        modeEl.closest('.mode-row')?.querySelector('.mode-amount');
        if (amountEl && modeData.amount) {
          amountEl.value = modeData.amount;
          amountEl.disabled = false;
        }
      }
    });
    
    // Restore photo
    if (formData.photoUrl) {
      uploadedPhotoUrl = formData.photoUrl;
    }
    
    if (restored) {
      console.log('Auto-saved data restored');
      showMessage('Previous form data restored');
      
      // Re-bind handlers and trigger change events after restoration
      setTimeout(() => {
        bindMainToSubHandlers();
        bindSubItemHandlers();
        bindOthersHandler();
        bindPaymentModeHandlers();
        
        // Trigger change events to update form state
        document.querySelectorAll('.purchased:checked').forEach(el => {
          el.dispatchEvent(new Event('change'));
        });
        document.querySelectorAll('input[name="modeOfPayment"]:checked').forEach(el => {
          el.dispatchEvent(new Event('change'));
        });
      }, 100);
      
      return true;
    }
  } catch (e) {
    console.warn('Auto-restore failed:', e);
  }
  
  return false;
}

function clearAutoSave() {
  try {
    localStorage.removeItem('tileapp_autosave');
    console.log('Auto-save data cleared');
  } catch (e) {
    console.warn('Failed to clear auto-save:', e);
  }
}

// Set up auto-save on form changes
document.addEventListener('change', function(e) {
  if (e.target && (
    e.target.matches('.purchased') ||
    e.target.matches('.subitem') ||
    e.target.matches('.qty') ||
    e.target.matches('input[name="modeOfPayment"]') ||
    e.target.matches('.mode-amount') ||
    e.target.matches('#paymentPaid') ||
    e.target.matches('#otherInfo') ||
    e.target.matches('#purchasedFromSelect')
  )) {
    // Debounce auto-save
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSaveFormData, 1000);
  }
});

// Expose utility functions
window.autoSaveFormData = autoSaveFormData;
window.loadAutoSavedData = loadAutoSavedData;
window.clearAutoSave = clearAutoSave;
window.bindMainToSubHandlers = bindMainToSubHandlers;
window.bindSubItemHandlers = bindSubItemHandlers;
window.bindOthersHandler = bindOthersHandler;
window.bindPaymentModeHandlers = bindPaymentModeHandlers;

// Ask user about restoring data on page load (but only once per session)
if (!sessionStorage.getItem('autoRestoreAsked')) {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
      const hasAutoSave = localStorage.getItem('tileapp_autosave');
      if (hasAutoSave) {
        if (confirm('Found unsaved form data from previous session. Restore it?')) {
          const restored = loadAutoSavedData();
          if (!restored) {
            clearAutoSave();
          }
        } else {
          clearAutoSave();
        }
      }
      sessionStorage.setItem('autoRestoreAsked', 'true');
    }, 2000); // Wait 2 seconds after page load
  });
}

console.log('=== TileApp JavaScript loaded successfully ===');

