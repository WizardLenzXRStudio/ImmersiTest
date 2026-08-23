# Privacy & Data Retention

**ImmersiTest** · Wizardlenz XR Studio

This is the technical statement of what ImmersiTest does with your data. It
describes the behaviour of the code in this repository, and each claim points at
where it is implemented and tested.

---

## Summary

- **Only the generated profiler JSON is uploaded.** Never your project, source,
  scenes, prefabs, assets or repository.
- **There are no accounts.** No login, no signup, no profile. Nothing is tied to
  an identity.
- **Reports are temporary.** They live in memory on the server and are deleted
  automatically. Nothing is written to disk.
- **You can delete an analysis immediately** from the report page.

## 1. What is uploaded

Exactly one thing: the JSON document the XR Test Profiler produced.

| Field group | Contents |
|---|---|
| Identity | application name; optional tester name (blank unless you fill it in) |
| Capture | timestamp, duration, target FPS, platform (`VR`/`AR`) |
| Environment | `SystemInfo.deviceModel`, `graphicsDeviceName`, `operatingSystem` |
| Metrics | average/min/1%-low FPS, frame time, dropped and total frames, memory |
| Diagnostics | draw calls, triangles, battery level and status |
| Series | periodic samples of FPS, frame time and memory |

That is the whole payload. You can read it before uploading: the file is written
to `<project>/XRTestReports/` in the Editor.

## 2. What is never uploaded

- your Unity project or project folder
- C# source files
- scenes, prefabs
- assets, models, textures, materials, audio
- your repository or any version-control metadata
- environment variables, credentials, machine identifiers, IP-based location

### How this is enforced

The Unity package has exactly one place that performs network I/O
(`Editor/ImmersiTestUploader.cs`), and the only file it ever reads is the report
path it is handed:

```csharp
// The one and only file this package reads for upload.
json = File.ReadAllText(reportPath);
```

There is no directory traversal, no `AssetDatabase` access, no archiving and no
second request body. This is enforced by tests that fail the build if the
uploader ever gains the ability to read anything else — see
`server/tests/privacy-and-packaging.test.js`:

- *the Unity uploader reads exactly one file: the report it was given*
- *the Unity uploader sends the report body and nothing appended*
- *the Unity package makes network calls from one place only*

## 3. Retention

| Property | Behaviour |
|---|---|
| Where | Server memory only. Never written to disk. |
| How long | `XRLAB_SESSION_TTL_MINUTES` from upload (default 60 minutes). |
| Extended by use? | **No.** Expiry is absolute from creation; viewing a report does not prolong it. |
| Deleted when | At expiry, by an explicit delete, or when the process restarts. |
| Deleted how | Dropped from memory by a sweeper that runs on a timer and on every access. |

Implemented in `server/src/services/analysisStore.js`, which imports no
filesystem module at all — a test asserts that it cannot.

Tests covering this: *an expired analysis is gone*, *the sweeper removes expired
analyses without anyone asking*, *expiry is absolute — reading an analysis does
not extend its life*, *an analysis can be deleted on demand, immediately*.

## 4. Access to a report

A report is addressed by a token generated server-side from a CSPRNG
(`randomBytes(24)`, 192 bits, URL-safe). Nothing you supply — filename,
application name, tester name — is used to address it.

The token is the only access control, so treat a report URL as a secret:
anyone with the link can read that analysis until it expires. To reduce the
chance of a link leaking:

- report pages are served with `X-Robots-Tag: noindex, nofollow, noarchive`
- `Referrer-Policy: no-referrer` prevents the URL leaking to any site you click
  through to
- `frame-ancestors 'none'` blocks embedding

## 5. No accounts

There is no authentication code in the product. A test enumerates the server and
web source and fails if `passport`, `bcrypt`, `jsonwebtoken`,
`express-session`, `/login`, `/signup`, `/register` or `req.user` ever appear.

Because there are no accounts, there is no user record, no email address on
file, no password to breach and no profile to delete.

## 6. Logs

The service logs operational events — startup, sweeps, upload failures — and
does not log report contents or tokens. The `/api/analysis-stats` endpoint
exposes counts only:

```json
{ "sessions": 12, "reports": 17, "bytes": 402118, "ttlMinutes": 60 }
```

Your hosting provider's reverse proxy will keep its own access logs containing
request paths and client IPs. **A report URL contains its token, so proxy access
logs will contain tokens.** Configure log retention accordingly, and prefer a
short `XRLAB_SESSION_TTL_MINUTES` so a leaked historical log entry refers to an
analysis that no longer exists.

## 7. Third parties

None. There is no analytics, no telemetry, no error-reporting service and no
CDN. Chart.js and jsPDF are served from `web/vendor/` on the same origin, and
the Content-Security-Policy is `default-src 'self'` with `object-src 'none'`,
which blocks any external request the page might otherwise make.

## 8. The local instance is different

Running ImmersiTest in **local mode** (`npm start`) is a different product
posture: it keeps a permanent SQLite database and stores every imported report
under `data/`. That instance is yours, binds to `127.0.0.1` by default and is
not reachable from the network. Everything in this document about temporary
retention describes the **hosted** service.

## 9. Reporting a problem

If you believe ImmersiTest has transmitted or retained something this document
says it does not, contact Wizardlenz XR Studio at <https://wizardlenz.com>.
Please include the report ID shown on the analysis page — not the token.
