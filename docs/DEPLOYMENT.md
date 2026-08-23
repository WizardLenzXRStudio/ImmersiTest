# Deploying ImmersiTest (Hostinger)

**Wizardlenz XR Studio** · production runbook for the public service.

ImmersiTest runs as a single Node process serving both the API and the web
application from one origin. There is no database to provision, no object
store, no queue and no cache — the hosted service holds analyses in memory and
deletes them on a timer.

---

## 1. What production looks like

```
Unity XR project
   └─ ImmersiTest Unity package
        └─ XR Test Profiler ──▶ xrtest_*.json
                                    │  HTTPS POST /api/analyze
                                    ▼
                        Hostinger (Node, XRLAB_MODE=hosted)
                                    │  temporary in-memory analysis + token
                                    ▼
                    https://<your-domain>/#/r/<token>
                                    │
                        Analyse → Diagnose → PDF / Excel
                                    │
                          expires and is deleted
```

**No database. No accounts. No permanent report storage.**

## 2. Requirements

| Requirement | Value |
|---|---|
| Node.js | 22.5 or newer (the app uses the built-in `node:sqlite` in local mode) |
| Memory | 512 MB is comfortable; see [§7](#7-sizing) |
| TLS | required — hosted mode refuses to start without an HTTPS public URL |
| Persistent disk | **not needed** |

## 3. Deploy

On Hostinger, create a **Node.js application** pointing at the repository root.

```bash
npm ci --omit=dev
```

`postinstall` copies Chart.js and jsPDF into `web/vendor/`, so the front end has
no CDN dependency. If your host skips lifecycle scripts, run it explicitly:

```bash
npm run postinstall
```

Start command:

```bash
npm start
```

### Environment

Set these in the Hostinger panel (or a `.env` the panel loads). Full list with
comments in [`.env.example`](../.env.example).

| Variable | Production value | Why |
|---|---|---|
| `XRLAB_MODE` | `hosted` | No database, no permanent storage, only the analysis endpoints |
| `XRLAB_PUBLIC_URL` | `https://your-domain` | The link the Unity package opens. **Must be HTTPS** |
| `XRLAB_HOST` | `0.0.0.0` | Bind behind the reverse proxy |
| `PORT` | as assigned by the panel | |
| `XRLAB_TRUST_PROXY` | `1` | One proxy hop, so rate limiting sees the real client IP |
| `XRLAB_HSTS` | `true` | Once the domain is HTTPS-only |
| `XRLAB_SESSION_TTL_MINUTES` | `60` | Retention window |
| `XRLAB_UPLOAD_LIMIT` | `4mb` | Single-report ceiling |
| `XRLAB_RATE_MAX` | `30` | Uploads per IP per minute |

`XRLAB_ALLOWED_ORIGINS` is only needed if a **different** domain's browser code
calls this API. The origin of `XRLAB_PUBLIC_URL` is always allowed, and the
Unity package sends no `Origin` header, so it is unaffected either way.

> Hosted mode **fails to start** if `XRLAB_PUBLIC_URL` is not HTTPS. That is
> deliberate: a plain-HTTP deployment would send report links, and the reports
> themselves, in the clear. The `XRLAB_ALLOW_INSECURE=true` escape hatch exists
> for a trusted staging box and must never be set in production.

## 4. Reverse proxy

Terminate TLS in front of the app and forward the client IP.

```nginx
location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    # Profiler reports are small, but allow headroom above XRLAB_UPLOAD_LIMIT.
    client_max_body_size 8m;
}
```

Force HTTPS at the proxy — the app assumes it is reached over TLS and emits
HSTS when `XRLAB_HSTS=true`.

## 5. Verify the deployment

```bash
curl -s https://your-domain/api/health
```

```json
{ "status": "ok", "mode": "hosted", "database": "not-used", "version": "2.0.0" }
```

Then confirm the guarantees hold in production:

```bash
# The permanent-storage routes must not exist.
for p in projects students sessions bugs dashboard/stats data/summary migrate/status; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://your-domain/api/$p"
done   # every line must print 404

# A real upload round-trip.
curl -s -X POST https://your-domain/api/analyze \
     -H 'content-type: application/json' \
     --data-binary @some-xrtest-report.json
```

The response carries `token`, `reportUrl` and `expiresInSeconds`. Open the
`reportUrl`, confirm the report renders, then wait out the TTL and confirm it
returns `410 SESSION_EXPIRED`.

Check the security headers:

```bash
curl -sI https://your-domain/api/health | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type'
```

## 6. Point the Unity package at production

Before publishing the package, set `DefaultServiceUrl` in
`unity/src/com.wizardlenz.xrtestlab/Editor/ImmersiTestSettings.cs` to the real
domain, then rebuild it (see [UNITY-PACKAGE.md](UNITY-PACKAGE.md)). Users can
override it in **Project Settings → ImmersiTest**, but the default is what
almost everyone will use.

## 7. Sizing

Memory is the only meaningful resource. A typical report with a 40-sample
series is a few KB; a long session with thousands of samples can reach a few
hundred KB. Two ceilings bound the total:

- `XRLAB_MAX_SESSIONS` (default 1000)
- `XRLAB_MAX_TOTAL_BYTES` (default 256 MB)

When either is exceeded the oldest analyses are evicted immediately. Combined
with `XRLAB_UPLOAD_LIMIT`, the service has a hard memory ceiling and cannot be
grown without bound by uploads.

Watch it with:

```bash
curl -s https://your-domain/api/analysis-stats
```

```json
{ "sessions": 12, "reports": 17, "bytes": 402118, "ttlMinutes": 60 }
```

That endpoint exposes counts only — never a token, never report contents.

## 8. Restarts and scaling

Analyses live in the process. **A restart drops every in-flight analysis**, and
users see the normal "this analysis has expired" message. That is the correct
trade for a service that promises to retain nothing, but it means:

- deploy at quiet times where you can
- run **one** instance, or add sticky sessions if you must run several — a
  token created on instance A is unknown to instance B

If you later need multi-instance, the only shared state is
`server/src/services/analysisStore.js`. Swapping its `Map` for Redis with a TTL
is a contained change; nothing else in the app knows how sessions are stored.

## 9. Local development against the same code

```bash
npm start                  # local mode: SQLite dashboard, loopback only
npm run start:hosted:dev   # hosted mode on :3200 with development defaults
npm test                   # full suite
```

`start:hosted:dev` sets `XRLAB_ALLOW_INSECURE=true` and a 15-minute TTL so the
public workflow can be exercised on a laptop. It is a development helper and is
not used in production.

## 10. What is never deployed

- no login, signup, session cookies or user records
- no analytics or third-party scripts (the CSP blocks them)
- no CDN — Chart.js and jsPDF are served from `web/vendor/`
- no database in hosted mode
- no uploaded report on disk, ever
