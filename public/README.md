# StockFlow frontend (`/public`)

Plain HTML + CSS + JavaScript. No frameworks, no build step.
Every page is its own HTML file, so each person can work on their own files without conflicts.

## Folder structure

```
public/
├── index.html           just redirects to pages/dashboard.html
├── style.css            SHARED  colors, sidebar, panels, tables, forms, buttons
├── app.js               SHARED  sidebar links + API helpers (apiGet, apiSend, showMessage, ...)
│
├── pages/
│   ├── dashboard.html   Punnawit
│   └── orders.html      Punnawit
├── css/
│   ├── dashboard.css    Punnawit
│   └── orders.css       Punnawit
└── js/
    ├── dashboard.js     Punnawit
    └── orders.js        Punnawit
```

Other pages (Products, Companies, Locations, Stock, Lots) aren't here yet. Agree on an owner first, then create
`pages/<page>.html`, `css/<page>.css` and `js/<page>.js` the same way, and add the page to `PAGES` in `app.js`.

## Rules

1. **Only edit your own files.** Ownership is listed in the table above.
2. **`style.css` and `app.js` are shared.** Tell the other person before changing them, and keep those changes small.
   If a style is only used on your page, put it in your own `css/<page>.css`.
3. **The sidebar is built by `app.js`.** Don't copy sidebar HTML into your page. Just use `<aside id="sidebar" class="sidebar"></aside>`.
   To add a page to the menu, add one line to `PAGES` in `app.js`.
4. **Call the backend through the helpers** in `app.js`. Don't write `fetch` yourself:
   ```js
   const rows = await apiGet('/products');           // GET    /api/products
   await apiSend('POST', '/products', data);         // POST   /api/products
   await apiSend('DELETE', '/products/' + id);       // DELETE /api/products/:id
   ```
   After any POST or DELETE, load the list again so the page shows the values the database calculated.
5. **Each person works on their own Git branch** and merges into `main` with a pull request.
   Pull `main` into your branch often.

## Page template

Each page follows the same shape. The easiest way to start a new page is to copy `pages/orders.html`.
Pages live one folder down, so shared files are linked with `../`.

```html
<link rel="stylesheet" href="../style.css">
<link rel="stylesheet" href="../css/<page>.css">
...
<aside id="sidebar" class="sidebar"></aside>
<main>
  <div class="page-header"> <h1>...</h1> <p class="subtitle">...</p> </div>
  <p id="message" class="message"></p>
  <section class="panel">
    <div class="panel-header"><h2>...</h2></div>
    <div class="panel-body"> form or table </div>
  </section>
</main>
<script src="../app.js"></script>        <!-- always first -->
<script src="../js/<page>.js"></script>
```

Shared CSS classes you can use: `panel`, `panel-header`, `panel-body`, `form-grid`, `btn`, `btn-small`,
`badge in` / `badge out`, `message`, `empty` (for "No rows yet" table cells).
