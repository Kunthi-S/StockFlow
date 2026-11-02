// public/app.js
// All front-end logic for StockFlow. index.html has one <section class="page">
// per screen; the sidebar shows one at a time and reloads its data from /api
// (each endpoint is listed in routes/*.js).

const $ = (id) => document.getElementById(id);

// ---- helpers ---------------------------------------------------------------

// Send a request. On an error, show the server's message and return null.
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (res.ok) return data;
  showMessage(data.error ?? "Request failed (" + res.status + ")", true);
  return null;
}

function showMessage(text, isError) {
  $("message").textContent = text;
  $("message").className = !text ? "message" : isError ? "message error" : "message success";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const formatDate = (v) => String(v ?? "").slice(0, 10);   // "2026-09-04 10:30:00" -> "2026-09-04"
const money = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const statusText = (s) => s.toLowerCase().replace("_", " ");   // "IN_TRANSIT" -> "in transit"
const badge = (dir) => `<span class="badge ${dir.toLowerCase()}">${dir.toLowerCase()}</span>`;

// A form's named fields as an object: numbers as numbers, checkboxes as true/false, empty as null
function formValues(form) {
  const v = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") v[el.name] = el.checked;
    else if (el.value.trim() === "") v[el.name] = null;
    else v[el.name] = el.type === "number" ? Number(el.value) : el.value.trim();
  }
  return v;
}

// Put an object's values into the form fields with the same names
function fillForm(form, data) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in data)) continue;
    if (el.type === "checkbox") el.checked = Boolean(data[el.name]);
    else el.value = data[el.name] ?? "";
  }
}

// Add/edit forms ("product", "company"): form.dataset.id is the record being edited, "" when adding
function setEditing(name, id, data) {
  const form = $(name + "Form");
  form.reset();
  if (data) fillForm(form, data);
  form.dataset.id = id ?? "";
  $(name + "FormTitle").textContent = id ? `Edit ${name} #${id}` : "Add " + name;
  $(name + "SaveBtn").textContent = id ? "Save changes" : "Add " + name;
  $(name + "CancelBtn").classList.toggle("hide", !id);
}

// POST when adding, PUT when editing; returns true when saved
async function saveForm(name, url, body) {
  const id = $(name + "Form").dataset.id;
  if (!await api(id ? "PUT" : "POST", id ? `${url}/${id}` : url, body)) return false;
  showMessage(`Saved ${name}${id ? " #" + id : ""}.`);
  return true;
}

// ---- page switching ----------------------------------------------------------

const loaders = {
  dashboard: () => loadDashboard(),
  orders: () => { loadOrders(); loadOrderOptions(); renderItems(); },
  products: () => { loadProducts(); loadLocations(); },
  companies: () => loadCompanies(),
};

function showPage(page) {
  for (const p in loaders) $(p).classList.toggle("hide", p !== page);
  for (const btn of $("nav").children) btn.classList.toggle("active", btn.dataset.page === page);
  showMessage("");
  loaders[page]();
}

$("nav").addEventListener("click", (e) => {
  if (e.target.dataset.page) showPage(e.target.dataset.page);
});

// ---- Dashboard ---------------------------------------------------------------

async function loadDashboard() {
  const [stats, low, recent] = await Promise.all(
    ["stats", "low-stock", "recent-orders"].map((p) => api("GET", "/api/dashboard/" + p)));
  if (!stats || !low || !recent) return;

  $("statProducts").textContent = stats.products;
  $("statLowStock").textContent = stats.low_stock;
  $("statOpenOrders").textContent = stats.open_orders;
  $("statCompanies").textContent = stats.companies;

  $("lowStockBody").innerHTML = low.length === 0
    ? '<tr><td colspan="4" class="empty">All products are above their reorder level.</td></tr>'
    : low.map((p) => `<tr><td>${escapeHtml(p.sku)}</td><td>${escapeHtml(p.name)}</td>
        <td>${Number(p.quantity_on_hand)}</td><td>${Number(p.reorder_level)}</td></tr>`).join("");

  $("recentOrders").innerHTML = recent.length === 0
    ? '<li class="empty">No orders yet.</li>'
    : recent.map((o) => `<li><span class="date">${formatDate(o.order_date)}</span>
        Order #${o.order_id} ${badge(o.direction)} ${escapeHtml(o.company_name)} · ${statusText(o.status)}</li>`).join("");
}

