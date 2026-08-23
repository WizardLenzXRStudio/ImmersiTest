# Unity Package — build, ship, verify

**ImmersiTest** · Wizardlenz XR Studio

The package is what users install. It ships **compiled assemblies, not source**.

- Source lives in `unity/src/com.wizardlenz.xrtestlab/` (this repository).

## Two artifacts, one of them public

| Artifact | Built by | Audience |
|---|---|---|
| **`dist/ImmersiTest.unitypackage`** | `npm run package:assetstore` | **PUBLIC.** The Unity Asset Store artifact. Users install it with **Assets → Import Package → Custom Package**. |
| `dist/com.wizardlenz.xrtestlab-<version>.tgz` | `npm run package:unity` | Internal only. A UPM tarball for development and testing. Never given to users. |

Both contain compiled assemblies only. The rest of this document describes the
UPM tarball; see **§0** for the public `.unitypackage` pipeline.

---

## 0. The public `.unitypackage`

```
unity/src/com.wizardlenz.xrtestlab/     source — never shipped
     |  compile     Unity 2022.3.62f3, package referenced by file: path
     v
<work>/compile/Library/ScriptAssemblies/*.dll
     |  stage       DLLs + docs + .meta under Assets/ImmersiTest
     v
<work>/staging/Assets/ImmersiTest/
     |  export      Unity's own -exportPackage
     v
dist/ImmersiTest.unitypackage
     |  verify      every entry read back; any source file fails the build
     v
Unity Asset Store
```

```bash
npm run package:assetstore -- --unity "C:/Program Files/Unity/Hub/Editor/2022.3.62f3/Editor/Unity.exe"
```

Shipped layout, as it lands in the user's project:

```
Assets/ImmersiTest/
├─ README.md   CHANGELOG.md   LICENSE.md   (+ .meta)
├─ Runtime/
│  └─ Wizardlenz.ImmersiTest.dll        (+ .meta)
└─ Editor/
   └─ Wizardlenz.ImmersiTest.Editor.dll (+ .meta — pinned to the Editor platform)
```

Two deliberate omissions:

- **No `.asmdef`.** The shipped DLLs are precompiled managed plugins; Unity
  imports them through `PluginImporter` rather than compiling them, so an
  assembly definition would describe source we do not ship. Editor-only scoping
  comes from two independent mechanisms instead: the assembly sits in a folder
  named `Editor`, *and* its `.meta` disables every non-editor platform.
- **No `package.json`.** That is the UPM manifest and has no function in a
  `.unitypackage`; a file of that name inside `Assets/` is also claimed by
  Unity's `PackageManifestImporter`.

GUIDs are derived deterministically from the asset path, so rebuilding the same
version does not churn the references in users' projects.

---

## 1. Contents of the shipped package

```
com.wizardlenz.xrtestlab/
├─ package.json
├─ README.md   CHANGELOG.md   LICENSE.md   (+ .meta)
├─ Runtime/
│  └─ Wizardlenz.ImmersiTest.dll        (+ .meta)
└─ Editor/
   └─ Wizardlenz.ImmersiTest.Editor.dll (+ .meta — pinned to the Editor platform)
```

No `.cs`, no `.asmdef`, no `.pdb`, no source maps, no project files, no
repository metadata, no internal test data.

## 2. Building it

Unity is the compiler, so producing the DLLs requires a Unity install. The Node
tooling assembles and verifies the package but cannot compile C#.

1. Open or create a scratch Unity project (2021.3+).
2. Add the sources — copy `unity/src/com.wizardlenz.xrtestlab` into the
   project's `Packages/` folder, or **Package Manager → + → Install package
   from disk…**.
3. Let Unity compile. **Confirm the Console has no errors.** A failed compile
   leaves stale DLLs, and the packaging script cannot tell the difference.
4. Assemble:

```bash
npm run package:unity -- --assemblies "C:/path/to/UnityProject/Library/ScriptAssemblies"
```

The script:

- copies `package.json` and the three docs
- copies both DLLs into `Runtime/` and `Editor/`
- writes `.meta` files with deterministic GUIDs
- **walks the output and fails if anything on the forbidden list appears**,
  deleting the partial package rather than shipping it

## 3. Why the `.meta` files matter

The Editor assembly's `.meta` pins it to the Editor platform. Without it, Unity
includes editor-only code in player builds and the build fails on missing
`UnityEditor` types. GUIDs are derived from the asset path, so re-packaging the
same version does not churn GUIDs in users' projects.

## 4. Before a public release

- [ ] Set `ImmersiTestSettings.DefaultServiceUrl` to the production HTTPS domain
- [ ] Bump `version` in `package.json` and add a `CHANGELOG.md` entry
- [ ] Rebuild the package and reinstall it into a clean project
- [ ] Walk the verification checklist below

## 5. Verification checklist

Run this in a **clean Unity project** with the built package installed.

