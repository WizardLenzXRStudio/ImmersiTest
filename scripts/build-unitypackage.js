/**
 * Builds the PUBLIC ImmersiTest artifact: ImmersiTest.unitypackage
 *
 * This is what a user downloads from the Unity Asset Store and imports with
 * Assets > Import Package > Custom Package. It contains COMPILED ASSEMBLIES
 * ONLY — never our C# source.
 *
 * The UPM tarball built by build-unity-package.js still exists and is still
 * useful for internal development and testing. It is NOT the public artifact.
 *
 * PIPELINE
 *   unity/src/com.wizardlenz.xrtestlab/   (source — never shipped)
 *        |  compile   Unity 2022.3.x, package referenced by file: path
 *        v
 *   <compile project>/Library/ScriptAssemblies/*.dll
 *        |  stage     DLLs + docs + .meta, laid out under Assets/ImmersiTest
 *        v
 *   <staging project>/Assets/ImmersiTest/
 *        |  export    Unity -exportPackage (Unity's own exporter)
 *        v
 *   dist/ImmersiTest.unitypackage
 *        |  verify    every entry inspected; any source file fails the build
 *        v
 *   ready for the Asset Store
 *
 * WHY THERE IS NO .asmdef IN THE OUTPUT
 *   The shipped DLLs are precompiled managed plugins. Unity does not compile
 *   them, it imports them through PluginImporter, so an assembly definition
 *   would be meaningless (and would only exist to describe source we do not
 *   ship). Editor-only scoping is achieved two independent ways instead: the
 *   assembly lives in a folder named `Editor`, and its .meta pins every
 *   non-editor platform off.
 *
 * WHY THERE IS NO package.json IN THE OUTPUT
 *   package.json is the Package Manager (UPM) manifest. It has no function in
 *   a .unitypackage, and a file literally named package.json inside Assets/ is
 *   claimed by Unity's PackageManifestImporter, which is not what we want for
 *   a plain asset folder.
 *
 * USAGE
 *   node scripts/build-unitypackage.js --unity "<path to Unity.exe>"
 *   node scripts/build-unitypackage.js --unity "..." --skip-compile \
 *        --assemblies "<project>/Library/ScriptAssemblies"
 */
import {
  existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync,
  statSync, readFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'unity/src/com.wizardlenz.xrtestlab');
const distDir = resolve(root, 'dist');

/** Everything Unity needs lives under this one folder in the user's project. */
const ASSET_ROOT = 'ImmersiTest';

const ASSEMBLIES = [
  { dll: 'Wizardlenz.ImmersiTest.dll', target: 'Runtime', editorOnly: false },
  { dll: 'Wizardlenz.ImmersiTest.Editor.dll', target: 'Editor', editorOnly: true },
];

/**
 * Documentation shipped alongside the assemblies.
 *
 * README   — what the package is and how to use it; expected of an Asset Store listing.
 * CHANGELOG— version history, so a user can see what changed between releases.
 * LICENSE  — the licence terms the user is accepting. Asset Store submissions
 *            are expected to state their terms.
 *
 * All three are prose. None of them is, or reveals, implementation source.
 * package.json is deliberately NOT here — see the header.
 */
const DOC_FILES = ['README.md', 'CHANGELOG.md', 'LICENSE.md'];

/** Nothing matching these may appear in the staged folder or the exported package. */
const FORBIDDEN_EXT = [
  '.cs', '.asmdef', '.asmref', '.map', '.pdb', '.mdb', '.csproj', '.sln',
  '.unity', '.prefab', '.tgz', '.zip', '.rsp',
];
const FORBIDDEN_NAME = [
  /^\./, /^node_modules$/i, /^\.git/i, /^tests?$/i, /^testdata$/i,
  /^package\.json$/i,
];

/* ------------------------------------------------------------------ args -- */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

function fail(message) {
  console.error(`\n[unitypackage] FAILED: ${message}\n`);
  process.exit(1);
}

