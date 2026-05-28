import { createHmac, randomBytes, timingSafeEqual, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = join(rootDir, "public");

const env = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3100),
  databasePath: resolve(rootDir, process.env.DATABASE_PATH || "./data/abendkasse.sqlite"),
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
  nodeEnv: process.env.NODE_ENV || "development",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  cashierUsername: process.env.CASHIER_USERNAME || "cashier",
  cashierPassword: process.env.CASHIER_PASSWORD || "cashier"
};

mkdirSync(dirname(env.databasePath), { recursive: true });
const db = new DatabaseSync(env.databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cashier', 'admin')),
  created_at TEXT NOT NULL DEFAULT (${nowSql})
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${nowSql})
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  color TEXT NOT NULL DEFAULT '#2563eb',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (${nowSql}),
  updated_at TEXT NOT NULL DEFAULT (${nowSql})
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (${nowSql})
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id INTEGER REFERENCES ticket_types(id) ON DELETE SET NULL,
  ticket_name_snapshot TEXT NOT NULL,
  price_cents_snapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS breakpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (${nowSql})
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_breakpoints_created_at ON breakpoints(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);

seedData();

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(res, error.status, { error: error.message });
    }
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(env.port, env.host, () => {
  console.log(`Abendkasse listening on http://${env.host}:${env.port}`);
});

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (path.startsWith("/api/")) {
    if (req.method === "POST" && path === "/api/login") return login(req, res);
    if (req.method === "POST" && path === "/api/logout") return logout(req, res);
    if (req.method === "GET" && path === "/api/me") return me(req, res);
    if (req.method === "GET" && path === "/api/ticket-types") return listTicketTypes(req, res);
    if (req.method === "POST" && path === "/api/orders") return createOrder(req, res);
    if (req.method === "GET" && path === "/api/admin/summary") return adminSummary(req, res);
    if (req.method === "GET" && path === "/api/admin/breakpoints") return listBreakpoints(req, res);
    if (req.method === "POST" && path === "/api/admin/breakpoints") return createBreakpoint(req, res);
    if (req.method === "POST" && path === "/api/admin/ticket-types") return createTicketType(req, res);
    if (req.method === "PATCH" && path.startsWith("/api/admin/ticket-types/")) return updateTicketType(req, res, path);

    return sendJson(res, 404, { error: "API route not found" });
  }

  serveStatic(path, res);
}

function seedData() {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0) {
    const insertUser = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
    insertUser.run(env.adminUsername, hashPassword(env.adminPassword), "admin");
    insertUser.run(env.cashierUsername, hashPassword(env.cashierPassword), "cashier");
  }

  const ticketCount = db.prepare("SELECT COUNT(*) AS count FROM ticket_types").get().count;
  if (ticketCount === 0) {
    const insertTicket = db.prepare(`
      INSERT INTO ticket_types (name, price_cents, color, sort_order)
      VALUES (?, ?, ?, ?)
    `);
    [
      ["Full Weekend", 10000, "#14532d", 10],
      ["Tagesticket Do", 3000, "#14532d", 10],
      ["Tagesticket Fr", 5000, "#14532d", 10],
      ["Tagesticket Sa", 5000, "#14532d", 10],
      ["Anwohni Full Weekend", 6000, "#1d4ed8", 20],
      ["Anwohni Tagesticket Do", 1500, "#14532d", 10],
      ["Anwohni Tagesticket Fr", 3000, "#14532d", 10],
      ["Anwohni Tagesticket Sa", 3000, "#14532d", 10],
      ["Artist Begleitung Full Weekend", 4000, "#6b7280", 30],
      ["Artist Begleitung Tagesticket Do", 0, "#6b7280", 30],
      ["Artist Begleitung Tagesticket Fr", 0, "#6b7280", 30],
      ["Artist Begleitung Tagesticket Sa", 0, "#6b7280", 30]
    ].forEach((ticket) => insertTicket.run(...ticket));
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 210000, 32, "sha512").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const actual = Buffer.from(pbkdf2Sync(password, salt, 210000, 32, "sha512").toString("hex"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signSession(id) {
  return createHmac("sha256", env.sessionSecret).update(id).digest("hex");
}

function makeSessionCookie(sessionId) {
  const value = `${sessionId}.${signSession(sessionId)}`;
  return `session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 12}`;
}

function clearSessionCookie() {
  return "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getCurrentUser(req) {
  const raw = readCookie(req, "session");
  if (!raw) return null;
  const [sessionId, signature] = raw.split(".");
  if (!sessionId || !signature || signSession(sessionId) !== signature) return null;

  const row = db.prepare(`
    SELECT users.id, users.username, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > ${nowSql}
  `).get(sessionId);
  return row || null;
}

function requireUser(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Login required" });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Admin access required" });
    return null;
  }
  return user;
}

