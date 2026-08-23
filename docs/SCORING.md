# ImmersiTest Quality Score

**Wizardlenz XR Studio**

Every **valid** test receives a score out of 100 and a quality classification:

```
Final Score = Performance (60) + XR Validation (40)
```

This is a **quality classification for the application under test**. It is not
an academic grade, and it does not evaluate a person.

All of it lives in one place — `GRADE_CONFIG` and `computeGrade()` in
[`shared/xr-metrics/index.js`](../shared/xr-metrics/index.js) — imported by the
server, the browser, the PDF builder and the Excel exporter, so the four can
never disagree.

---

## 1. What is evaluated

Four areas. Every mark in the 100 belongs to exactly one of them.

| Area | Marks | From |
|---|---|---|
| **Technical Performance** | 60 | the four measured metrics — this *is* the Performance Score |
| **XR Functionality** | 15 | Tracking & Input, Core Interaction, Spatial Audio |
| **Comfort & Usability** | 10 | Comfort & Motion, UI Readability |
| **Application Stability** | 10 | Application Stability, Exit / Reset |
| **Other XR Validation** | 5 | Performance Stability |

These are **classification buckets, not a second scoring system.** They regroup
the same 100 marks `computeGrade()` already produced, so a reader can see where the
marks came from thematically. Technical Performance holds exactly the four
measured metrics, so its 60 is the same 60 as the Performance Score; the human
judgement about sustained performance sits in its own bucket so the two can
never be confused.

## 2. Performance — 60 marks

Four metrics, **15 marks each**. Marks come straight from the PASS/WARN/FAIL
judgement functions — there are no separate scoring thresholds.

| Metric | PASS | WARN | FAIL |
|---|---|---|---|
| Average FPS | 15 | 10 | 0 |
| Bad Frame % | 15 | 10 | 0 |
| Average Frame Time | 15 | 10 | 0 |
| Memory | 15 | 10 | 0 |

The judgement thresholds:

| Metric | PASS | WARN | FAIL |
|---|---|---|---|
| Average FPS | ≥ 97% of target | ≥ 85% | below |
| Bad Frames | ≤ 1% | ≤ 5% | above |
| Frame Time | ≤ 1.03× budget | ≤ 1.18× | above |
| Memory | ≤ 70% of cap | ≤ cap | above (AR 1500 MB, VR 2800 MB) |

Frame-time budget is `1000 / targetFps` ms. A metric with no data scores 0 for
that metric.

A **bad frame** is one the profiler measured at more than 1.5× the frame budget.

## 3. XR Validation — 40 marks

Eight items, **5 marks each**. These are human judgements recorded on the
report, because no profiler can observe them.

| Result | Marks |
|---|---|
| Pass | 5 |
| Warn | 3 |
| Fail | 0 |
| Not assessed | 0 |

| # | Item | Criterion |
|---|---|---|
| 01 | **Application Stability** | Application launches and reaches the intended experience without crashing. |
| 02 | **Performance Stability** | Application maintains the configured target performance without sustained problematic drops. |
| 03 | **Tracking & Input** | Controllers, hands, head tracking, touch or AR tracking respond correctly. |
| 04 | **Core Interaction** | Primary interaction systems such as grab, point, select, UI interaction, gestures or application-specific interactions work correctly. |
| 05 | **Comfort & Motion** | Locomotion, camera movement and transitions do not introduce obvious uncomfortable or jarring motion. |
| 06 | **UI Readability** | Text, controls and panels are readable and positioned appropriately for the XR experience. |
| 07 | **Spatial Audio** | Spatial audio behaves correctly without obvious clipping, incorrect positioning or major audio issues. |
| 08 | **Exit / Reset** | The application can exit, restart or reset cleanly without hanging. |

Validation results belong to the **individual test**, so assessing run 2 never
changes run 1's score.

## 4. Not scored

**Minimum FPS** and **1% Low FPS** are captured, stored and displayed as
diagnostics, but carry no marks. A single abnormal frame — a shader compile, a
GC spike, an editor stall — must not disproportionately decide a result. Bad
Frame % already measures stutter across the whole session, proportionally.

