// public/js/dashboard.js - Dashboard page
//
// Uses these endpoints (each returns a JSON array):
//   GET /api/products   -> [{ product_id, sku, name, quantity_on_hand, reorder_level, ... }]
//   GET /api/orders     -> [{ order_id, direction, party, order_date, status, total_amount }]
//   GET /api/companies  -> [{ company_id, name, ... }]

// Orders with these statuses are finished, everything else counts as "open"
const CLOSED_STATUSES = ['RECEIVED', 'SHIPPED', 'CANCELLED'];

async function loadDashboard() {
  clearMessage();
  try {
    const [products, orders, companies] = await Promise.all([
      apiGet('/products'),
      apiGet('/orders'),
      apiGet('/companies')
    ]);

    const lowStock = products.filter(p => Number(p.quantity_on_hand) <= Number(p.reorder_level));
    const openOrders = orders.filter(o => !CLOSED_STATUSES.includes(String(o.status).toUpperCase()));

    document.getElementById('stat-products').textContent = products.length;
    document.getElementById('stat-low-stock').textContent = lowStock.length;
    document.getElementById('stat-open-orders').textContent = openOrders.length;
    document.getElementById('stat-companies').textContent = companies.length;

    renderLowStock(lowStock);
    renderRecentOrders(orders);
  } catch (err) {
    showMessage('Could not load dashboard: ' + err.message, true);
  }
}

function renderLowStock(products) {
  const tbody = document.getElementById('low-stock-body');

  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">All products are above their reorder level.</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${escapeHtml(p.sku)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.quantity_on_hand)}</td>
      <td>${escapeHtml(p.reorder_level)}</td>
    </tr>
  `).join('');
}

// Show the 5 newest orders
function renderRecentOrders(orders) {
  const list = document.getElementById('recent-orders');

  if (orders.length === 0) {
    list.innerHTML = '<li class="empty">No orders yet.</li>';
    return;
  }

  const newest = [...orders]
    .sort((a, b) => String(b.order_date).localeCompare(String(a.order_date)))
    .slice(0, 5);

  list.innerHTML = newest.map(o => `
    <li>
      <span class="date">${formatDate(o.order_date)}</span>
      Order #${escapeHtml(o.order_id)}
      <span class="badge ${o.direction === 'in' ? 'in' : 'out'}">${escapeHtml(o.direction)}</span>
      ${escapeHtml(o.party)} · ${escapeHtml(String(o.status).toLowerCase())}
    </li>
  `).join('');
}

document.getElementById('refresh-btn').addEventListener('click', loadDashboard);
loadDashboard();
