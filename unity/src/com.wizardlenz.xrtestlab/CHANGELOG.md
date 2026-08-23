# Changelog

All notable changes to the ImmersiTest Unity package.

## [2.0.0]

### Fixed
- Player builds no longer fail. The runtime assembly previously carried a
  compile-time reference to the editor-only `UnityEditor` assembly, because
  draw call and triangle counts were read directly from `UnityEditor.UnityStats`.
  Since the package ships precompiled, that reference reached user projects and
  broke their builds with *"The Assembly UnityEditor.CoreModule is referenced by
  Wizardlenz.XRTestLab"*. Those counters are now resolved at runtime, so the
  runtime assembly is valid on every platform. Behaviour is unchanged: real
  counts in the Editor, `-1` in a build.
- Reports written from a player now go to `Application.persistentDataPath`.
  The editor/player choice in `ReportFolder()` was a compile-time branch, so the
  shipped build had the Editor path baked in.

### Added
- Fully automatic analysis: stopping Play Mode uploads the report and opens the
  browser with no prompt in between. If the service is unreachable a
  **Retry / Later** dialog appears and the JSON is kept on disk.
- **ImmersiTest** editor menu: Add Test Profiler, Run XR Test, Open Last Report,
  Open Reports Folder, Analyse an Existing Report, Settings, About.
- One-click flow: Run XR Test enters Play Mode; leaving Play Mode uploads and
  opens the report automatically.
- Project Settings → ImmersiTest for the service URL and upload behaviour.
- HTTPS enforcement: uploads to a non-HTTPS host are refused (localhost is
  allowed for development).
- Duplicate-profiler protection — Add Test Profiler never creates a second one.
- Configuration validation before a run: application name, target FPS, auto-start
  and an enabled GameObject.

### Changed
- Assemblies renamed to match the product. `Wizardlenz.XRTestLab.dll` is now
  `Wizardlenz.ImmersiTest.dll`, and `Wizardlenz.XRTestLab.Editor.dll` is now
  `Wizardlenz.ImmersiTest.Editor.dll`. The namespace changed from
  `Wizardlenz.XRTestLab` to `Wizardlenz.ImmersiTest`; update any `using` in your
  own scripts. The component is still `XRTestProfiler`, added from the same
  **ImmersiTest → Add Test Profiler** menu.
- Package now ships as compiled assemblies rather than C# source.
- General XR terminology throughout: **Application Name** replaces Project Name,
  and tester name / ID are clearly optional metadata.
- Editor reports are written to `<project>/XRTestReports/` instead of inside
  `Assets/`, so they are no longer imported as Unity assets.
- `capturedAt` is emitted in UTC.
- Control characters in text fields are escaped as `\uXXXX`.

### Unchanged
- The report contract is still `xr-test-profile-v1` with the same field names,
  so reports captured by earlier profiler versions still analyse correctly.
- Capture behaviour: warm-up frame discard, bad-frame threshold, 1% low
  calculation and the sampling model are all unchanged.