/** Unity refuses to start on a path it cannot parse; keep them absolute. */
function findUnity() {
  const given = arg('unity') ?? process.env.XRLAB_UNITY_EXE;
  if (given) return resolve(given);
  const hub = 'C:/Program Files/Unity/Hub/Editor';
  if (existsSync(hub)) {
    const versions = readdirSync(hub)
      .filter((v) => existsSync(join(hub, v, 'Editor/Unity.exe')))
      .sort();
    // Prefer the 2022.3 LTS line the package targets.
    const lts = versions.filter((v) => v.startsWith('2022.3'));
    const pick = lts.at(-1) ?? versions.at(-1);
    if (pick) return resolve(join(hub, pick, 'Editor/Unity.exe'));
  }
  return null;
}

/* ------------------------------------------------------------------ meta -- */

/**
 * Deterministic GUID per asset path. Stable across rebuilds so a user
 * upgrading the package keeps their references instead of losing them.
 */
const guidFor = (key) =>
  createHash('sha1').update(`ImmersiTest.unitypackage:${key}`).digest('hex').slice(0, 32);

function folderMeta(key) {
  return `fileFormatVersion: 2
guid: ${guidFor(key)}
folderAsset: yes
DefaultImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

function textMeta(key) {
  return `fileFormatVersion: 2
guid: ${guidFor(key)}
TextScriptImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

/**
 * PluginImporter metadata.
 *
 * Load-bearing for the Editor assembly: without a .meta pinning it to the
 * Editor platform, Unity would include editor-only code in a player build and
 * that build would fail on missing UnityEditor types.
 */
function pluginMeta(key, editorOnly) {
  return `fileFormatVersion: 2
guid: ${guidFor(key)}
PluginImporter:
  externalObjects: {}
  serializedVersion: 2
  iconMap: {}
  executionOrder: {}
  defineConstraints: []
  isPreloaded: 0
  isOverridable: 0
  isExplicitlyReferenced: 0
  validateReferences: 1
  platformData:
  - first:
      '': Any
    second:
      enabled: ${editorOnly ? 0 : 1}
      settings:
        Exclude Editor: 0
        Exclude Linux64: ${editorOnly ? 1 : 0}
        Exclude OSXUniversal: ${editorOnly ? 1 : 0}
        Exclude Win: ${editorOnly ? 1 : 0}
        Exclude Win64: ${editorOnly ? 1 : 0}
        Exclude Android: ${editorOnly ? 1 : 0}
        Exclude iOS: ${editorOnly ? 1 : 0}
  - first:
      Any:
    second:
      enabled: ${editorOnly ? 0 : 1}
      settings: {}
  - first:
      Editor: Editor
    second:
      enabled: 1
      settings:
        DefaultValueInitialized: true
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

/* ----------------------------------------------------------------- utils -- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Minimal but valid Unity project skeleton. Unity fills in the rest on open. */
function scaffoldProject(dir, { unityVersion, revision }) {
  mkdirSync(join(dir, 'Assets'), { recursive: true });
  mkdirSync(join(dir, 'Packages'), { recursive: true });
  mkdirSync(join(dir, 'ProjectSettings'), { recursive: true });
  writeFileSync(
    join(dir, 'ProjectSettings/ProjectVersion.txt'),
    `m_EditorVersion: ${unityVersion}\nm_EditorVersionWithRevision: ${unityVersion} (${revision})\n`,
  );
  return dir;
}

/** The staging project must NOT reference our source package. */
const STAGING_MANIFEST = {
  dependencies: {
    'com.unity.modules.imgui': '1.0.0',
    'com.unity.modules.jsonserialize': '1.0.0',
    'com.unity.modules.ui': '1.0.0',
    'com.unity.modules.uielements': '1.0.0',
    'com.unity.modules.unitywebrequest': '1.0.0',
    'com.unity.modules.xr': '1.0.0',
    'com.unity.modules.vr': '1.0.0',
    'com.unity.modules.physics': '1.0.0',
    'com.unity.modules.animation': '1.0.0',
    'com.unity.modules.audio': '1.0.0',
  },
};

function runUnity(unityExe, args, logFile, label) {
  rmSync(logFile, { force: true });
  console.log(`[unitypackage] ${label}…`);
  const res = spawnSync(unityExe, [...args, '-logFile', logFile], {
    stdio: 'inherit',
    windowsVerbatimArguments: false,
  });
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  const errors = log.split(/\r?\n/).filter((l) => /\berror CS\d+/.test(l));
  if (res.status !== 0) {
    console.error(log.split(/\r?\n/).slice(-40).join('\n'));
    fail(`${label} exited with code ${res.status}. Log: ${logFile}`);
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    fail(`${label} produced ${errors.length} C# error(s). Log: ${logFile}`);
  }
  return log;
}

