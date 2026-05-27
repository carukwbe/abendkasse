# Abendkasse

A lightweight full-stack app for tracking direct ticket purchases at the entrance.

The app is intentionally dependency-free at runtime:

- Node.js HTTP server
- built-in `node:sqlite` persistence
- static HTML/CSS/JavaScript frontend
- cookie-based sessions

See [SERVER.md](./SERVER.md) for backend, deployment, PM2, nginx, and backup details.

## Local start

```sh
npm run dev
```

Then open:

```txt
http://127.0.0.1:3100
```

Default development logins:

```txt
admin / admin
cashier / cashier
```

Set real passwords through environment variables before production use.
