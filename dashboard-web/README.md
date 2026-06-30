# career-ops Web Dashboard

A web platform to track and visualize your job search. It reads career-ops' own
data files live — **there is no separate database**. When the agent scans,
evaluates, or updates an application, the dashboard reflects it on the next
refresh.

## Architecture

```
data/applications.md  ─┐
data/pipeline.md       ├─►  server.mjs (Node, zero-dep)  ──/api/data──►  public/ (browser)
data/scan-history.tsv  │     reads files fresh per request                charts + tables
reports/*.md           ┘     templates/states.yml = shared status contract
config/profile.yml
```

- **Backend** (`server.mjs` + `lib/parsers.mjs`): pure Node HTTP server, no
  `npm install` needed — it reuses career-ops' bundled `js-yaml`. Reads the data
  files on every request, so it's always current.
- **Frontend** (`public/`): self-contained HTML/CSS/JS. Charts via Chart.js
  (CDN; degrades to text if offline). Auto-refreshes every 15s.

## Run

```cmd
dashboard-web\start.cmd
```

or manually (from the career-ops root):

```cmd
node dashboard-web\server.mjs
```

Then open http://localhost:4317. Change the port with `set PORT=8080` first.

> Requires `NODE_OPTIONS=--use-system-ca` on the corporate network (already set
> globally for this user). `start.cmd` sets it too, just in case.

## API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/data` | Full snapshot: profile, applications, pipeline, scan history, reports, computed stats |
| PATCH | `/api/applications/:num` | Update `status` (and optional `notes`) of an existing application row in `applications.md`. Validated against `templates/states.yml`. |

## What it shows

- **KPIs**: applications, pipeline pending, roles scanned, applied, interviews, offers, avg score
- **Application funnel**: Evaluated → Applied → Responded → Interview → Offer (+ Rejected/Discarded/SKIP)
- **Charts**: status distribution, score distribution, scan activity over time, top companies
- **Applications table**: sortable/filterable, with an inline status dropdown that writes back to `applications.md`
- **Pipeline table**: pending roles awaiting `/career-ops pipeline` evaluation

## Notes

- The status dropdown only **updates existing** rows (contract-safe). New rows
  must still be created by the evaluation flow (TSV + `merge-tracker.mjs`), never
  by the dashboard.
- This is read-mostly: the source of truth stays in the markdown/TSV files, so
  career-ops CLI and the dashboard never disagree.
