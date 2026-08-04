# Dengue early warning system — scaffold

Frontend: React + Vite. Backend: plain Node.js `http` server (no Express) + MySQL via `mysql2`.
The Bayesian-neural hybrid model itself runs as a separate Python service that writes
`predictions` and `evaluation_metrics` rows into MySQL; this app reads and displays them.

**Docs:**
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the system fits together, what every
  folder does, and a step-by-step run guide
- [VSCODE_SETUP_GUIDE.md](VSCODE_SETUP_GUIDE.md) — guided first run inside VS Code

The quick reference below assumes you already know the stack.

## 1. Database

```bash
mysql -u root -p -e "CREATE DATABASE dengue_hybrid"
cd backend
cp .env.example .env   # fill in your MySQL credentials
npm install
npm run migrate        # creates all tables from migrations/schema.sql
import dengueDB.sql from your local MySQL database
```

## 2. Backend API

```bash
cd backend
npm run dev             # http://localhost:4000
```

Endpoints:
- `GET  /api/regions`
- `GET  /api/cases?regionId=`
- `POST /api/cases/bulk`               body: `{ rows: [{ region_id, date, confirmed_cases, deaths }] }`
- `GET  /api/predictions/:regionId`
- `GET  /api/models/compare`
- `GET  /api/alerts`
- `POST /api/auth/login`               body: `{ email, password }`

## 3. Frontend

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

## Notes

- The backend has no framework dependency by design — routing is a ~40-line matcher in
  `src/routes/router.js`. If the route table grows large, consider Express or Fastify.
- `users.password_hash` expects a bcrypt hash — seed an admin user with `bcryptjs` before
  testing `/api/auth/login`.
- The `predictions` and `evaluation_metrics` tables are meant to be populated by your
  Python model service (batch job or scheduled task), not by this Node API.