### Installation
- [ ] Package Manager shows **ImmersiTest** with the correct version
- [ ] An **ImmersiTest** menu appears in the menu bar
- [ ] The project contains no `.cs` from the package (search `XRTestProfiler.cs` — expect nothing)
- [ ] Console is clean

### Add Test Profiler
- [ ] Creates a GameObject named `XR Test Profiler`, selects and pings it
- [ ] `Application Name` defaults to the project's product name
- [ ] Running it a second time selects the existing object and does **not** create a duplicate
- [ ] Undo removes it

### Configuration
- [ ] Inspector shows Application, Tester (optional), Performance Target, Session Control, Sampling
- [ ] A scene saved with a v1 profiler still deserialises (`FormerlySerializedAs`)

### Run XR Test
- [ ] With no profiler in the scene: offers to add one
- [ ] With a blank/default application name: refuses and offers to select the profiler
- [ ] With `targetFps < 1`: refuses
- [ ] With the GameObject disabled: refuses
- [ ] With `autoStartOnPlay` off: warns, and can proceed
- [ ] Otherwise: enters Play Mode and the console logs `Session STARTED`

### Stop and analyse
- [ ] Leaving Play Mode writes `xrtest_*.json` into `<project>/XRTestReports/`
- [ ] Reports are **not** imported as Unity assets (they are outside `Assets/`)
- [ ] The report uploads **automatically** — no prompt appears
- [ ] The browser opens the report automatically
- [ ] Console shows PLAYMODE EXIT DETECTED / REPORT FOUND / AUTO ANALYSIS STARTED / UPLOAD SUCCESS / OPENING REPORT
- [ ] The report shows the right application, metrics and charts

### Security and privacy
- [ ] With a plain-HTTP service URL, upload is refused with a clear message
- [ ] `http://localhost:3200` is accepted (development)
- [ ] Network capture during upload shows exactly one request, whose body is the report JSON
- [ ] No request contains project files, source, scenes or assets

### Failure handling
- [ ] Service unreachable: **Retry / Later** dialog, and the JSON stays on disk
- [ ] Oversized report: `413` surfaces as "too large to analyse"
- [ ] Rapid repeated uploads: `429` surfaces as "too many uploads"
- [ ] A zero-frame capture uploads and reports INVALID CAPTURE, not a failure

### Player build
- [ ] A player build succeeds (proves the Editor assembly is correctly excluded)
- [ ] In a build, draw calls and triangles report `-1`

> **RESOLVED 2026-08-23 — player builds previously failed.**
>
> Because the package ships the **editor-compiled** runtime assembly, and
> `XRTestProfiler.cs` read draw calls / triangles directly from
> `UnityEditor.UnityStats` under `#if UNITY_EDITOR`, the shipped runtime DLL
> carried a hard `UnityEditor` reference. Any project that imported the package
> then failed to build a player:
>
> ```
> ArgumentException: The Assembly UnityEditor.CoreModule is referenced by
> Wizardlenz.XRTestLab ('Assets/ImmersiTest/Runtime/Wizardlenz.XRTestLab.dll').
> But the dll is not allowed to be included or could not be found.
> ```
>
> (Quoted verbatim. The assembly was still named `Wizardlenz.XRTestLab` at the
> time; it is `Wizardlenz.ImmersiTest` now.)
>
> The same `#if` also baked the Editor branch of `ReportFolder()` into players.
>
> **Fix:** the runtime assembly no longer references `UnityEditor` at compile
> time. `UnityStats` is resolved reflectively (guarded by `Application.isEditor`),
> and `ReportFolder()` uses a runtime `Application.isEditor` check. One assembly
> is now valid on every platform. Published behaviour is unchanged — real counts
> in the Editor, `-1` in a build.
>
> Verify with:
>
> ```powershell
> [System.Reflection.Assembly]::ReflectionOnlyLoadFrom($runtimeDll).GetReferencedAssemblies().Name
> # expect: netstandard, UnityEngine.CoreModule, UnityEngine.IMGUIModule,
> #         UnityEngine.InputLegacyModule   — and no UnityEditor*
> ```

## 6. Source protection — an honest statement

Shipping IL assemblies means the source is **not distributed** and does not
appear in the user's project. It is **not** absolute protection: .NET
assemblies can be decompiled with readily available tools.

Treat this as *"we do not distribute source"*, not *"the source cannot be
recovered"*. In particular:

- never put a secret, API key or credential in the package — a key shipped to
  clients is a published key
- the service must remain safe when facing a caller who knows exactly how the
  client works, which is why the API validates every payload independently

An automated test (`server/tests/privacy-and-packaging.test.js`) fails the build
if the package ever gains an embedded credential.

## 7. Report contract

The package emits `xr-test-profile-v1` with unchanged field names, including
`projectName`, `studentName` and `studentId` on the wire. The UI presents those
last two as optional **Tester** metadata; the wire names are kept so reports
captured by earlier profiler versions still analyse correctly. A test asserts
every field is still emitted.
