# ImmersiTest

**Test the Experience. Trust the Immersion.**

A free XR application testing and analysis tool by **Wizardlenz XR Studio**.

Profile a Unity XR application, then get an evidence-based quality report —
performance, XR functionality, comfort and stability — in your browser.
No account. Nothing kept afterwards.

```
Unity XR project
   └─ ImmersiTest Unity package
        └─ XR Test Profiler ──▶ xrtest_*.json
                                    │  HTTPS POST
                                    ▼
                          ImmersiTest hosted API
                                    │  temporary analysis + token
                                    ▼
                      browser opens the report automatically
                                    │
                     Analyse → Diagnose → Improve → PDF
                                    │
                          expires and is deleted
```

**INSTALL → TEST → ANALYSE → DIAGNOSE → IMPROVE → REPORT**

---

## For users

1. Install the **ImmersiTest** Unity package.
2. **ImmersiTest → Add Test Profiler**, then set the Application Name and
   Target FPS.
3. **ImmersiTest → Run XR Test** — Play Mode starts and profiling begins.
4. Exercise your experience, then leave Play Mode.
5. Your report uploads and opens in the browser automatically.

Tester name is optional. A test is perfectly valid without it.

See [docs/UNITY-PACKAGE.md](docs/UNITY-PACKAGE.md).

## Privacy in one line

**Only the generated profiler JSON is uploaded.** Never your project, C#
source, scenes, prefabs, assets, models, textures, materials or repository.
Reports are held in memory and deleted automatically — there are no accounts,
and you can delete an analysis yourself at any time.

Full statement, with the code and tests that enforce it:
[docs/PRIVACY.md](docs/PRIVACY.md).

---

## What the report contains

| Section | Contents |
|---|---|
| **Quality Score** | Score out of 100, classification A–F, overall status |
| **Performance** | Average FPS, Bad Frame %, Average Frame Time, Memory — the four scored metrics |
| **Diagnostics** | Minimum FPS, 1% Low FPS, Draw Calls, Triangles, Battery — captured, never scored |
| **Evaluation Areas** | Where the 100 marks came from |
| **XR Health** | Condition per area, each with the number behind it |
| **Fix First** | The highest-priority observable issue, its evidence, and where to look |
| **XR Doctor** | Developer-facing readout plus evidence-based recommendations |
| **Charts** | FPS, frame time and memory over the session |
| **XR Validation** | The eight XR quality items |
| **Comparison / Trend** | When more than one report is loaded into the analysis |

Export as **PDF** — a professional XR Application Test Report. It is the only
user-facing export in the hosted tool.

## Scoring

```
Final Score = Performance (60) + XR Validation (40) = 100
```

| Scored metric | PASS | WARN | FAIL |
|---|---|---|---|
| Average FPS | ≥ 97% of target | ≥ 85% | below |
| Bad Frames | ≤ 1% | ≤ 5% | above |
| Frame Time | ≤ 1.03× budget | ≤ 1.18× | above |
| Memory | ≤ 70% of cap | ≤ cap | above (AR 1500 MB, VR 2800 MB) |

15 marks each. Eight XR validation items at 5 marks each. Grades: A ≥ 90,
B ≥ 80, C ≥ 70, D ≥ 60, else F. Status: PASS ≥ 70, WARN ≥ 60, else FAIL.

A capture that recorded no frames scores **N/A** — a broken capture is never
treated as a failed application.

The score is a quality classification for the application under test, not an
academic grade. Everything lives in
[`shared/xr-metrics/index.js`](shared/xr-metrics/index.js), imported by the
server, browser, PDF and Excel so they cannot disagree.
Full model: [docs/SCORING.md](docs/SCORING.md).

---

## Running it

### Two modes

| Mode | Purpose | Storage |
|---|---|---|
| `local` *(default)* | Development and offline single-machine use. Adds a SQLite dashboard for applications, testers, test history and defects. Binds `127.0.0.1`. | Permanent, in `data/` |
| `hosted` | The public service. Only the analysis endpoints exist. | **None** — temporary in-memory analyses that expire |

```bash
npm install
npm start                  # local mode  → http://localhost:3000
npm run start:hosted:dev   # hosted mode → http://localhost:3200
npm test                   # full suite
npm run package:unity      # build the distributable Unity package
```

Node.js 22.5+ (SQLite is built in — nothing else to install). After
`npm install` the app needs no internet: Chart.js and jsPDF are copied into
`web/vendor/` automatically and served locally.

### Deployment

Production configuration, reverse proxy, sizing and verification:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). All environment variables are
documented in [`.env.example`](.env.example) — nothing about the deployment is
hard-coded, and hosted mode refuses to start without an HTTPS public URL.

---

## Input contract

The importer accepts `schema` = `"xr-test-profile-v1"` and reads every field the
profiler emits, including `series[]`. Unknown schema versions are rejected with
a clear message rather than guessed at.

Sentinels are preserved in meaning: `drawCalls`, `triangles` and `batteryLevel`
of `-1` mean "unavailable" and display as `—`. A report with `totalFrames <= 0`
is stored as an **INVALID CAPTURE** — evidence a test was attempted,
deliberately left ungraded.

On the wire the tester fields are still named `studentName` and `studentId`, so
reports captured by earlier profiler versions analyse correctly. Only an optional
**Tester name** is surfaced; the id field is always empty and never shown.

## Local mode extras

The local dashboard adds what a persistent instance can offer: applications,
testers, full test history (nothing is ever overwritten), defect tracking,
bulk import with a valid/duplicate/invalid preview, a portable JSON backup and
an Excel export.

| Path | Contents |
|---|---|
| `data/xr-test-lab.db` | SQLite database — the source of truth |
| `data/reports/*.json` | The original uploaded report, byte-for-byte |

Nothing is deleted silently. Applications and testers are **archived** by
default; permanent delete is a separate, explicit choice that states exactly
what it will remove. A startup check prunes report files left behind by an
interrupted delete.

## Layout

```
immersitest/
├─ unity/src/com.wizardlenz.xrtestlab/   Unity package source (ships as DLLs)
│  ├─ Runtime/   XR Test Profiler
│  └─ Editor/    menu, settings, play-mode runner, uploader
├─ web/                        Dashboard (vanilla ES modules, no build step)
├─ server/src/                 Express API
│  ├─ routes/                  analysis (hosted) + dashboard (local)
│  ├─ services/                analysisStore, excel, grading, identity, deletion
│  ├─ ingest/                  validation + import pipeline
│  ├─ db/                      schema.sql, connection, migrations (local only)
│  └─ lib/                     errors, security (CORS, headers, rate limit)
├─ shared/xr-metrics/          Evaluation core — server AND browser
├─ scripts/                    vendor assets, build Unity package, dev helpers
├─ data/                       SQLite + original reports (local only, gitignored)
└─ docs/
```

## Documentation

| Document | Covers |
|---|---|
| [docs/SCORING.md](docs/SCORING.md) | The evaluation model, thresholds, XR Health / Fix First / XR Doctor |
| [docs/PRIVACY.md](docs/PRIVACY.md) | What is uploaded, retention, and how it is enforced |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hostinger deployment, env vars, sizing, verification |
| [docs/UNITY-PACKAGE.md](docs/UNITY-PACKAGE.md) | Building, shipping and verifying the Unity package |

---

<sub>ImmersiTest · Wizardlenz XR Studio · Test the Experience. Trust the Immersion.</sub>
