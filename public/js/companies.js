// public/js/companies.js - Companies page
//
// Uses these endpoints:
//   GET    /api/companies                 -> [{ company_id, name, email, street, city, postal_code }]
//   POST   /api/companies                 body: { name, email, street, city, postal_code }
//   PUT    /api/companies/:id             same body
//   DELETE /api/companies/:id             (409 if the company still has orders)
//   GET    /api/companies/:id/phones      -> [{ contact_phone }]
//   POST   /api/companies/:id/phones      body: { contact_phone }
//   DELETE /api/companies/:id/phones/:phone

let companies = [];
let phonesById = {};
let editingId = null;

const form = document.getElementById('company-form');
const tbody = document.getElementById('companies-body');

async function loadCompanies() {
  try {
    companies = await apiGet('/companies');
    const lists = await Promise.all(
      companies.map(c => apiGet('/companies/' + c.company_id + '/phones'))
    );
    phonesById = {};
    companies.forEach((c, i) => {
      phonesById[c.company_id] = lists[i].map(row => row.contact_phone);
    });
    renderCompanies();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Could not load companies.</td></tr>';
    showMessage('Could not load companies: ' + err.message, true);
  }
}

function renderCompanies() {
  const term = document.getElementById('search').value.trim().toLowerCase();
  const rows = companies.filter(c =>
    !term || [c.name, c.email, c.city].some(v => String(v).toLowerCase().includes(term))
  );

  if (rows.length === 0) {
    const text = companies.length === 0 ? 'No companies yet. Add the first one above.' : 'No companies match your search.';
    tbody.innerHTML = '<tr><td colspan="6" class="empty">' + text + '</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(c => {
    const id = Number(c.company_id);
    const chips = (phonesById[id] || []).map(phone => `
      <span class="chip">${escapeHtml(phone)}
        <button type="button" class="chip-x" title="Remove phone"
                data-action="remove-phone" data-id="${id}" data-phone="${escapeHtml(phone)}">×</button>
      </span>`).join('');

    return `
      <tr>
        <td>${id}</td>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.email)}</td>
        <td>${escapeHtml(c.street)}, ${escapeHtml(c.city)} ${escapeHtml(c.postal_code)}</td>
        <td class="phones-cell">
          ${chips}
          <form class="phone-form" data-id="${id}">
            <input name="contact_phone" type="tel" placeholder="Add phone" maxlength="20" required>
            <button type="submit" class="btn-small">Add</button>
          </form>
        </td>
        <td class="actions">
          <button type="button" class="btn-small" data-action="edit" data-id="${id}">Edit</button>
          <button type="button" class="btn-small" data-action="delete" data-id="${id}">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

// ---------- add / edit form ----------

function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById('form-title').textContent = 'Add company';
  document.getElementById('save-btn').textContent = 'Add company';
  document.getElementById('cancel-btn').hidden = true;
}

function startEdit(id) {
  const c = companies.find(item => Number(item.company_id) === id);
  if (!c) return;
  editingId = id;
  for (const field of ['name', 'email', 'street', 'city', 'postal_code']) {
    form.elements[field].value = c[field] ?? '';
  }
  document.getElementById('form-title').textContent = 'Edit company #' + id;
  document.getElementById('save-btn').textContent = 'Save changes';
  document.getElementById('cancel-btn').hidden = false;
  clearMessage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  form.elements.name.focus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  for (const key of Object.keys(data)) data[key] = data[key].trim();

  try {
    if (editingId) {
      await apiSend('PUT', '/companies/' + editingId, data);
      showMessage('Company #' + editingId + ' updated.', false);
    } else {
      await apiSend('POST', '/companies', data);
      showMessage('Company added.', false);
    }
    resetForm();
    loadCompanies();
  } catch (err) {
    showMessage('Could not save company: ' + err.message, true);
  }
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  resetForm();
  clearMessage();
});

document.getElementById('search').addEventListener('input', renderCompanies);

// ---------- table actions (edit / delete / phones) ----------

async function deleteCompany(id) {
  if (!confirm('Delete company #' + id + '? This cannot be undone.')) return;
  try {
    await apiSend('DELETE', '/companies/' + id);
    showMessage('Company #' + id + ' deleted.', false);
    if (editingId === id) resetForm();
    loadCompanies();
  } catch (err) {
    showMessage('Could not delete company: ' + err.message, true);
  }
}

async function addPhone(id, phone) {
  try {
    await apiSend('POST', '/companies/' + id + '/phones', { contact_phone: phone });
    showMessage('Phone added.', false);
    loadCompanies();
  } catch (err) {
    showMessage('Could not add phone: ' + err.message, true);
  }
}

async function removePhone(id, phone) {
  try {
    await apiSend('DELETE', '/companies/' + id + '/phones/' + encodeURIComponent(phone));
    showMessage('Phone removed.', false);
    loadCompanies();
  } catch (err) {
    showMessage('Could not remove phone: ' + err.message, true);
  }
}

tbody.addEventListener('click', event => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit') startEdit(id);
  if (btn.dataset.action === 'delete') deleteCompany(id);
  if (btn.dataset.action === 'remove-phone') removePhone(id, btn.dataset.phone);
});

tbody.addEventListener('submit', event => {
  if (!event.target.matches('.phone-form')) return;
  event.preventDefault();
  const phone = event.target.elements.contact_phone.value.trim();
  if (phone) addPhone(Number(event.target.dataset.id), phone);
});

loadCompanies();
