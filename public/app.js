const app = document.querySelector("#app");

const state = {
  user: null,
  view: "cashier",
  tickets: [],
  cart: new Map(),
  status: "",
  error: "",
  summary: null,
  breakpoints: [],
  adminTickets: []
};

const money = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR"
});

init();

async function init() {
  const { user } = await api("/api/me");
  state.user = user;
  if (user) await loadTickets();
  if (user?.role === "admin") await loadAdminData();
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function loadTickets() {
  const { ticketTypes } = await api("/api/ticket-types");
  state.tickets = ticketTypes;
}

async function loadAdminData() {
  const [summary, breakpoints, tickets] = await Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/breakpoints"),
    api("/api/ticket-types?includeInactive=1")
  ]);
  state.summary = summary;
  state.breakpoints = breakpoints.breakpoints;
  state.adminTickets = tickets.ticketTypes;
}

function render() {
  if (!state.user) return renderLogin();

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <strong>Abendkasse</strong>
          <span>${escapeHtml(state.user.username)} · ${escapeHtml(state.user.role)}</span>
        </div>
        <nav class="nav">
          <button class="${state.view === "cashier" ? "active" : ""}" data-view="cashier">Cashier</button>
          ${state.user.role === "admin" ? `<button class="${state.view === "admin" ? "active" : ""}" data-view="admin">Admin</button>` : ""}
          <button class="danger" data-action="logout">Logout</button>
        </nav>
      </header>
      <main class="content">
        ${state.view === "admin" ? adminView() : cashierView()}
      </main>
      ${state.view === "cashier" ? orderBar() : ""}
    </div>
  `;

  bindCommon();
  if (state.view === "cashier") bindCashier();
  if (state.view === "admin") bindAdmin();
}

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <form data-login>
        <div>
          <h1>Abendkasse</h1>
          <p class="muted">Sign in to sell tickets or view counters.</p>
        </div>
        <label>
          Username
          <input name="username" autocomplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="primary" type="submit">Login</button>
        <p class="status error">${escapeHtml(state.error)}</p>
      </form>
    </main>
  `;

  document.querySelector("[data-login]").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.error = "";
    const form = new FormData(event.currentTarget);
    try {
      state.user = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password")
        })
      });
      await loadTickets();
      if (state.user.role === "admin") await loadAdminData();
      render();
    } catch (error) {
      state.error = error.message;
      renderLogin();
    }
  });
}

function cashierView() {
  return `
    <section class="ticket-grid">
      ${state.tickets.map((ticket) => `
        <button class="ticket-tile" style="background:${ticket.color}" data-ticket="${ticket.id}">
          ${state.cart.get(ticket.id) ? `<span class="badge">${state.cart.get(ticket.id)}</span>` : ""}
          <strong>${escapeHtml(ticket.name)}</strong>
          <span class="price">${formatMoney(ticket.priceCents)}</span>
        </button>
      `).join("")}
    </section>
    <p class="status ${state.error ? "error" : ""}">${escapeHtml(state.error || state.status)}</p>
  `;
}

function orderBar() {
  const items = selectedItems();
  return `
    <aside class="order-bar">
      <div class="order-inner">
        <div class="order-lines">
          ${items.length ? items.map(({ ticket, quantity }) => `
            <span class="order-chip">
              ${quantity}× ${escapeHtml(ticket.name)}
              <button class="chip-remove" aria-label="Remove ${escapeHtml(ticket.name)}" data-remove="${ticket.id}">−</button>
            </span>
          `).join("") : `<span class="muted">No tickets selected</span>`}
        </div>
        <div class="pay-area">
          <div class="total">
            <span>Total</span>
            <strong>${formatMoney(cartTotal())}</strong>
          </div>
          <button class="primary" data-action="submit-order" ${items.length ? "" : "disabled"}>Pay</button>
        </div>
      </div>
    </aside>
  `;
}

