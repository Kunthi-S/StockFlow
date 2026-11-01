// public/js/products.js - Products page
//
// Uses these endpoints:
//   GET    /api/products             -> [{ product_id, sku, name, category, standard_cost, reorder_level,
//                                          quantity_on_hand, type, is_hazardous, is_perishable }]
//   GET    /api/products/:id         -> product + { packaged|weighed|counted, hazardous, perishable{lots}, locations[] }
//   GET    /api/products/locations   -> [{ location_id, code, aisle, capacity_units, units_stored }]
//   POST   /api/products             body: { sku, name, category, standard_cost, reorder_level,
//                                            <type>: {...}, hazardous?: {...}, perishable?: { shelf_life_days, lots },
//                                            locations: [{ code, aisle?, capacity_units?, quantity_at_location }] }
//   PUT    /api/products/:id         same body; hazardous / perishable = null removes them
//   DELETE /api/products/:id         (409 if the product is used in orders)
//
// quantity_on_hand is maintained by the database, so the form never sets it.

let products = [];
let knownLocations = [];
let editingId = null;

const form = document.getElementById('product-form');
const tbody = document.getElementById('products-body');
const TYPES = ['packaged', 'weighed', 'counted'];

// ---------- loading & table ----------

async function loadProducts() {
  try {
    products = await apiGet('/products');
    renderCategories();
    renderProducts();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Could not load products.</td></tr>';
    showMessage('Could not load products: ' + err.message, true);
  }
}

async function loadLocations() {
  try {
    knownLocations = await apiGet('/products/locations');
    document.getElementById('location-codes').innerHTML =
      knownLocations.map(l => `<option value="${escapeHtml(l.code)}">`).join('');
  } catch (err) {
    knownLocations = [];
  }
}

