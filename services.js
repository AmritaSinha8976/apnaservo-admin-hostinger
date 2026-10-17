'use strict';

// Auth guard
if (!requireAuth()) throw new Error('not authenticated');

const user = getUser();
if (user) document.getElementById('topbarUser').textContent = user.name || user.email || '';

// ── localStorage helpers ──────────────────────────────────────────────────────
const LOCAL_KEY = 'apnaservo_admin_services_local';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}
function saveLocal(map) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(map));
}

// ── State ─────────────────────────────────────────────────────────────────────
let services  = [];
let editingId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const listEl     = document.getElementById('serviceList');
const listAlert  = document.getElementById('listAlert');
const modal      = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalAlert = document.getElementById('modalAlert');
const saveBtn    = document.getElementById('saveBtn');
const cancelBtn  = document.getElementById('cancelBtn');
const modalClose = document.getElementById('modalClose');

// ── Fetch from backend ────────────────────────────────────────────────────────
async function fetchServices() {
  try {
    const res = await apiFetch('/api/admin/services');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.rows || []).filter(r => {
      const cat = String(r.category || r.serviceCategory || '').toLowerCase();
      return cat.includes('clean');
    });
  } catch (err) {
    if (err.message !== 'Session expired') {
      showListAlert('Backend se load nahi hua: ' + err.message + ' — locally saved services dikh rahe hain.', 'warn');
    }
    return [];
  }
}

// ── Merge backend + localStorage ─────────────────────────────────────────────
function mergeWithLocal(backendRows) {
  const local = loadLocal();
  const merged = backendRows.map(r => {
    const id = r.id || r._id || r.category || r.serviceCategory;
    const ov = local[id] || {};
    return {
      id,
      name:          ov.name          ?? r.name          ?? '',
      category:      r.category       || r.serviceCategory || '',
      price:         ov.price         ?? r.basePrice      ?? 0,
      originalPrice: ov.originalPrice ?? null,
      offerPrice:    ov.offerPrice    ?? null,
      active:        ov.active        ?? (r.active !== false),
      published:     ov.published     ?? (r.active !== false),
      includedItems: ov.includedItems ?? [],
      excludedItems: ov.excludedItems ?? [],
      _source: 'backend'
    };
  });
  // Locally created services
  for (const [id, ov] of Object.entries(local)) {
    if (!merged.find(s => s.id === id) && ov._localOnly) {
      merged.push({ ...ov, id, _source: 'local' });
    }
  }
  return merged;
}

// ── Render list ───────────────────────────────────────────────────────────────
function renderList() {
  if (!services.length) {
    listEl.innerHTML = `<div class="empty-state">
      <p>Koi cleaning service nahi mili.</p>
      <p><strong>+ Add Service</strong> se naya banao.</p>
    </div>`;
    return;
  }
  listEl.innerHTML = services.map(s => `
    <div class="service-row" data-id="${esc(s.id)}">
      <div style="flex:1;min-width:140px">
        <div class="service-name">${esc(s.name)}</div>
        <div class="service-meta">
          ${s.category ? esc(s.category) + ' · ' : ''}
          ₹${s.price}
          ${s.offerPrice    ? `<span style="color:var(--success)"> → ₹${s.offerPrice}</span>` : ''}
          ${s.originalPrice ? `<span style="text-decoration:line-through;color:var(--muted)"> ₹${s.originalPrice}</span>` : ''}
        </div>
      </div>
      <span class="badge ${s.active    ? 'badge-active'    : 'badge-inactive'}">${s.active    ? 'Active'    : 'Inactive'}</span>
      <span class="badge ${s.published ? 'badge-published' : 'badge-inactive'}">${s.published ? 'Published' : 'Unpublished'}</span>
      <div class="service-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEdit('${esc(s.id)}')">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="togglePublish('${esc(s.id)}')">${s.published ? 'Unpublish' : 'Publish'}</button>
      </div>
    </div>
  `).join('');
}

// ── Publish / Unpublish ───────────────────────────────────────────────────────
function togglePublish(id) {
  const svc = services.find(s => s.id === id);
  if (!svc) return;
  svc.published = !svc.published;
  persistLocal(svc);
  renderList();
  showListAlert(`"${svc.name}" ${svc.published ? 'publish' : 'unpublish'} ho gaya (locally).`, 'info');
}

// ── Persist to localStorage ───────────────────────────────────────────────────
function persistLocal(svc) {
  const local = loadLocal();
  local[svc.id] = {
    name:          svc.name,
    category:      svc.category,
    price:         svc.price,
    originalPrice: svc.originalPrice,
    offerPrice:    svc.offerPrice,
    active:        svc.active,
    published:     svc.published,
    includedItems: svc.includedItems,
    excludedItems: svc.excludedItems,
    _localOnly:    svc._source === 'local'
  };
  saveLocal(local);
}