async function login(req, res) {
  const body = await readJson(req);
  const username = cleanString(body.username, 80);
  const password = String(body.password || "");
  const user = db.prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?").get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendJson(res, 401, { error: "Invalid username or password" });
  }

  const sessionId = randomBytes(32).toString("hex");
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', '+12 hours'))
  `).run(sessionId, user.id);

  res.setHeader("Set-Cookie", makeSessionCookie(sessionId));
  return sendJson(res, 200, userResponse(user));
}

function logout(req, res) {
  const raw = readCookie(req, "session");
  if (raw) {
    const [sessionId] = raw.split(".");
    if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  res.setHeader("Set-Cookie", clearSessionCookie());
  sendJson(res, 200, { ok: true });
}

function me(req, res) {
  const user = getCurrentUser(req);
  sendJson(res, 200, { user: user ? userResponse(user) : null });
}

function listTicketTypes(req, res) {
  const includeInactive = new URL(req.url || "/", "http://localhost").searchParams.get("includeInactive") === "1";
  const user = includeInactive ? requireAdmin(req, res) : requireUser(req, res);
  if (!user) return;

  const rows = db.prepare(`
    SELECT id, name, price_cents AS priceCents, color, sort_order AS sortOrder, active
    FROM ticket_types
    WHERE active = 1 OR ? = 1
    ORDER BY sort_order, id
  `).all(includeInactive ? 1 : 0);
  sendJson(res, 200, { ticketTypes: rows.map(normalizeTicket) });
}

async function createOrder(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  const body = await readJson(req);
  const incomingItems = Array.isArray(body.items) ? body.items : [];
  const quantities = new Map();

  for (const item of incomingItems) {
    const id = Number(item.ticketTypeId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0 || quantity > 500) {
      return sendJson(res, 400, { error: "Invalid order item" });
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  }

  if (quantities.size === 0) return sendJson(res, 400, { error: "Order is empty" });

  try {
    db.exec("BEGIN");
    const orderItems = [];
    let totalCents = 0;
    const ticketStmt = db.prepare("SELECT id, name, price_cents FROM ticket_types WHERE id = ? AND active = 1");

    for (const [ticketTypeId, quantity] of quantities.entries()) {
      const ticket = ticketStmt.get(ticketTypeId);
      if (!ticket) throw new HttpError(400, "Unknown or inactive ticket type");
      const lineTotalCents = ticket.price_cents * quantity;
      totalCents += lineTotalCents;
      orderItems.push({ ticket, quantity, lineTotalCents });
    }

    const order = db.prepare("INSERT INTO orders (total_cents, created_by_user_id) VALUES (?, ?)").run(totalCents, user.id);
    const insertItem = db.prepare(`
      INSERT INTO order_items (
        order_id, ticket_type_id, ticket_name_snapshot, price_cents_snapshot, quantity, line_total_cents
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of orderItems) {
      insertItem.run(
        order.lastInsertRowid,
        item.ticket.id,
        item.ticket.name,
        item.ticket.price_cents,
        item.quantity,
        item.lineTotalCents
      );
    }

    db.exec("COMMIT");
    sendJson(res, 201, { order: { id: Number(order.lastInsertRowid), totalCents } });
  } catch (error) {
    db.exec("ROLLBACK");
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
    throw error;
  }
}

function adminSummary(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const latestBreakpoint = db.prepare(`
    SELECT id, label, created_at AS createdAt
    FROM breakpoints
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get() || null;

  sendJson(res, 200, {
    global: getSummary(null),
    currentShift: {
      breakpoint: latestBreakpoint,
      ...getSummary(latestBreakpoint?.createdAt || null)
    }
  });
}

function getSummary(fromCreatedAt) {
  const where = fromCreatedAt ? "WHERE orders.created_at >= ?" : "";
  const args = fromCreatedAt ? [fromCreatedAt] : [];
  const total = db.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) AS totalRevenueCents, COUNT(*) AS orderCount
    FROM orders
    ${where}
  `).get(...args);

  const items = db.prepare(`
    SELECT
      COALESCE(order_items.ticket_type_id, 0) AS ticketTypeId,
      order_items.ticket_name_snapshot AS name,
      COALESCE(SUM(order_items.quantity), 0) AS quantity,
      COALESCE(SUM(order_items.line_total_cents), 0) AS revenueCents
    FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    ${where}
    GROUP BY order_items.ticket_type_id, order_items.ticket_name_snapshot
    ORDER BY name
  `).all(...args);

  return {
    orderCount: total.orderCount,
    totalRevenueCents: total.totalRevenueCents,
    items
  };
}

