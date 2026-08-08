# Running the dengue early warning UI in VS Code

This is the companion app to the *Bayesian-Neural Hybrid Prediction Model for Dengue
Virus* project: a React + Vite frontend and a plain Node.js + MySQL backend (no
Express) that displays the model's forecasts, credible intervals, and comparative
evaluation results (hybrid vs. SARIMA/LSTM baselines). The Bayesian-neural model
itself is assumed to run as a separate Python service that writes into the
`predictions` and `evaluation_metrics` tables — this app only reads and visualizes
what's already in MySQL.

## 1. Prerequisites

Install these once, before opening the project:

| Tool | Version | Check with |
|---|---|---|
| Node.js | 18 LTS or newer | `node -v` |
| npm | comes with Node | `npm -v` |
| MySQL Server | 8.x | `mysql --version` |
| VS Code | latest | — |

A local MySQL 8 install is all you need — Docker is not required, and if MySQL
is already running on port 3306 you can skip straight to step 3.

<details>
<summary>No MySQL installed? One-line Docker alternative</summary>

```bash
docker run --name dengue-mysql -e MYSQL_ROOT_PASSWORD=root -p 3306:3306 -d mysql:8
```
</details>

## 2. Open the project

1. Unzip `dengue-prediction-app.zip`.
2. In VS Code: **File → Open Folder…** → select the unzipped `dengue-prediction-app` folder.
3. VS Code will detect `.vscode/extensions.json` and prompt **"This workspace has
   extension recommendations"** — click **Install All**. These give you:
   - ESLint + Prettier (linting/formatting on save)
   - `cweijan.vscode-mysql-client2` (browse MySQL tables without leaving VS Code)
   - React snippets
   - REST Client (to run `.http` files directly)
   - DotENV syntax highlighting

## 3. Create the database

Open the integrated terminal (`` Ctrl+` `` / `` Cmd+` ``):
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS dengue_hybrid CHARACTER SET utf8mb4"
```
(If you used the Docker alternative above, the password is `root`.)

On Windows, `mysql` is often not on `PATH`. Either add
`C:\Program Files\MySQL\MySQL Server 8.0\bin` to it, or call the binary
directly:
```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "CREATE DATABASE IF NOT EXISTS dengue_hybrid CHARACTER SET utf8mb4"
```

## 4. Configure and set up the backend

```bash
cd backend
cp .env.example .env
```
Open the new `.env` file in VS Code and fill in your MySQL credentials:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=dengue_hybrid
PORT=4000
JWT_SECRET=pick_any_random_string
```

Install dependencies, create the tables, then load demo data:
```bash
npm install
npm run migrate
npm run seed
```
`npm run seed` prints a demo login (`admin@dews.local` / `password123`) and adds
sample regions, one forecast, evaluation metrics for three models, and two alerts —
enough to see every page populated on first run.

## 5. Start the backend

```bash
npm run dev
```
You should see `API server listening on http://localhost:4000`. Leave this terminal running.

**Sanity check** — open `backend/requests.http` in VS Code (installed via REST
Client above) and click **Send Request** above `GET /api/regions`. You should get
back the four seeded regions as JSON directly inside the editor.

## 6. Start the frontend