function adminView() {
  const breakpointLabel = state.summary?.currentShift?.breakpoint
    ? `${state.summary.currentShift.breakpoint.label || "Breakpoint"} · ${formatDate(state.summary.currentShift.breakpoint.createdAt)}`
    : "No breakpoint yet";

  return `
    <div class="admin-layout">
      <section class="section">
        <div class="section-header">
          <div>
            <h2>Current shift</h2>
            <p class="muted">${escapeHtml(breakpointLabel)}</p>
          </div>
          <form class="nav" data-breakpoint-form>
            <input name="label" placeholder="Breakpoint label" />
            <button class="primary" type="submit">Create breakpoint</button>
          </form>
        </div>
        ${summaryBlock(state.summary?.currentShift)}
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>Global counters</h2>
            <p class="muted">All persisted sales across all shifts.</p>
          </div>
        </div>
        ${summaryBlock(state.summary?.global)}
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <h2>Ticket types</h2>
            <p class="muted">Changes apply to future orders. Past orders keep their snapshots.</p>
          </div>
        </div>
        <form class="form-row" data-ticket-create>
          ${ticketInputs({ name: "", priceCents: 0, color: "#0f766e", sortOrder: 0, active: true }, "create")}
          <button class="primary" type="submit">Add</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Price</th><th>Color</th><th>Order</th><th>Active</th><th></th></tr></thead>
            <tbody>
              ${state.adminTickets.map((ticket) => `
                <tr>
                  <td colspan="6">
                    <form class="form-row" data-ticket-update="${ticket.id}">
                      ${ticketInputs(ticket, `ticket-${ticket.id}`)}
                      <button class="secondary" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <h2>Breakpoints</h2>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Label</th><th>Created by</th><th>Created</th></tr></thead>
            <tbody>
              ${state.breakpoints.map((point) => `
                <tr>
                  <td>${escapeHtml(point.label || "Breakpoint")}</td>
                  <td>${escapeHtml(point.createdBy || "")}</td>
                  <td>${formatDate(point.createdAt)}</td>
                </tr>
              `).join("") || `<tr><td colspan="3">No breakpoints yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <p class="status ${state.error ? "error" : ""}">${escapeHtml(state.error || state.status)}</p>
    </div>
  `;
}

function summaryBlock(summary) {
  const safe = summary || { orderCount: 0, totalRevenueCents: 0, items: [] };
  return `
    <div class="summary-grid">
      <div class="metric"><span>Revenue</span><strong>${formatMoney(safe.totalRevenueCents)}</strong></div>
      <div class="metric"><span>Orders</span><strong>${safe.orderCount}</strong></div>
      <div class="metric"><span>Tickets</span><strong>${safe.items.reduce((sum, item) => sum + item.quantity, 0)}</strong></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Ticket</th><th>Quantity</th><th>Revenue</th></tr></thead>
        <tbody>
          ${safe.items.map((item) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${item.quantity}</td>
              <td>${formatMoney(item.revenueCents)}</td>
            </tr>
          `).join("") || `<tr><td colspan="3">No sales recorded.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function ticketInputs(ticket, prefix) {
  return `
    <label>Name<input name="name" value="${escapeAttr(ticket.name)}" required /></label>
    <label>Price<input name="price" type="number" min="0" step="0.01" value="${(ticket.priceCents / 100).toFixed(2)}" required /></label>
    <label>Color<input name="color" type="color" value="${escapeAttr(ticket.color)}" /></label>
    <label>Order<input name="sortOrder" type="number" step="1" value="${ticket.sortOrder}" /></label>
    <label class="checkbox"><input name="active" type="checkbox" ${ticket.active ? "checked" : ""} /> Active</label>
  `;
}

function bindCommon() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = button.dataset.view;
      state.error = "";
      state.status = "";
      if (state.view === "admin") await refreshAdmin();
      render();
    });
  });

  document.querySelector("[data-action='logout']")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    state.cart.clear();
    state.error = "";
    state.status = "";
    render();
  });
}

function bindCashier() {
  document.querySelectorAll("[data-ticket]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.ticket);
      state.cart.set(id, (state.cart.get(id) || 0) + 1);
      state.status = "";
      state.error = "";
      render();
    });
  });

  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.remove);
      const quantity = state.cart.get(id) || 0;
      if (quantity <= 1) state.cart.delete(id);
      else state.cart.set(id, quantity - 1);
      render();
    });
  });

  document.querySelector("[data-action='submit-order']")?.addEventListener("click", async () => {
    state.error = "";
    state.status = "";
    try {
      const items = Array.from(state.cart.entries()).map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
      const { order } = await api("/api/orders", { method: "POST", body: JSON.stringify({ items }) });
      state.cart.clear();
      state.status = `Order #${order.id} saved · ${formatMoney(order.totalCents)}`;
      if (state.user.role === "admin") await loadAdminData();
      render();
    } catch (error) {
      state.error = error.message;
      render();
    }
  });
}

function bindAdmin() {
  document.querySelector("[data-breakpoint-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAdminAction(() => api("/api/admin/breakpoints", {
      method: "POST",
      body: JSON.stringify({ label: form.get("label") })
    }), "Breakpoint created");
  });

  document.querySelector("[data-ticket-create]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAdminAction(() => api("/api/admin/ticket-types", {
      method: "POST",
      body: JSON.stringify(ticketPayload(event.currentTarget))
    }), "Ticket type created");
  });

  document.querySelectorAll("[data-ticket-update]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = event.currentTarget.dataset.ticketUpdate;
      await runAdminAction(() => api(`/api/admin/ticket-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify(ticketPayload(event.currentTarget))
      }), "Ticket type saved");
    });
  });
}

async function runAdminAction(action, successMessage) {
  state.error = "";
  state.status = "";
  try {
    await action();
    await refreshAdmin();
    state.status = successMessage;
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function refreshAdmin() {
  await Promise.all([loadTickets(), loadAdminData()]);
}

function ticketPayload(form) {
  const data = new FormData(form);
  return {
    name: data.get("name"),
    priceCents: Math.round(Number(data.get("price")) * 100),
    color: data.get("color"),
    sortOrder: Number(data.get("sortOrder") || 0),
    active: data.get("active") === "on"
  };
}

function selectedItems() {
  return Array.from(state.cart.entries())
    .map(([id, quantity]) => ({ ticket: state.tickets.find((ticket) => ticket.id === id), quantity }))
    .filter((item) => item.ticket);
}

function cartTotal() {
  return selectedItems().reduce((sum, item) => sum + item.ticket.priceCents * item.quantity, 0);
}

function formatMoney(cents) {
  return money.format((cents || 0) / 100);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#039;");
}