// ── Modal open/close ──────────────────────────────────────────────────────────
function openModal()  { modal.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal() { modal.classList.add('hidden');    document.body.style.overflow = '';       editingId = null; }

modalClose.addEventListener('click', closeModal);
cancelBtn.addEventListener('click',  closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

document.getElementById('addBtn').addEventListener('click', () => {
  editingId = null;
  modalTitle.textContent = 'Add Service';
  clearForm();
  hideModalAlert();
  openModal();
});

function openEdit(id) {
  const svc = services.find(s => s.id === id);
  if (!svc) return;
  editingId = id;
  modalTitle.textContent = 'Edit Service';
  populateForm(svc);
  hideModalAlert();
  openModal();
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function clearForm() {
  ['fName','fCategory','fPrice','fOriginalPrice','fOfferPrice'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).classList.remove('error');
  });
  document.getElementById('fActive').checked = true;
  renderChecklistItems('includedItems', []);
  renderChecklistItems('excludedItems', []);
  ['fNameErr','fCategoryErr','fPriceErr'].forEach(id => document.getElementById(id).classList.add('hidden'));
}

function populateForm(svc) {
  document.getElementById('fName').value          = svc.name          || '';
  document.getElementById('fCategory').value      = svc.category      || '';
  document.getElementById('fPrice').value         = svc.price         ?? '';
  document.getElementById('fOriginalPrice').value = svc.originalPrice ?? '';
  document.getElementById('fOfferPrice').value    = svc.offerPrice    ?? '';
  document.getElementById('fActive').checked      = svc.active !== false;
  renderChecklistItems('includedItems', svc.includedItems || []);
  renderChecklistItems('excludedItems', svc.excludedItems || []);
  ['fName','fCategory','fPrice'].forEach(id => {
    document.getElementById(id).classList.remove('error');
    document.getElementById(id + 'Err').classList.add('hidden');
  });
}

function showFieldError(fieldId, msg) {
  document.getElementById(fieldId).classList.add('error');
  const el = document.getElementById(fieldId + 'Err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showModalAlert(msg, type = 'error') {
  modalAlert.className = 'alert alert-' + type;
  modalAlert.textContent = msg;
  modalAlert.classList.remove('hidden');
}
function hideModalAlert() { modalAlert.classList.add('hidden'); }

function showListAlert(msg, type = 'info') {
  listAlert.className = 'alert alert-' + type;
  listAlert.textContent = msg;
  listAlert.classList.remove('hidden');
  clearTimeout(listAlert._t);
  listAlert._t = setTimeout(() => listAlert.classList.add('hidden'), 6000);
}

// ── Checklist rendering ───────────────────────────────────────────────────────
function renderChecklistItems(containerId, items) {
  document.getElementById(containerId).innerHTML = '';
  items.forEach(text => addChecklistRow(containerId, text));
}

function addChecklistRow(containerId, value = '') {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'checklist-item';
  row.innerHTML = `
    <input type="text" placeholder="Item likho…" value="${esc(value)}">
    <button type="button" class="btn-icon" aria-label="Remove">×</button>
  `;
  row.querySelector('.btn-icon').addEventListener('click', () => row.remove());
  container.appendChild(row);
  row.querySelector('input').focus();
}

document.getElementById('addIncluded').addEventListener('click', () => addChecklistRow('includedItems'));
document.getElementById('addExcluded').addEventListener('click', () => addChecklistRow('excludedItems'));

function collectItems(containerId) {
  return [...document.getElementById(containerId).querySelectorAll('input[type=text]')]
    .map(i => i.value.trim()).filter(Boolean);
}

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  hideModalAlert();
  ['fName','fCategory','fPrice'].forEach(id => {
    document.getElementById(id).classList.remove('error');
    document.getElementById(id + 'Err').classList.add('hidden');
  });

  const name     = document.getElementById('fName').value.trim();
  const category = document.getElementById('fCategory').value.trim().toLowerCase().replace(/\s+/g, '_');
  const price    = parseFloat(document.getElementById('fPrice').value);
  const origP    = document.getElementById('fOriginalPrice').value.trim();
  const offerP   = document.getElementById('fOfferPrice').value.trim();
  const active   = document.getElementById('fActive').checked;

  let ok = true;
  if (!name)                        { showFieldError('fName',     'Service name zaroori hai.');          ok = false; }
  if (!category)                    { showFieldError('fCategory', 'Category slug zaroori hai.');         ok = false; }
  if (isNaN(price) || price < 0)    { showFieldError('fPrice',    'Valid price daalo (0 ya zyada).');    ok = false; }
  if (!ok) return;

  if (!editingId && services.find(s => s.category === category)) {
    showFieldError('fCategory', 'Is category slug ki service pehle se hai.');
    return;
  }

  const svcData = {
    name, category, price,
    originalPrice: origP  ? parseFloat(origP)  : null,
    offerPrice:    offerP ? parseFloat(offerP) : null,
    active,
    published:     active,
    includedItems: collectItems('includedItems'),
    excludedItems: collectItems('excludedItems')
  };

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    if (editingId) {
      const idx = services.findIndex(s => s.id === editingId);
      services[idx] = { ...services[idx], ...svcData };
      persistLocal(services[idx]);
    } else {
      const id = 'local_' + Date.now();
      const newSvc = { id, _source: 'local', ...svcData };
      services.push(newSvc);
      persistLocal(newSvc);
    }
    renderList();
    closeModal();
    showListAlert(`"${name}" locally save ho gaya. ⚠️ Database mein nahi gaya — backend endpoint chahiye.`, 'info');
  } catch (err) {
    showModalAlert('Error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Service';
  }
});

// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  listEl.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  const backendRows = await fetchServices();
  services = mergeWithLocal(backendRows);
  renderList();
}

init();
