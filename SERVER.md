# Server Implementation

This app uses a very small backend:

- `server/index.js` is the HTTP server and API implementation.
- `public/` contains the frontend served by the backend.
- SQLite is accessed through Node's built-in `node:sqlite` module.
- No Express, ORM, build step, or native npm package is required.

## Runtime Requirements

Use Node.js 24 or newer. The current development environment uses Node.js 25.

## Environment Variables

Copy `.env.example` values into your deployment environment or PM2 config.

```txt
PORT=3100
HOST=127.0.0.1
DATABASE_PATH=/var/lib/abendkasse/abendkasse.sqlite
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me
CASHIER_USERNAME=cashier
CASHIER_PASSWORD=replace-me-too
```

Important:

- `SESSION_SECRET` should be a long random value.
- Default users are only seeded when the `users` table is empty.
- Change `ADMIN_PASSWORD` and `CASHIER_PASSWORD` before the first production start.

## Persistence Model

The database is created automatically on startup.

Tables:

- `users`
- `sessions`
- `ticket_types`
- `orders`
- `order_items`
- `breakpoints`

Orders are immutable. Each order item stores a ticket name and price snapshot, so later ticket edits do not rewrite historical sales.

Breakpoints are timestamps. Creating a breakpoint does not reset or delete counters. The admin summary reports:

- global totals across all orders
- current shift totals since the latest breakpoint

If no breakpoint exists, current shift totals count from the beginning.

## API Overview

Auth:

```txt
POST /api/login
POST /api/logout
GET  /api/me
```

Cashier:

```txt
GET  /api/ticket-types
POST /api/orders
```

Admin:

```txt
GET   /api/admin/summary
GET   /api/admin/breakpoints
POST  /api/admin/breakpoints
POST  /api/admin/ticket-types
PATCH /api/admin/ticket-types/:id
```

## Local Development

```sh
npm run dev
```

The development server listens on:

```txt
http://127.0.0.1:3100
```

The local database defaults to:

```txt
./data/abendkasse.sqlite
```

## Production With PM2

Create the data directory:

```sh
sudo mkdir -p /var/lib/abendkasse
sudo chown "$USER":"$USER" /var/lib/abendkasse
```

Set production environment values in `ecosystem.config.cjs`, then start:

```sh
pm2 start ecosystem.config.cjs
pm2 save
```

View logs:

```sh
pm2 logs abendkasse
```

Restart after changes:

```sh
pm2 restart abendkasse
```

## nginx Reverse Proxy

Example nginx site:

```nginx
server {
  server_name abendkasse.example.com;

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Add TLS with certbot or the existing server convention.

## Backups

SQLite can be backed up while the app is running:

```sh
mkdir -p /var/backups/abendkasse
sqlite3 /var/lib/abendkasse/abendkasse.sqlite ".backup '/var/backups/abendkasse/abendkasse-$(date +%F).sqlite'"
```

Run that from cron or the server's existing backup system.

## Operational Notes

- The app binds to `127.0.0.1` by default so nginx can be the public entrypoint.
- Sessions expire after 12 hours.
- Admin users can edit ticket types. Edits affect future orders only.
- Inactive ticket types remain visible to admins and hidden from cashiers.