Also collected and displayed, contributing nothing to the score:

- **Draw Calls** and **Triangles** (Editor captures only; `-1` in a build)
- **Battery** level and status
- **Device / GPU / OS** — informational metadata
- **Defects** (local instances only) — tracked and reported as QA information,
  but they never subtract marks

## 5. Classification

| Score | Grade | Meaning |
|---|---|---|
| 90–100 | **A** | Excellent — meets XR quality expectations across the board |
| 80–89 | **B** | Good — minor issues worth addressing |
| 70–79 | **C** | Acceptable — noticeable issues to resolve before release |
| 60–69 | **D** | Weak — significant issues affecting the experience |
| 0–59 | **F** | Poor — the experience needs substantial work |

## 6. Overall status

| Score | Status |
|---|---|
| 70–100 | PASS |
| 60–69 | WARN |
| 0–59 | FAIL |

Per-metric PASS/WARN/FAIL pills on the report reflect each metric's own
judgement and are independent of the overall status.

## 7. Invalid capture

A report with `totalFrames <= 0` recorded no frames:

```
Score  = N/A
Grade  = N/A
Status = INVALID CAPTURE
```

It is stored as evidence a test was attempted. **A broken capture is never
treated as a failed application.**

## 8. Worked example

Metric judgements: Average FPS **PASS**, Bad Frames **WARN**, Frame Time
**PASS**, Memory **PASS**.

```
Performance   = 15 + 10 + 15 + 15 = 55 / 60
```

Validation: 6 Pass, 1 Warn, 1 Fail.

```
XR Validation = (6 × 5) + (1 × 3) + (1 × 0) = 33 / 40
```

```
Final         = 55 + 33 = 88 / 100  →  B  →  PASS
```

If that application also has 2 critical defects logged, the score is still
**88/100** — defects are reported separately.

## 9. Interpretation layers

Three views sit on top of the same evidence. None of them introduces new
thresholds, and none asserts a cause the profiler cannot observe.

**XR Health** — condition per area (Healthy / Needs Attention / Critical / Not
Assessed), each with the number behind it. An area with no evidence reports
*Not Assessed* rather than guessing.

**Fix First** — the single highest-priority observable issue, with its evidence
and a list of *possible* investigation areas. Priority order: a recorded
Application Stability failure, then frame stability, average frame rate, frame
time, memory, then the remaining validation items. Critical outranks
attention-level within that order.

**XR Doctor** — Performance, Frame Stability, Memory and XR Experience as a
developer-facing readout, plus evidence-based recommendations. Derived from the
same function as XR Health, so the two cannot disagree.

> Investigation areas are places to look, never confirmed causes. The profiler
> measures frame timing and memory from inside the application; it cannot
> attribute a spike to a specific system.

## 10. Comparison and trend

When more than one report is loaded into a single analysis, the newest is
compared against the previous one across Average FPS, Bad Frame %, Average
Frame Time, Memory and Final Score, each labelled **Improved**, **Regressed** or
**Unchanged**. Movement below 0.5% relative is *Unchanged* rather than noise.

Both require nothing to be stored permanently — they operate on the reports in
the current temporary analysis.

## 11. Changing the weighting

Edit `GRADE_CONFIG` in
[`shared/xr-metrics/index.js`](../shared/xr-metrics/index.js) — nothing else
needs to change:

```js
export const GRADE_CONFIG = {
  performance: { pass: 15, warn: 10, fail: 0, neutral: 0 },
  checklist:   { pass: 5,  warn: 3,  fail: 0 },
  maxPerformance: 60,
  maxChecklist: 40,
  scale: [ {grade:'A',min:90}, {grade:'B',min:80}, {grade:'C',min:70},
           {grade:'D',min:60}, {grade:'F',min:0} ],
  statusScale: [ {status:'pass',min:70}, {status:'warn',min:60}, {status:'fail',min:0} ],
};
```

If you change the split, update `EVALUATION_AREAS` so the four areas still
account for exactly 100 marks — a test asserts that they do.

A local instance re-scores stored sessions automatically on startup when the
formula changes; bump `SCORING_VERSION` in
`server/src/services/grading.js` so it knows to.
