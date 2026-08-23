# ImmersiTest — Unity Package

**Wizardlenz XR Studio** · *Test the Experience. Trust the Immersion.*

Capture performance from a Unity XR project and analyse it in ImmersiTest.
Free, no account, nothing kept afterwards.

---

## Install

**Assets → Import Package → Custom Package…** and select
`ImmersiTest.unitypackage`, then **Import**.

Everything lands under `Assets/ImmersiTest/`. An **ImmersiTest** menu appears in
the Unity menu bar.

## Use

| Menu item | What it does |
|---|---|
| **Add Test Profiler** | Creates an `XR Test Profiler` GameObject in the open scene and selects it. Running it again just selects the existing one — you never get two. |
| **Run XR Test** | Validates the configuration, then enters Play Mode. |
| **Open Last Report** | Reopens the most recent analysis. |
| **Open Reports Folder** | The folder the JSON reports are written to. |
| **Analyse an Existing Report…** | Upload a report you captured earlier. |
| **Settings** | Project Settings → ImmersiTest. |

1. **Add Test Profiler**
2. Set **Application Name** and **Target FPS** in the Inspector
   (72 or 90 for VR headsets, 60 for mobile AR). Tester name and ID are optional.
3. **Run XR Test** — Play Mode starts and profiling begins automatically.
4. Exercise the experience the way a user would.
5. Leave Play Mode. The report uploads and opens in your browser automatically.

Reports are written to `<project>/XRTestReports/` in the Editor, and to
`Application.persistentDataPath` in a build.

## What gets uploaded

**Only the generated profiler JSON**: frame timings, memory figures, the
device/GPU/OS strings Unity exposes, and the sample series.

**Never uploaded:**

- your Unity project or project folder
- C# source, scenes, prefabs
- assets, models, textures, materials
- your repository or any version-control metadata

The upload path reads exactly one file — the report you are analysing — and has
no code path that can attach anything else.

Analyses are held in memory by the service and deleted automatically after a
short retention period. There are no accounts. You can delete an analysis
immediately from the report page.

## What is measured

| Scored metric | Marks |
|---|---|
| Average FPS | 15 |
| Bad Frame % | 15 |
| Average Frame Time | 15 |
| Memory | 15 |

Plus eight XR validation items at 5 marks each — **60 + 40 = 100**.

Minimum FPS, 1% Low FPS, draw calls, triangles and battery are captured and
reported as diagnostics but are **not** scored. A capture that recorded no
frames scores **N/A**: a broken capture is never treated as a failed
application.

## Requirements

Unity **2021.3** or newer. No other packages required.

Draw call and triangle counts come from the Editor only; in a build they are
reported as `-1` (“unavailable”) by design.

## Support

<https://wizardlenz.com>