function renderCategories() {
  const categories = [...new Set(products.map(p => p.category))].sort();
  document.getElementById('category-list').innerHTML =
    categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function isLow(p) {
  return Number(p.quantity_on_hand) <= Number(p.reorder_level);
}

function renderProducts() {
  const term = document.getElementById('search').value.trim().toLowerCase();
  const type = document.getElementById('type-filter').value;
  const lowOnly = document.getElementById('low-only').checked;

  const rows = products.filter(p =>
    (!term || [p.sku, p.name, p.category].some(v => String(v).toLowerCase().includes(term))) &&
    (!type || p.type === type) &&
    (!lowOnly || isLow(p))
  );

  if (rows.length === 0) {
    const text = products.length === 0 ? 'No products yet. Add the first one above.' : 'No products match your filters.';
    tbody.innerHTML = '<tr><td colspan="9" class="empty">' + text + '</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(p => {
    const id = Number(p.product_id);
    const flags = [
      Number(p.is_hazardous) ? '<span class="badge danger">hazardous</span>' : '',
      Number(p.is_perishable) ? '<span class="badge warn">perishable</span>' : ''
    ].join(' ');
    return `
      <tr>
        <td>${escapeHtml(p.sku)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td><span class="badge type">${escapeHtml(p.type)}</span></td>
        <td>${flags || '–'}</td>
        <td class="${isLow(p) ? 'low' : ''}">${escapeHtml(p.quantity_on_hand)}</td>
        <td>${escapeHtml(p.reorder_level)}</td>
        <td>${formatMoney(p.standard_cost)}</td>
        <td class="actions">
          <button type="button" class="btn-small" data-action="edit" data-id="${id}">Edit</button>
          <button type="button" class="btn-small" data-action="delete" data-id="${id}">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

// ---------- form: show only the groups that apply ----------

function setGroup(name, on) {
  const fieldset = document.getElementById('group-' + name);
  fieldset.hidden = !on;
  fieldset.disabled = !on;   // disabled fields are skipped by validation and by buildBody()
}

function syncGroups() {
  const type = form.elements.type.value;
  TYPES.forEach(t => setGroup(t, t === type));
  setGroup('hazardous', form.elements.is_hazardous.checked);
  setGroup('perishable', form.elements.is_perishable.checked);
}

form.elements.type.addEventListener('change', syncGroups);
form.elements.is_hazardous.addEventListener('change', syncGroups);
form.elements.is_perishable.addEventListener('change', syncGroups);

// ---------- form: lot and location rows ----------

// "2026-09-03T17:00:00.000Z" -> "2026-09-04" (local date, so it matches the date the user sees)
function toDateInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addLotRow(lot = {}) {
  const row = document.createElement('div');
  row.className = 'row-line lot-row';
  row.innerHTML = `
    <label>Lot no.
      <input data-f="lot_no" type="text" maxlength="50" value="${escapeHtml(lot.lot_no)}" required>
    </label>
    <label>Received
      <input data-f="received_date" type="date" value="${toDateInput(lot.received_date)}" required>
    </label>
    <label>Expiry (optional)
      <input data-f="expiry_date" type="date" value="${toDateInput(lot.expiry_date)}">
    </label>
    <label>Quantity left
      <input data-f="quantity_remaining" type="number" min="0" step="any" value="${escapeHtml(lot.quantity_remaining ?? 0)}">
    </label>
    <button type="button" class="btn-small" data-remove-row>Remove</button>`;
  document.getElementById('lot-rows').appendChild(row);
}

function addLocationRow(loc = {}) {
  const row = document.createElement('div');
  row.className = 'row-line loc-row';
  row.innerHTML = `
    <label>Location code
      <input data-f="code" type="text" list="location-codes" maxlength="30" value="${escapeHtml(loc.code)}" required>
    </label>
    <label>Aisle (new only)
      <input data-f="aisle" type="text" maxlength="20" value="${escapeHtml(loc.aisle)}">
    </label>
    <label>Capacity (new only)
      <input data-f="capacity_units" type="number" min="0" step="any" value="${escapeHtml(loc.capacity_units)}">
    </label>
    <label>Quantity here
      <input data-f="quantity_at_location" type="number" min="0" step="any" value="${escapeHtml(loc.quantity_at_location ?? 0)}" required>
    </label>
    <button type="button" class="btn-small" data-remove-row>Remove</button>`;
  document.getElementById('location-rows').appendChild(row);
}

// Read every [data-f] input of the rows matching selector into plain objects
function readRows(selector) {
  return [...form.querySelectorAll(selector)].map(row => {
    const obj = {};
    row.querySelectorAll('[data-f]').forEach(input => {
      if (input.value === '') return;                       // blank = not sent
      obj[input.dataset.f] = input.type === 'number' ? Number(input.value) : input.value.trim();
    });
    return obj;
  });
}

document.getElementById('add-lot-btn').addEventListener('click', () => addLotRow());
document.getElementById('add-location-btn').addEventListener('click', () => addLocationRow());

form.addEventListener('click', event => {
  const btn = event.target.closest('[data-remove-row]');
  if (btn) btn.closest('.row-line').remove();
});

// Picking an existing location code fills in its aisle and capacity
form.addEventListener('input', event => {
  const input = event.target;
  if (input.dataset.f !== 'code') return;
  const known = knownLocations.find(l => l.code === input.value.trim());
  if (!known) return;
  const row = input.closest('.loc-row');
  row.querySelector('[data-f="aisle"]').value = known.aisle ?? '';
  row.querySelector('[data-f="capacity_units"]').value = known.capacity_units ?? '';
});

// ---------- form: build the request body ----------

// Fields named "group.field" (e.g. packaged.units_per_pack) -> { group: { field: value } }
function collectGroups() {
  const groups = {};
  for (const el of form.elements) {
    if (!el.name || !el.name.includes('.') || el.matches(':disabled')) continue;
    const [group, field] = el.name.split('.');
    groups[group] = groups[group] || {};
    if (el.type === 'checkbox') groups[group][field] = el.checked ? 1 : 0;
    else if (el.value === '') groups[group][field] = null;
    else groups[group][field] = el.type === 'number' ? Number(el.value) : el.value.trim();
  }
  return groups;
}

function buildBody() {
  const f = form.elements;
  const groups = collectGroups();
  const type = f.type.value;

  const body = {
    sku: f.sku.value.trim(),
    name: f.name.value.trim(),
    category: f.category.value.trim(),
    standard_cost: Number(f.standard_cost.value),
    reorder_level: Number(f.reorder_level.value),
    hazardous: f.is_hazardous.checked ? groups.hazardous : null,
    perishable: f.is_perishable.checked
      ? { ...groups.perishable, lots: readRows('.lot-row') }
      : null,
    locations: readRows('.loc-row')
  };
  body[type] = groups[type];
  return body;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (editingId) {
      await apiSend('PUT', '/products/' + editingId, buildBody());
      showMessage('Product #' + editingId + ' updated.', false);
    } else {
      await apiSend('POST', '/products', buildBody());
      showMessage('Product added.', false);
    }
    resetForm();
    loadProducts();
    loadLocations();
  } catch (err) {
    showMessage('Could not save product: ' + err.message, true);
  }
});

// ---------- edit / delete ----------

function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById('lot-rows').innerHTML = '';
  document.getElementById('location-rows').innerHTML = '';
  document.getElementById('form-title').textContent = 'Add product';
  document.getElementById('save-btn').textContent = 'Add product';
  document.getElementById('cancel-btn').hidden = true;
  syncGroups();
}

async function startEdit(id) {
  try {
    const p = await apiGet('/products/' + id);
    resetForm();
    editingId = id;
    const f = form.elements;

    for (const field of ['sku', 'name', 'category', 'standard_cost', 'reorder_level']) {
      f[field].value = p[field] ?? '';
    }
    f.type.value = p.type || 'packaged';
    f.is_hazardous.checked = !!p.hazardous;
    f.is_perishable.checked = !!p.perishable;

    // fill packaged.* / weighed.* / counted.* / hazardous.* / perishable.* fields
    for (const el of form.elements) {
      if (!el.name || !el.name.includes('.')) continue;
      const [group, field] = el.name.split('.');
      const value = p[group] ? p[group][field] : null;
      if (el.type === 'checkbox') el.checked = !!Number(value);
      else el.value = value ?? '';
    }

    (p.perishable?.lots || []).forEach(addLotRow);
    (p.locations || []).forEach(addLocationRow);
    syncGroups();

    document.getElementById('form-title').textContent = 'Edit product #' + id;
    document.getElementById('save-btn').textContent = 'Save changes';
    document.getElementById('cancel-btn').hidden = false;
    clearMessage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showMessage('Could not load product: ' + err.message, true);
  }
}

async function deleteProduct(id) {
  if (!confirm('Delete product #' + id + '? This cannot be undone.')) return;
  try {
    await apiSend('DELETE', '/products/' + id);
    showMessage('Product #' + id + ' deleted.', false);
    if (editingId === id) resetForm();
    loadProducts();
  } catch (err) {
    showMessage('Could not delete product: ' + err.message, true);
  }
}

tbody.addEventListener('click', event => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit') startEdit(id);
  if (btn.dataset.action === 'delete') deleteProduct(id);
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  resetForm();
  clearMessage();
});

document.getElementById('search').addEventListener('input', renderProducts);
document.getElementById('type-filter').addEventListener('change', renderProducts);
document.getElementById('low-only').addEventListener('change', renderProducts);

syncGroups();
loadProducts();
loadLocations();
