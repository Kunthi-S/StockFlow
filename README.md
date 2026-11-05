[README.md](https://github.com/user-attachments/files/34436602/README.md)
# StockFlow

A web-based stock management system for a small warehouse. StockFlow tracks products, storage locations, trading partners and purchase/sales orders, and moves stock automatically when an order is received or shipped.

Built with **Node.js + Express** on top of a **MySQL 8** database that does most of the bookkeeping itself through triggers, stored procedures, views and constraints.

---

## Features

| Page | What it does |
|---|---|
| **Dashboard** | Totals at a glance, low-stock alerts (at or below reorder level), recent orders |
| **Orders** | Create purchase (`IN`) and sales (`OUT`) orders with multiple items, change status, attach a shipment with tracking and dates |
| **Products** | Three product types — `PACKAGED`, `WEIGHED`, `COUNTED` — each with its own fields, plus stock per location |
| **Locations** | Warehouse slots by aisle / rack / level, with an auto-generated code (e.g. `A-03-2`) |
| **Companies** | Customers and suppliers with address, email and multiple phone numbers |

**Automatic stock movement**

- An `IN` order adds stock when its status becomes `RECEIVED`.
- An `OUT` order removes stock when its status becomes `SHIPPED` (fullest location first) and is refused if there isn't enough.
- Moving an order back out of that status reverses the stock change. Each status change and its stock movement run in a single transaction.

**Two access levels**

- **Full access**: the `stockflow_app` MySQL account.
- **View only**: the `stockflow_readonly` account with `READ_ONLY=true`. The UI hides edit buttons, the API rejects every non-`GET` request, and MySQL itself only grants `SELECT`.

---

## Tech Stack

- **Backend:** Node.js, Express 5, `mysql2` (promise pool), `dotenv`
- **Database:** MySQL 8.0.16+ (needs `CHECK` constraints, `JSON_TABLE`, generated columns)
- **Frontend:** Plain HTML, CSS and JavaScript (no framework), served from `public/`

---

## Database Design

### ER Diagram

![StockFlow ER Diagram](docs/erd.png)

| Relationship | Entities | Cardinality |
|---|---|---|
| `places` | COMPANY → ORDERS | 1 : N (a company may have no orders; every order has one company) |
| `fulfills` | SHIPMENT → ORDERS | 1 : 1 (an order has at most one shipment) |
| `contains` | ORDERS → ORDER_ITEMS | 1 : N, identifying (every order has at least one item) |
| `refer_to` | PRODUCT → ORDER_ITEMS | 1 : N, identifying |
| `stored_at` | PRODUCT ↔ LOCATION | M : N, with `quantity_at_location` |

**Notation:** ORDER_ITEMS is a weak entity identified by `order_id` + `product_id`. `address` is a composite attribute, `contact_phone` is multivalued, and the dashed attributes (`total_amount`, `line_total`, `quantity_on_hand`) are derived.

### Tables

| Table | Notes |
|---|---|
| `company` | Composite address (`street`, `city`, `postal_code`) |
| `company_phone` | Multivalued attribute table |
| `orders` | `direction` IN/OUT, `status` enum, `total_amount` kept by triggers |
| `order_item` | Weak entity; `line_total` is a stored generated column |
| `shipment` | One per order (`UNIQUE order_id`); date `CHECK`s |
| `product` | Type-specific fields in a `type_data` JSON column; `quantity_on_hand` kept by triggers |
| `location` | `code` generated from aisle, rack and level |
| `stored_at` | M:N product ↔ location with `quantity_at_location` |

**Server-side logic (`sql/02_stockflow_triggers.sql`)**

- **Triggers:** `order_item` changes update `orders.total_amount`, and `stored_at` changes update `product.quantity_on_hand`
- **Procedures:** `p_insert_company`, `p_update_company`, `p_add_company_phone` (transactional, phones passed as JSON)
- **Function:** `is_low_stock(product_id)`
- **Views:** `v_stock_summary` (products with low-stock flag and locations), `v_order_summary` (orders with company and shipment)

---

## Project Structure

```
StockFlow/
├── server.js              # Express app, routes, read-only guard, error handler
├── db.js                  # Shared MySQL connection pool
├── routes/                # URL → controller mapping
├── controllers/           # Request handling and SQL queries
├── utils/http.js          # Error responses and safe LIKE helper
├── public/                # Frontend (index.html, app.js, style.css)
├── sql/
│   ├── 01_stockflow_schema.sql       # Tables, keys, indexes, CHECKs
│   ├── 02_stockflow_triggers.sql     # Triggers, procedures, function, views
│   ├── 03_stockflow_accounts.sql     # MySQL users and privileges
│   └── 04_stockflow_sample_data.sql  # Demo data
├── docs/erd.png           # ER diagram
├── test cases/            # SQL injection and privilege test inputs
└── .env.example
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL 8.0.16+

### 1. Clone and install

```bash
git clone https://github.com/Kunthi-S/StockFlow.git
cd StockFlow
npm install
```

### 2. Set up the database

Create the accounts as `root` first, then build the database as `stockflow_admin`:

```bash
mysql -u root -p < sql/03_stockflow_accounts.sql

mysql -u stockflow_admin -p < sql/01_stockflow_schema.sql
mysql -u stockflow_admin -p < sql/02_stockflow_triggers.sql
mysql -u stockflow_admin -p < sql/04_stockflow_sample_data.sql
```

> ⚠️ `03_stockflow_accounts.sql` uses simple demo passwords. Change them before using StockFlow anywhere other than your own machine.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
DB_HOST=localhost
DB_NAME=stockflow
DB_USER=stockflow_app
DB_PASS=your_app_password
READ_ONLY=false
PORT=3000
```

For view-only mode, use `DB_USER=stockflow_readonly` with its password and `READ_ONLY=true`.

### 4. Run

```bash
npm start        # or: npm run dev  (auto-restart on file changes)
```

Open **http://localhost:3000**.

---

## API Reference

All endpoints are under `/api` and return JSON. List endpoints accept `?q=` for search.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/config` | `{ readOnly }` for the frontend |
| `GET` | `/api/dashboard/stats` | Summary counts |
| `GET` | `/api/dashboard/low-stock` | Products at or below reorder level |
| `GET` | `/api/dashboard/recent-orders` | Latest orders |
| `GET` `POST` | `/api/companies` | List / create |
| `GET` `PUT` `DELETE` | `/api/companies/:id` | Read / update / delete (refused if it has orders) |
| `GET` `POST` | `/api/companies/:id/phones` | List / add phone |
| `DELETE` | `/api/companies/:id/phones/:phone` | Remove phone |
| `GET` `POST` | `/api/products` | List / create (with locations) |
| `GET` `PUT` `DELETE` | `/api/products/:id` | Read / update / delete |
| `GET` `POST` | `/api/locations` | List / create |
| `PUT` `DELETE` | `/api/locations/:id` | Update / delete (refused if it holds stock) |
| `GET` `POST` | `/api/orders` | List / create with items |
| `GET` `DELETE` | `/api/orders/:id` | Read / delete (refused once stock has moved or it has a shipment) |
| `PATCH` | `/api/orders/:id/status` | Change status and move stock |
| `PUT` `DELETE` | `/api/orders/:id/shipment` | Add or update / remove shipment |

---

## Security

- **Parameterized queries everywhere.** Search text is passed as a bound value, never concatenated into SQL. (`test cases/injection.txt` holds a classic `' OR '1'='1` payload for testing.)
- **Least-privilege MySQL accounts.** The app account cannot `CREATE`, `DROP` or `ALTER`, and the read-only account can only `SELECT`. (`test cases/create_drop.sql` checks this.)
- **No SQL details leak to the browser.** Errors are logged on the server, and the client gets a generic message.
- **Secrets stay local.** `.env` is git-ignored.

---

## Team

| Member | Role |
|---|---|
| [Kunthi-S](https://github.com/Kunthi-S) | Project manager, database design, all SQL code |
| [Draconicity](https://github.com/Draconicity) | Backend |
| [kittipongsi](https://github.com/kittipongsi) | Frontend: Products page, Companies page UI |
| [Punnawit0425](https://github.com/Punnawit0425) (Punnawit Arunyanart) | Frontend: Dashboard page, Orders page, Locations page UI |