$("refreshBtn").addEventListener("click", loadDashboard);

// ---- Orders ------------------------------------------------------------------

const STATUSES = ["DRAFT", "CONFIRMED", "IN_TRANSIT", "RECEIVED", "SHIPPED", "CANCELLED"];
const WAREHOUSE = "StockFlow Warehouse, 1 Rangsit-Nakhon Nayok Rd, Pathum Thani 12120";

let products = [];      // for the item drop-down and default prices
let items = [];         // items of the new order: { product_id, quantity, unit_price, label }
let openOrder = null;   // id of the order whose details are shown

const shipmentCell = (o) => !o.tracking_number && !o.expected_date ? "–"
  : `${escapeHtml(o.tracking_number)}<div class="sub">${o.actual_date
      ? "delivered " + formatDate(o.actual_date) : "due " + formatDate(o.expected_date)}</div>`;

async function loadOrders() {
  const orders = await api("GET", "/api/orders");
  if (!orders) return;
  $("ordersBody").innerHTML = orders.length === 0
    ? '<tr><td colspan="8" class="empty">No orders yet.</td></tr>'
    : orders.map((o) => `<tr>
        <td>${o.order_id}</td><td>${badge(o.direction)}</td><td>${escapeHtml(o.company_name)}</td>
        <td class="nowrap">${formatDate(o.order_date)}</td>
        <td><span class="status ${o.status.toLowerCase()}">${statusText(o.status)}</span></td>
        <td>${shipmentCell(o)}</td><td>${money(o.total_amount)}</td>
        <td class="actions">
          <button class="btn-small" data-view="${o.order_id}">${o.order_id == openOrder ? "Hide" : "View"}</button>
          <button class="btn-small danger" data-delete="${o.order_id}">Delete</button>
        </td></tr>`).join("");
  if (openOrder) showOrderDetail(openOrder);
}

