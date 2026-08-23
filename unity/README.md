# Unity package — development

This folder holds the **source** of the ImmersiTest Unity package. It is not
what ships.

```
unity/
├─ src/com.wizardlenz.xrtestlab/    development source (stays in this repo)
│  ├─ package.json
│  ├─ README.md  CHANGELOG.md  LICENSE.md
│  ├─ Runtime/   XRTestProfiler.cs + asmdef
│  └─ Editor/    menu, settings, runner, uploader + asmdef
└─ (dist/com.wizardlenz.xrtestlab/  built by scripts/build-unity-package.js)
```

## Building the distributable

The shipped package contains **compiled assemblies, not source**. Unity is the
compiler, so producing the DLLs needs a Unity install — this cannot be done by
the Node tooling alone.

1. Open or create a scratch Unity project (2021.3+).
2. Add the package sources to it, either by copying
   `unity/src/com.wizardlenz.xrtestlab` into the project's `Packages/` folder,
   or via **Package Manager → + → Install package from disk…**.
3. Let Unity compile. **Confirm the Console has no errors** — a failed compile
   silently leaves stale DLLs behind.
4. Unity writes the assemblies to `Library/ScriptAssemblies/`:
   - `Wizardlenz.ImmersiTest.dll`
   - `Wizardlenz.ImmersiTest.Editor.dll`
5. Build the package:

```bash
npm run package:unity -- --assemblies "C:/path/to/UnityProject/Library/ScriptAssemblies"
```

The result lands in `dist/com.wizardlenz.xrtestlab/`, containing only:

- `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE.md`
- `Runtime/Wizardlenz.ImmersiTest.dll` (+ `.meta`)
- `Editor/Wizardlenz.ImmersiTest.Editor.dll` (+ `.meta`, pinned to the Editor platform)

The build **fails** rather than shipping if any `.cs`, `.asmdef`, `.pdb`,
source map, project file or repository metadata would end up in the output.

## Why the `.meta` files matter

The Editor assembly's `.meta` pins it to the Editor platform. Without it Unity
would include editor-only code in player builds and the build would fail on
missing `UnityEditor` types. The GUIDs are derived deterministically from the
asset path, so re-packaging the same version does not churn GUIDs in users'
projects.

## Source protection — what this does and does not give you

Shipping IL assemblies means the source is not distributed and does not appear
in the user's project. It is **not** absolute protection: .NET assemblies can be
decompiled with readily available tools. Treat this as *"we do not distribute
source"*, not *"the source cannot be recovered"*. Do not put secrets in the
package — in particular, nothing in it should ever hold an API key, because a
key shipped to clients is a published key.

## Service URL

`ImmersiTestSettings.DefaultServiceUrl` is the endpoint a fresh install points at.
**Set this to the real production domain before building a public release.**
Users can override it in Project Settings → ImmersiTest.

## Testing the package

See `docs/UNITY-PACKAGE.md` for the manual verification checklist — menu
presence, duplicate protection, validation, play-mode lifecycle, the Analyse
prompt, HTTPS enforcement and the privacy guarantee.