function listBreakpoints(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const breakpoints = db.prepare(`
    SELECT breakpoints.id, breakpoints.label, breakpoints.created_at AS createdAt, users.username AS createdBy
    FROM breakpoints
    LEFT JOIN users ON users.id = breakpoints.created_by_user_id
    ORDER BY breakpoints.created_at DESC, breakpoints.id DESC
    LIMIT 50
  `).all();
  sendJson(res, 200, { breakpoints });
}

async function createBreakpoint(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const body = await readJson(req);
  const label = cleanString(body.label, 120) || null;
  const result = db.prepare("INSERT INTO breakpoints (label, created_by_user_id) VALUES (?, ?)").run(label, user.id);
  const breakpoint = db.prepare("SELECT id, label, created_at AS createdAt FROM breakpoints WHERE id = ?").get(result.lastInsertRowid);
  sendJson(res, 201, { breakpoint });
}

async function createTicketType(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const body = await readJson(req);
  const ticket = validateTicketBody(body, true);
  const result = db.prepare(`
    INSERT INTO ticket_types (name, price_cents, color, sort_order, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticket.name, ticket.priceCents, ticket.color, ticket.sortOrder, ticket.active ? 1 : 0);

  const row = db.prepare(`
    SELECT id, name, price_cents AS priceCents, color, sort_order AS sortOrder, active
    FROM ticket_types WHERE id = ?
  `).get(result.lastInsertRowid);
  sendJson(res, 201, { ticketType: normalizeTicket(row) });
}

async function updateTicketType(req, res, path) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const id = Number(path.split("/").at(-1));
  if (!Number.isInteger(id) || id <= 0) return sendJson(res, 400, { error: "Invalid ticket type id" });
  const existing = db.prepare("SELECT * FROM ticket_types WHERE id = ?").get(id);
  if (!existing) return sendJson(res, 404, { error: "Ticket type not found" });

  const body = await readJson(req);
  const ticket = validateTicketBody({
    name: body.name ?? existing.name,
    priceCents: body.priceCents ?? existing.price_cents,
    color: body.color ?? existing.color,
    sortOrder: body.sortOrder ?? existing.sort_order,
    active: body.active ?? Boolean(existing.active)
  }, true);

  db.prepare(`
    UPDATE ticket_types
    SET name = ?, price_cents = ?, color = ?, sort_order = ?, active = ?, updated_at = ${nowSql}
    WHERE id = ?
  `).run(ticket.name, ticket.priceCents, ticket.color, ticket.sortOrder, ticket.active ? 1 : 0, id);

  const row = db.prepare(`
    SELECT id, name, price_cents AS priceCents, color, sort_order AS sortOrder, active
    FROM ticket_types WHERE id = ?
  `).get(id);
  sendJson(res, 200, { ticketType: normalizeTicket(row) });
}

function validateTicketBody(body) {
  const name = cleanString(body.name, 80);
  const priceCents = Number(body.priceCents);
  const color = cleanString(body.color, 20) || "#2563eb";
  const sortOrder = Number(body.sortOrder || 0);
  const active = body.active !== false;

  if (!name) throw new HttpError(400, "Ticket name is required");
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 1000000) {
    throw new HttpError(400, "Ticket price is invalid");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, "Ticket color must be a hex color");
  if (!Number.isInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000) {
    throw new HttpError(400, "Ticket sort order is invalid");
  }

  return { name, priceCents, color, sortOrder, active };
}

function normalizeTicket(row) {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.priceCents,
    color: row.color,
    sortOrder: row.sortOrder,
    active: Boolean(row.active)
  };
}

function userResponse(user) {
  return { id: user.id, username: user.username, role: user.role };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(path, res) {
  const normalizedPath = path === "/" ? "/index.html" : path;
  const requested = resolve(publicDir, `.${decodeURIComponent(normalizedPath)}`);
  if (!requested.startsWith(publicDir) || !existsSync(requested)) {
    return serveStatic("/index.html", res);
  }

  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  const ext = extname(requested);
  const isProd = env.nodeEnv === "production";
  const cacheControl = ext === ".html" ? "no-store" : (isProd ? "public, max-age=3600" : "no-store");
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": cacheControl
  });
  res.end(readFileSync(requested));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