// Items, status and shipment of one order, in a row under it
async function showOrderDetail(id) {
  const row = document.querySelector(`[data-view="${id}"]`)?.closest("tr");
  if (!row) return;   // the order was deleted
  const o = await api("GET", `/api/orders/${id}`);
  if (!o) return;
  // A new shipment goes to the customer (OUT) or to our warehouse (IN)
  const s = o.shipment ?? { destination_address: o.direction === "OUT" ? `${o.street}, ${o.city} ${o.postal_code}` : WAREHOUSE };

  row.insertAdjacentHTML("afterend", `<tr class="detail-row"><td colspan="8"><div class="order-detail">
    <div>
      <h3>Items</h3>
      <table>
        <thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
        <tbody>${o.items.map((it) => `<tr><td>${escapeHtml(it.sku)}</td><td>${escapeHtml(it.name)}</td>
          <td>${Number(it.quantity)}</td><td>${money(it.unit_price)}</td><td>${money(it.line_total)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <div>
      <h3>Status</h3>
      <form class="status-form inline-field" data-order="${id}">
        <select name="status">${STATUSES.map((st) =>
          `<option value="${st}" ${st === o.status ? "selected" : ""}>${statusText(st)}</option>`).join("")}</select>
        <button class="btn-small">Save status</button>
      </form>
      <p class="hint">${o.direction === "IN" ? "Received adds" : "Shipped takes"} these items ${o.direction === "IN" ? "to" : "out of"} stock.</p>
      <h3>Shipment ${o.shipment ? "" : '<span class="sub">– none yet, fill in to add one</span>'}</h3>
      <form class="shipment-form" data-order="${id}">
        <div class="form-grid two">
          <label>Tracking number <input name="tracking_number" maxlength="60" value="${escapeHtml(s.tracking_number)}"></label>
          <label>Freight date <input name="freight_date" type="date" value="${formatDate(s.freight_date)}"></label>
          <label>Expected <input name="expected_date" type="date" value="${formatDate(s.expected_date)}"></label>
          <label>Delivered <input name="actual_date" type="date" value="${formatDate(s.actual_date)}"></label>
        </div>
        <label>Destination address <input name="destination_address" maxlength="255" required value="${escapeHtml(s.destination_address)}"></label>
        <div class="form-actions">
          <button class="btn-small">${o.shipment ? "Save" : "Add"} shipment</button>
          ${o.shipment ? `<button type="button" class="btn-small danger" data-unship="${id}">Remove shipment</button>` : ""}
        </div>
      </form>
    </div>
  </div></td></tr>`);
}

// Fill the company and product drop-downs (Lab 8 loadCourseOptions)
async function loadOrderOptions() {
  const companies = await api("GET", "/api/companies") ?? [];
  $("orderCompany").innerHTML = companies.map((c) =>
    `<option value="${c.company_id}">${c.company_id} – ${escapeHtml(c.name)}</option>`).join("");

  products = await api("GET", "/api/products") ?? [];
  $("orderProduct").innerHTML = products.map((p) =>
    `<option value="${p.product_id}">${escapeHtml(p.sku)} – ${escapeHtml(p.name)}</option>`).join("");
  fillPrice();
}

// Suggest the product's standard cost as the unit price
function fillPrice() {
  const p = products.find((p) => p.product_id == $("orderProduct").value);
  $("orderPrice").value = p ? Number(p.standard_cost).toFixed(2) : "";
}

$("orderProduct").addEventListener("change", fillPrice);

function renderItems() {
  $("orderItemsBody").innerHTML = items.map((it, i) => `<tr>
      <td>${escapeHtml(it.label)}</td><td>${it.quantity}</td><td>${money(it.unit_price)}</td>
      <td>${money(it.quantity * it.unit_price)}</td>
      <td><button type="button" class="btn-small danger" data-index="${i}">Remove</button></td></tr>`).join("");
  $("orderItemsTotal").textContent = money(items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0));
}

$("addItemBtn").addEventListener("click", () => {
  const product_id = Number($("orderProduct").value);
  const quantity = Number($("orderQty").value);
  const unit_price = Number($("orderPrice").value);
  if (!product_id || !(quantity > 0) || !(unit_price >= 0)) {
    return showMessage("Pick a product, a quantity above 0 and a unit price.", true);
  }
  // A product can be in an order only once, so adding it again adds to its quantity
  const same = items.find((it) => it.product_id === product_id);
  if (same) same.quantity += quantity;
  else items.push({ product_id, quantity, unit_price, label: $("orderProduct").selectedOptions[0].textContent });
  $("orderQty").value = "";
  renderItems();
});

$("orderItemsBody").addEventListener("click", (e) => {
  if (e.target.dataset.index === undefined) return;
  items.splice(e.target.dataset.index, 1);
  renderItems();
});

$("orderForm").onsubmit = async (e) => {
  e.preventDefault();
  if (items.length === 0) return showMessage("Add at least one item to the order.", true);
  const data = await api("POST", "/api/orders",
    { company_id: Number($("orderCompany").value), direction: $("orderDirection").value, items });
  if (!data) return;
  items = [];
  renderItems();
  showMessage("Order #" + data.order_id + " created.");
  loadOrders();   // re-fetch so the total comes from the database
};

// The status and shipment forms are inside the table, so one listener handles both
$("ordersBody").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.dataset.order;
  const isStatus = e.target.classList.contains("status-form");
  const ok = await api(isStatus ? "PATCH" : "PUT", `/api/orders/${id}/${isStatus ? "status" : "shipment"}`, formValues(e.target));
  if (!ok) return;
  showMessage(`Order #${id}: ${isStatus ? "status" : "shipment"} saved.`);
  loadOrders();
});

$("ordersBody").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  if (d.view) {
    openOrder = openOrder === d.view ? null : d.view;
    loadOrders();
  }
  if (d.unship && confirm(`Remove the shipment of order #${d.unship}?`)
      && await api("DELETE", `/api/orders/${d.unship}/shipment`)) {
    showMessage(`Order #${d.unship}: shipment removed.`);
    loadOrders();
  }
  if (d.delete && confirm(`Delete order #${d.delete}?`) && await api("DELETE", `/api/orders/${d.delete}`)) {
    showMessage(`Order #${d.delete} deleted.`);
    loadOrders();
  }
});