Open a second terminal (the `+` icon in the terminal panel, or `` Ctrl+Shift+` ``):
```bash
cd frontend
npm install
npm run dev
```
Open the printed URL, typically **http://localhost:5173**. You should see the
Dashboard with the seeded alert count, the best-performing model, and the alerts
table.

*Tip:* instead of two manual terminals, use **Terminal → Run Task… → Run full
stack**, which starts both dev servers at once using `.vscode/tasks.json`.

## 7. Walk through the pages

- **Dashboard** — the hero figure (regions at high risk or above) plus stat
  tiles for the leading model, its interval coverage, the latest national case
  count with a week-over-week delta, and the RMSE gain over the next-best
  model; then recent alerts and current risk for every region.
- **Forecast** — opens on the highest-risk region. Observed surveillance counts
  and the hybrid model's forecast share one case-count axis, with the credible
  interval drawn as a shaded band and a rule marking where the forecast starts.
  The **Table** toggle shows the same numbers, including interval width.
- **Model comparison** — five metrics on five different scales, so they are
  five small charts rather than one plot with two y-axes. Each model keeps its
  colour across all five. The **Table** toggle marks the winner per metric.
- **Data management** — drag a CSV onto the dropzone
  (`region_id,date,confirmed_cases,deaths`). Uploads upsert on region + date,
  and the region-id reference table sits beside the dropzone.
- **Alerts** — filter by risk level; counts per level sit in the filter row.
- **Risk map** — a choropleth of all 142 CALABARZON cities and municipalities,
  switchable by year and between raw cases and cases per 100,000. Hover or
  tab to any municipality for its figures. Empty until you run the ETL below.

Two things are available on every page from the top-right of the header:

- **Theme** — cycles light → dark → match system. The choice persists, and a
  pre-paint script keeps a dark load from flashing white.
- **Account** — signs in with the seeded demo user. Routes are public; the
  session only matters for write operations.

## 7b. Load the real research data (optional)

`npm run seed` only gives you four placeholder regions. To point the app at the
actual dataset in `RESEARCH DATA SET/`:

```bash
cd backend
npm run etl -- --dry-run                      # defect report, writes nothing
npm run etl                                   # 142 LGUs, 692 case-years, 6,720 climate rows
npm run etl:boundaries -- --update-regions    # builds the map (needs internet once)
```

Read the dry-run output before the real run — it lists every defect it is about
to repair (OCR-corrupted municipality names, the PAGASA `-999` sentinel,
duplicate and blank rows) and two it cannot. The reasoning behind each is in
[DATA_ASSESSMENT.md](DATA_ASSESSMENT.md).

Both commands are idempotent. Re-running `npm run etl` upserts.

### If `npm run migrate` says "baseline"

That is expected on a database created before the versioned migration runner
existed. It records `001_initial_schema.sql` as already applied — because its
tables demonstrably exist — and then applies anything newer. Re-running
`npm run migrate` at any time is safe; the `schema_migrations` table is the
ledger.

### Duplicate rows after running `npm run seed` twice

`seed.js` is not yet idempotent, so a second run duplicates the demo regions
and model runs (the Model comparison page then shows 6 rows instead of 3).
To inspect and clean:

```bash
npm run dedupe             # report only, changes nothing
npm run dedupe -- --apply  # delete the duplicates
```


## 8. Debugging the backend in VS Code

Go to **Run and Debug** (`Ctrl+Shift+D`) → select **Debug backend (Node + MySQL)**
→ press **F5**. This runs `backend/src/server.js` under the debugger using the
`.env` file automatically, so you can set breakpoints in any controller (e.g.
`predictionsController.js`) and inspect the SQL results live.

## 9. Common issues

| Symptom | Fix |
|---|---|
| `ECONNREFUSED` on backend start | MySQL isn't running, or `.env` credentials are wrong |
| `ER_NOT_SUPPORTED_AUTH_MODE` | Run `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';` |
| Frontend loads but pages show "loading…" forever | Backend isn't running, or didn't run on port 4000 — check the terminal for errors |
| `/api/auth/login` returns 401 | Run `npm run seed` first, or double-check the email/password |
| Port 4000 or 5173 already in use | Change `PORT` in `.env` (backend), or free the port: `Get-NetTCPConnection -LocalPort 4000 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| Forecast page is empty for a region | Only regions with rows in `predictions` have a forecast; the seed writes one for the first region only |

## 10. Next step: the model service

Right now `predictions` and `evaluation_metrics` only contain the seeded demo
numbers. The next piece to build is the Python service that actually trains and
runs the Bayesian-neural hybrid model and writes its real output into those same
tables — at that point this UI will reflect the live model instead of sample data.
