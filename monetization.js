'use strict';

// Auth guard
if (!requireAuth()) throw new Error('not authenticated');

const user = getUser();
if (user) document.getElementById('topbarUser').textContent = user.name || user.email || '';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const configAlert   = document.getElementById('configAlert');
const listAlert      = document.getElementById('listAlert');
const subBody        = document.getElementById('subBody');
const modal          = document.getElementById('modal');
const modalAlert     = document.getElementById('modalAlert');
const modalPartner   = document.getElementById('modalPartner');

let overridePartnerId = '';

// ── Helpers ─────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showAlert(el, msg, type = 'info') {
  el.className = 'alert alert-' + type;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 6000);
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Config: load + save ───────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await apiFetch('/api/admin/settings/monetization');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    document.getElementById('fSubscription').value = data.partner_subscription_amount ?? 299;
    document.getElementById('fCommission').value = data.cleaning_commission_percent ??
      Math.round((data.cleaning_commission_rate ?? 0.25) * 100);
    document.getElementById('fTrial').value = data.partner_free_trial_days ?? 10;
  } catch (err) {
    if (err.message !== 'Session expired') showAlert(configAlert, 'Settings load nahi hui: ' + err.message, 'warn');
  }
}

document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveConfigBtn');
  const amount  = parseFloat(document.getElementById('fSubscription').value);
  const percent = parseFloat(document.getElementById('fCommission').value);
  const days    = parseInt(document.getElementById('fTrial').value, 10);

  if (isNaN(amount) || amount < 0) return showAlert(configAlert, 'Valid subscription amount daalo.', 'error');
  if (isNaN(percent) || percent < 0 || percent > 100) return showAlert(configAlert, 'Commission 0–100% ke beech hona chahiye.', 'error');
  if (isNaN(days) || days < 0) return showAlert(configAlert, 'Valid trial days daalo.', 'error');

  btn.disabled = true;
  const old = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    const res = await apiFetch('/api/admin/settings/monetization', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_subscription_amount: amount,
        cleaning_commission_percent: percent,
        partner_free_trial_days: days
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    showAlert(configAlert, 'Settings saved. Naye partners aur dispatch inhi values ko use karenge.', 'success');
  } catch (err) {
    showAlert(configAlert, 'Save fail: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});

// ── Partner subscriptions: load + render ──────────────────────────────────────
async function loadSubscriptions() {
  subBody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Loading…</td></tr>';
  const params = new URLSearchParams();
  const search = document.getElementById('fSearch').value.trim();
  const model  = document.getElementById('fModel').value;
  const status = document.getElementById('fStatus').value;
  if (search) params.set('search', search);
  if (model)  params.set('model', model);
  if (status) params.set('status', status);

  try {
    const res = await apiFetch('/api/admin/partner-subscriptions?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderSubscriptions(data.partners || []);
  } catch (err) {
    if (err.message !== 'Session expired') showAlert(listAlert, 'List load nahi hui: ' + err.message, 'warn');
    subBody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Load failed.</td></tr>';
  }
}

function statusBadge(status) {
  if (status === 'active') return '<span class="badge badge-active">Active</span>';
  if (status === 'trial')  return '<span class="badge badge-published">Trial</span>';
  return '<span class="badge badge-inactive">Expired</span>';
}

function renderSubscriptions(rows) {
  if (!rows.length) {
    subBody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Koi partner nahi mila.</td></tr>';
    return;
  }
  subBody.innerHTML = rows.map(r => {
    const name = r.name || '(no name)';
    const code = r.partnerCode || '';
    const modelLabel = r.billingModel === 'commission' ? 'Commission' : 'Subscription';
    const trialLeft = r.withinTrial ? (r.trialDaysRemaining + 'd') : '—';
    const expires = r.billingModel === 'subscription' ? fmtDate(r.subscriptionExpiresAt) : '—';
    return `<tr>
      <td><strong>${esc(name)}</strong><br><span style="color:var(--muted);font-size:11px">${esc(code)}</span></td>
      <td>${modelLabel}</td>
      <td>${statusBadge(r.subscriptionStatus)}</td>
      <td>${esc(trialLeft)}</td>
      <td>${esc(expires)}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openOverride('${esc(r.partnerId)}','${esc(name)} (${esc(code)})')">Override</button></td>
    </tr>`;
  }).join('');
}

document.getElementById('applyFiltersBtn').addEventListener('click', loadSubscriptions);
document.getElementById('refreshBtn').addEventListener('click', loadSubscriptions);

// ── Override modal ────────────────────────────────────────────────────────────
function openOverride(partnerId, label) {
  overridePartnerId = partnerId;
  modalPartner.textContent = label;
  document.getElementById('oExtendMonths').value = '';
  document.getElementById('oExtendTrialDays').value = '';
  document.getElementById('oExpiresAt').value = '';
  modalAlert.classList.add('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeOverride() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  overridePartnerId = '';
}
document.getElementById('modalClose').addEventListener('click', closeOverride);
document.getElementById('cancelBtn').addEventListener('click', closeOverride);
modal.addEventListener('click', e => { if (e.target === modal) closeOverride(); });

document.getElementById('applyOverrideBtn').addEventListener('click', async () => {
  if (!overridePartnerId) return;
  const body = {};
  const months = document.getElementById('oExtendMonths').value.trim();
  const trial  = document.getElementById('oExtendTrialDays').value.trim();
  const expiry = document.getElementById('oExpiresAt').value.trim();
  if (months) body.extendSubscriptionMonths = parseFloat(months);
  if (trial)  body.extendTrialDays = parseFloat(trial);
  if (expiry) body.subscriptionExpiresAt = new Date(expiry + 'T00:00:00+05:30').toISOString();

  if (!Object.keys(body).length) {
    return showAlert(modalAlert, 'Kam se kam ek field bharo.', 'error');
  }

  const btn = document.getElementById('applyOverrideBtn');
  btn.disabled = true;
  const old = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Applying…';
  try {
    const res = await apiFetch('/api/admin/partners/' + encodeURIComponent(overridePartnerId) + '/subscription', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    closeOverride();
    showAlert(listAlert, 'Partner subscription updated.', 'success');
    loadSubscriptions();
  } catch (err) {
    showAlert(modalAlert, 'Apply fail: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});

// Expose for inline onclick
window.openOverride = openOverride;

// ── Init ──────────────────────────────────────────────────────────────────────
loadConfig();
loadSubscriptions();
