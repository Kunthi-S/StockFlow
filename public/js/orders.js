// public/js/orders.js - Orders page
//
// Uses these endpoints:
//   GET    /api/orders      -> [{ order_id, direction ('in'|'out'), party, order_date, status, total_amount }]
//   POST   /api/orders      body: { direction: 'out', customer_id, required_ship_date, ship_to_address, product_id, quantity, unit_price }
//                           or   { direction: 'in',  supplier_id, expected_arrival_date, product_id, quantity, unit_price }
//   DELETE /api/orders/:id

async function loadOrders() {
  const tbody = document.getElementById('orders-body');
  try {
    const orders = await apiGet('/orders');
    renderOrders(orders);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Could not load orders.</td></tr>';
    showMessage('Could not load orders: ' + err.message, true);
  }
}

function renderOrders(orders) {
  const tbody = document.getElementById('orders-body');

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No orders yet.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>${escapeHtml(o.order_id)}</td>
      <td><span class="badge ${o.direction === 'in' ? 'in' : 'out'}">${escapeHtml(o.direction)}</span></td>
      <td>${escapeHtml(o.party)}</td>
      <td>${formatDate(o.order_date)}</td>
      <td>${escapeHtml(String(o.status).toLowerCase())}</td>
      <td>${formatMoney(o.total_amount)}</td>
      <td><button class="btn-small" onclick="deleteOrder(${Number(o.order_id)})">Delete</button></td>
    </tr>
  `).join('');
}

// Shared submit handler for both forms
async function submitOrder(event, direction) {
  event.preventDefault();
  const form = event.target;

  // Read every <input name="..."> into an object
  const data = Object.fromEntries(new FormData(form));
  data.direction = direction;

  try {
    await apiSend('POST', '/orders', data);
    form.reset();
    showMessage(direction === 'out' ? 'Sales order created.' : 'Purchase order created.', false);
    loadOrders(); // re-fetch so the total comes from the database
  } catch (err) {
    showMessage('Could not create order: ' + err.message, true);
  }
}

async function deleteOrder(id) {
  if (!confirm('Delete order #' + id + '? This cannot be undone.')) return;

  try {
    await apiSend('DELETE', '/orders/' + id);
    showMessage('Order #' + id + ' deleted.', false);
    loadOrders();
  } catch (err) {
    showMessage('Could not delete order: ' + err.message, true);
  }
}

document.getElementById('sales-form').addEventListener('submit', e => submitOrder(e, 'out'));
document.getElementById('purchase-form').addEventListener('submit', e => submitOrder(e, 'in'));
loadOrders();