// ---- Products ----------------------------------------------------------------

// The type_data fields of each product type
const TYPE_FIELDS = {
  PACKAGED: ["units_per_pack", "package_type", "pack_barcode"],
  WEIGHED: ["tare_weight_kg", "avg_net_weight_kg", "unit_of_measure"],
  COUNTED: ["unit_label", "is_serialized"],
};

let knownLocations = [];     // every location already in the database
let productLocations = [];   // locations added to the product in the form

async function loadProducts() {
  const list = await api("GET", "/api/products");
  if (!list) return;
  $("productsBody").innerHTML = list.length === 0
    ? '<tr><td colspan="9" class="empty">No products yet. Add the first one above.</td></tr>'
    : list.map((p) => `<tr>
        <td>${escapeHtml(p.sku)}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td>
        <td><span class="badge type">${p.product_type.toLowerCase()}</span></td>
        <td class="${p.is_low ? "low" : ""}">${Number(p.quantity_on_hand)}</td>
        <td class="sub">${escapeHtml(p.locations ?? "–")}</td>
        <td>${p.reorder_level == null ? "–" : Number(p.reorder_level)}</td><td>${money(p.standard_cost)}</td>
        <td class="actions">
          <button class="btn-small" data-edit="${p.product_id}">Edit</button>
          <button class="btn-small danger" data-delete="${p.product_id}">Delete</button>
        </td></tr>`).join("");
}

async function loadLocations() {
  knownLocations = await api("GET", "/api/products/locations") ?? [];
}

// Show only the details box of the selected product type
function showTypeFields() {
  const type = $("productForm").elements["product_type"].value;
  for (const box of document.querySelectorAll("[data-type]")) box.classList.toggle("hide", box.dataset.type !== type);
}

$("productForm").elements["product_type"].addEventListener("change", showTypeFields);

function renderLocations() {
  $("locationList").innerHTML = productLocations.map((l, i) => `<li>${escapeHtml(l.code)} · qty ${l.quantity_at_location}
      <button type="button" class="btn-small danger" data-index="${i}">Remove</button></li>`).join("");
}

// Typing an existing location code fills in its aisle and capacity
$("locCode").addEventListener("change", () => {
  const known = knownLocations.find((l) => l.code === $("locCode").value.trim());
  if (!known) return;
  $("locAisle").value = known.aisle;
  $("locCapacity").value = known.capacity_slots;
});

$("addLocationBtn").addEventListener("click", () => {
  const code = $("locCode").value.trim();
  if (!code) return showMessage("Enter a location code first.", true);
  productLocations.push({
    code,
    aisle: $("locAisle").value.trim() || undefined,
    capacity_slots: Number($("locCapacity").value) || undefined,
    quantity_at_location: Number($("locQty").value),
  });
  for (const id of ["locCode", "locAisle", "locCapacity", "locQty"]) $(id).value = "";
  renderLocations();
});