/* ----------------------------------------------------------------- stage -- */

function stage(stagingProject, asmDir) {
  const assetRoot = resolve(stagingProject, 'Assets', ASSET_ROOT);
  rmSync(assetRoot, { recursive: true, force: true });
  rmSync(`${assetRoot}.meta`, { force: true });
  mkdirSync(assetRoot, { recursive: true });

  writeFileSync(`${assetRoot}.meta`, folderMeta(ASSET_ROOT));

  // ---- documentation -------------------------------------------------------
  for (const file of DOC_FILES) {
    const from = resolve(srcDir, file);
    if (!existsSync(from)) fail(`missing ${file} in ${srcDir}`);
    copyFileSync(from, resolve(assetRoot, file));
    writeFileSync(`${resolve(assetRoot, file)}.meta`, textMeta(`${ASSET_ROOT}/${file}`));
  }

  // ---- assemblies ----------------------------------------------------------
  for (const a of ASSEMBLIES) {
    const dir = resolve(assetRoot, a.target);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}.meta`, folderMeta(`${ASSET_ROOT}/${a.target}`));

    const from = resolve(asmDir, a.dll);
    if (!existsSync(from)) fail(`compiled assembly missing: ${from}`);
    const dest = resolve(dir, a.dll);
    copyFileSync(from, dest);
    writeFileSync(`${dest}.meta`, pluginMeta(`${ASSET_ROOT}/${a.target}/${a.dll}`, a.editorOnly));
  }

  return assetRoot;
}

/* ---------------------------------------------------------------- verify -- */

/** Entry names inside a .unitypackage tar: <guid>/asset, <guid>/pathname, ... */
function unitypackageEntries(pkgPath) {
  // A .unitypackage is a gzipped tar. Read it with Node so the result does not
  // depend on which tar implementation happens to be on PATH.
  const buf = gunzipSync(readFileSync(pkgPath));
  const entries = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0;
    const body = buf.subarray(off + 512, off + 512 + size);
    entries.push({ name, size, body });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * A .unitypackage stores each asset under a GUID directory, with the real
 * project path in a `pathname` file. Verification has to read those pathnames —
 * checking the tar entry names alone would prove nothing.
 */
function verifyPackage(pkgPath) {
  const entries = unitypackageEntries(pkgPath);
  const pathnames = entries
    .filter((e) => e.name.endsWith('/pathname'))
    .map((e) => e.body.toString('utf8').split('\n')[0].trim())
    .filter(Boolean);

  const leaks = pathnames.filter((p) => {
    const base = basename(p);
    if (FORBIDDEN_EXT.includes(extname(base).toLowerCase())) return true;
    return FORBIDDEN_NAME.some((re) => re.test(base));
  });

  return { entries, pathnames, leaks };
}

/* ------------------------------------------------------------------ main -- */

function main() {
  const unityExe = findUnity();
  if (!unityExe) fail('could not locate Unity.exe. Pass --unity "<path>".');
  if (!existsSync(unityExe)) fail(`Unity not found at ${unityExe}`);
  if (!existsSync(srcDir)) fail(`package source not found: ${srcDir}`);

  const unityVersion = arg('unity-version', '2022.3.62f3');
  const revision = arg('unity-revision', '96770f904ca7');
  const workRoot = resolve(arg('work', 'D:/Unity Projects/_ImmersiTest-Dist'));
  const compileProject = resolve(arg('compile-project', join(workRoot, 'compile')));
  const stagingProject = resolve(arg('staging', join(workRoot, 'staging')));
  const logDir = join(workRoot, 'logs');
  mkdirSync(logDir, { recursive: true });

  console.log(`\n[unitypackage] Unity   : ${unityExe}`);
  console.log(`[unitypackage] source  : ${srcDir}`);
  console.log(`[unitypackage] work    : ${workRoot}\n`);

  /* -- 1. compile ---------------------------------------------------------- */
  let asmDir = arg('assemblies');
  if (!flag('skip-compile')) {
    if (!existsSync(join(compileProject, 'ProjectSettings/ProjectVersion.txt'))) {
      scaffoldProject(compileProject, { unityVersion, revision });
    }
    // The compile project — and ONLY the compile project — sees our source.
    writeFileSync(
      join(compileProject, 'Packages/manifest.json'),
      JSON.stringify(
        {
          dependencies: {
            'com.wizardlenz.xrtestlab': `file:${srcDir.replace(/\\/g, '/')}`,
            ...STAGING_MANIFEST.dependencies,
          },
        },
        null,
        2,
      ),
    );
    runUnity(
      unityExe,
      ['-batchmode', '-quit', '-nographics', '-projectPath', compileProject],
      join(logDir, 'compile.log'),
      'compiling assemblies from source',
    );
    asmDir = join(compileProject, 'Library/ScriptAssemblies');
  }
  if (!asmDir || !existsSync(asmDir)) fail(`assemblies directory not found: ${asmDir}`);

  for (const a of ASSEMBLIES) {
    const p = join(asmDir, a.dll);
    if (!existsSync(p)) fail(`missing compiled assembly ${a.dll} in ${asmDir}`);
    console.log(`[unitypackage] ${a.dll.padEnd(34)} sha256 ${sha256(p)}`);
  }

  /* -- 2. stage ------------------------------------------------------------ */
  if (!existsSync(join(stagingProject, 'ProjectSettings/ProjectVersion.txt'))) {
    scaffoldProject(stagingProject, { unityVersion, revision });
  }
  writeFileSync(
    join(stagingProject, 'Packages/manifest.json'),
    JSON.stringify(STAGING_MANIFEST, null, 2),
  );
  const assetRoot = stage(stagingProject, asmDir);

  // Nothing that leaks source may have been staged.
  const staged = walk(assetRoot).map((f) => relative(assetRoot, f).replace(/\\/g, '/'));
  const stagedLeaks = staged.filter((f) => {
    const base = basename(f);
    if (FORBIDDEN_EXT.includes(extname(base).toLowerCase())) return true;
    return FORBIDDEN_NAME.some((re) => re.test(base));
  });
  if (stagedLeaks.length) {
    fail(`staging produced files that must never ship:\n    ${stagedLeaks.join('\n    ')}`);
  }
  console.log(`\n[unitypackage] staged ${staged.length} files under Assets/${ASSET_ROOT}:`);
  for (const f of staged.sort()) console.log(`    ${ASSET_ROOT}/${f}`);

  /* -- 3. export ----------------------------------------------------------- */
  mkdirSync(distDir, { recursive: true });
  const outPkg = resolve(distDir, 'ImmersiTest.unitypackage');
  rmSync(outPkg, { force: true });

  runUnity(
    unityExe,
    [
      '-batchmode', '-quit', '-nographics',
      '-projectPath', stagingProject,
      '-exportPackage', `Assets/${ASSET_ROOT}`, outPkg,
    ],
    join(logDir, 'export.log'),
    'exporting ImmersiTest.unitypackage',
  );

  if (!existsSync(outPkg)) fail('Unity did not produce ImmersiTest.unitypackage');

  /* -- 4. verify ----------------------------------------------------------- */
  const { pathnames, leaks } = verifyPackage(outPkg);
  console.log(`\n[unitypackage] package contains ${pathnames.length} asset entries:`);
  for (const p of pathnames.sort()) console.log(`    ${p}`);

  if (leaks.length) {
    rmSync(outPkg, { force: true });
    fail(
      `refusing to ship — these entries would have leaked source or development data:\n    ${leaks.join('\n    ')}`,
    );
  }

  const dllCount = pathnames.filter((p) => p.toLowerCase().endsWith('.dll')).length;
  if (dllCount !== ASSEMBLIES.length) {
    fail(`expected ${ASSEMBLIES.length} assemblies in the package, found ${dllCount}`);
  }

  const size = statSync(outPkg).size;
  console.log(`\n[unitypackage] OK`);
  console.log(`[unitypackage] output : ${outPkg}`);
  console.log(`[unitypackage] size   : ${size} bytes`);
  console.log(`[unitypackage] sha256 : ${sha256(outPkg)}`);
  console.log(`[unitypackage] source files shipped: 0 (verified against ${pathnames.length} entries)\n`);
  console.log('Users install this with: Assets > Import Package > Custom Package…\n');
}

main();
