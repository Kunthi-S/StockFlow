// public/app.js - SHARED code used by every page (sidebar + API helpers).
// Load this file BEFORE the page's own script, e.g. in pages/orders.html:
//   <script src="../app.js"></script>
//   <script src="../js/orders.js"></script>
// Talk to the other frontend person before changing this file.

const API_BASE = '/api';

// Sidebar links (all pages live in public/pages/). To add a new page, add one line here.
const PAGES = [
  { file: 'dashboard.html', label: 'Dashboard' },
  { file: 'orders.html',    label: 'Orders' }
];

// Fills <aside id="sidebar"></aside> and highlights the current page
function renderSidebar() {
  const current = location.pathname.split('/').pop();

  const links = PAGES.map(p => {
    const active = p.file === current ? ' class="active"' : '';
    return `<a href="${p.file}"${active}>${p.label}</a>`;
  }).join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="brand">
      <div class="logo">◆ StockFlow</div>
      <div class="tagline">warehouse &amp; order control</div>
    </div>
    <nav>${links}</nav>
    <div id="api-status" class="api-status">Checking API…</div>
  `;
}

// GET /api/... and return the JSON body
async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// POST / PUT / DELETE /api/... with an optional JSON body
async function apiSend(method, path, body) {
  const options = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(API_BASE + path, options);
  if (!res.ok) throw new Error(await readError(res));

  // DELETE often returns no body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Turn a failed response into a readable message (e.g. 400 / 409 from the server)
async function readError(res) {
  try {
    const data = await res.json();
    return data.error || data.message || res.statusText;
  } catch (e) {
    return 'Request failed (' + res.status + ')';
  }
}

// Show a green or red message box. The page needs <p id="message" class="message"></p>
function showMessage(text, isError) {
  const box = document.getElementById('message');
  box.textContent = text;
  box.className = 'message ' + (isError ? 'error' : 'success');
}

function clearMessage() {
  const box = document.getElementById('message');
  box.textContent = '';
  box.className = 'message';
}

// Escape text before putting it inside innerHTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 1234.5 -> "1,234.50"
function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "2026-09-04T00:00:00.000Z" -> "2026-09-04"
function formatDate(value) {
  return value ? String(value).slice(0, 10) : '–';
}

// Sidebar status: calls GET /api/health
async function checkApi() {
  const status = document.getElementById('api-status');
  try {
    await apiGet('/health');
    status.textContent = 'API connected';
    status.className = 'api-status ok';
  } catch (e) {
    status.textContent = 'API disconnected';
    status.className = 'api-status down';
  }
}

renderSidebar();
checkApi();