$("locationList").addEventListener("click", (e) => {
  if (e.target.dataset.index === undefined) return;
  productLocations.splice(e.target.dataset.index, 1);
  renderLocations();
});

// Put product p in the form, or empty the form for a new product when p is undefined
function editProduct(p) {
  setEditing("product", p?.product_id, p && { ...p, ...p.type_data });
  productLocations = (p?.locations ?? []).map((l) => ({ ...l, quantity_at_location: Number(l.quantity_at_location) }));
  renderLocations();
  showTypeFields();
}

$("productForm").onsubmit = async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  const type_data = {};
  for (const field of TYPE_FIELDS[v.product_type]) type_data[field] = v[field];
  if (!await saveForm("product", "/api/products", { ...v, type_data, locations: productLocations })) return;
  editProduct();
  loadProducts();
  loadLocations();
};

$("productsBody").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  const p = d.edit && await api("GET", `/api/products/${d.edit}`);
  if (p) return editProduct(p);
  if (d.delete && confirm(`Delete product #${d.delete}?`) && await api("DELETE", `/api/products/${d.delete}`)) {
    showMessage(`Product #${d.delete} deleted.`);
    if ($("productForm").dataset.id === d.delete) editProduct();
    loadProducts();
  }
});

$("productCancelBtn").addEventListener("click", () => editProduct());

// ---- Companies ---------------------------------------------------------------

let companies = [];

async function loadCompanies() {
  const list = await api("GET", "/api/companies");
  if (!list) return;
  companies = list;
  // Fetch every company's phones at the same time instead of one after another
  const phones = await Promise.all(companies.map((c) => api("GET", `/api/companies/${c.company_id}/phones`)));

  $("companiesBody").innerHTML = companies.length === 0
    ? '<tr><td colspan="6" class="empty">No companies yet. Add the first one above.</td></tr>'
    : companies.map((c, i) => `<tr>
        <td>${c.company_id}</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.email)}</td>
        <td>${escapeHtml(c.street)}, ${escapeHtml(c.city)} ${escapeHtml(c.postal_code)}</td>
        <td>
          ${(phones[i] ?? []).map((p) => `<span class="chip">${escapeHtml(p.contact_phone)}
            <button class="chip-x" title="Remove phone" data-company="${c.company_id}"
                    data-phone="${escapeHtml(p.contact_phone)}">×</button></span>`).join("")}
          <div class="phone-form">
            <input id="phone-${c.company_id}" type="tel" placeholder="Add phone" maxlength="20">
            <button class="btn-small" data-addphone="${c.company_id}">Add</button>
          </div>
        </td>
        <td class="actions">
          <button class="btn-small" data-edit="${c.company_id}">Edit</button>
          <button class="btn-small danger" data-delete="${c.company_id}">Delete</button>
        </td></tr>`).join("");
}

$("companyForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!await saveForm("company", "/api/companies", formValues(e.target))) return;
  setEditing("company");
  loadCompanies();
};

// One click listener for every button in the companies table
$("companiesBody").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  let ok = false;

  if (d.edit) setEditing("company", d.edit, companies.find((c) => c.company_id == d.edit));
  if (d.delete && confirm(`Delete company #${d.delete}?`)) {
    ok = await api("DELETE", `/api/companies/${d.delete}`);
    if (ok && $("companyForm").dataset.id === d.delete) setEditing("company");
  }
  if (d.addphone) {
    const phone = $("phone-" + d.addphone).value.trim();
    if (phone) ok = await api("POST", `/api/companies/${d.addphone}/phones`, { contact_phone: phone });
  }
  if (d.phone) {
    ok = await api("DELETE", `/api/companies/${d.company}/phones/${encodeURIComponent(d.phone)}`);
  }
  if (ok) {
    showMessage("Saved.");
    loadCompanies();
  }
});

$("companyCancelBtn").addEventListener("click", () => setEditing("company"));

// Start on the Dashboard
showPage("dashboard");
