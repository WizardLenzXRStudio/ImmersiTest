/**
 * Product guarantees that are easy to break by accident.
 *
 * These are static checks over the source rather than runtime behaviour,
 * because the promises they protect are about what the code CANNOT do:
 *
 *   - the Unity package uploads one JSON file and nothing else
 *   - the shipped package contains no source
 *   - the product has no accounts and no permanent public storage
 *   - the vocabulary is general, not student/university specific
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* -------------------------------------------------- unity upload privacy -- */

const UPLOADER = 'unity/src/com.wizardlenz.xrtestlab/Editor/ImmersiTestUploader.cs';

test('the Unity uploader reads exactly one file: the report it was given', () => {
  const src = read(UPLOADER);

  const reads = [...src.matchAll(/File\.Read\w*\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(reads, ['reportPath'], 'the only file read must be the report path passed in');

  // Nothing that could sweep up a project.
  for (const forbidden of [
    'Directory.GetFiles', 'Directory.EnumerateFiles', 'Directory.GetDirectories',
    'ZipFile', 'AssetDatabase', 'File.ReadAllBytes(Application.dataPath',
    'Application.dataPath', 'System.IO.Compression',
  ]) {
    assert.ok(!src.includes(forbidden), `the uploader must not reference ${forbidden}`);
  }
});

test('the Unity uploader sends the report body and nothing appended', () => {
  const src = read(UPLOADER);
  const uploads = [...src.matchAll(/UploadHandlerRaw\(([\s\S]*?)\)\s*,/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  assert.equal(uploads.length, 1, 'exactly one request body is ever constructed');
  assert.match(uploads[0], /Encoding\.UTF8\.GetBytes\(json/, 'the body is the report JSON, verbatim');
});

test('the Unity package makes network calls from one place only', () => {
  const files = walk(resolve(root, 'unity/src')).filter((f) => f.endsWith('.cs'));
  const networked = files.filter((f) => /UnityWebRequest|HttpClient|WebClient|Socket/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    networked.map((f) => f.replace(/\\/g, '/').split('/').pop()),
    ['ImmersiTestUploader.cs'],
    'only the uploader may touch the network',
  );
});

test('the Unity package refuses to upload over plain HTTP', () => {
  const settings = read('unity/src/com.wizardlenz.xrtestlab/Editor/ImmersiTestSettings.cs');
  assert.match(settings, /IsSecureEndpoint/);
  assert.match(settings, /https:\/\//);
  assert.match(settings, /localhost/, 'local development must stay possible');

  const uploader = read(UPLOADER);
  assert.match(uploader, /IsSecureEndpoint/, 'the uploader must gate on the secure check');
  assert.ok(
    uploader.indexOf('IsSecureEndpoint') < uploader.indexOf('File.ReadAllText'),
    'the endpoint is validated before the report is even read',
  );
});

test('the Unity package ships no embedded credentials', () => {
  for (const file of walk(resolve(root, 'unity/src')).filter((f) => f.endsWith('.cs'))) {
    const src = readFileSync(file, 'utf8');
    for (const pattern of [/api[_-]?key\s*=\s*"/i, /secret\s*=\s*"/i, /Bearer\s+[A-Za-z0-9._-]{12,}/, /token\s*=\s*"[A-Za-z0-9._-]{16,}"/i]) {
      assert.ok(!pattern.test(src), `${file} appears to contain a credential (${pattern})`);
    }
  }
});

test('the profiler still emits the published xr-test-profile-v1 contract', () => {
  const src = read('unity/src/com.wizardlenz.xrtestlab/Runtime/XRTestProfiler.cs');
  assert.match(src, /"xr-test-profile-v1"/);
  // Wire field names are a compatibility contract with every stored report.
  for (const field of [
    'projectName', 'studentName', 'studentId', 'platform', 'capturedAt', 'durationSec',
    'targetFps', 'avgFps', 'minFps', 'onePercentLowFps', 'avgFrameMs', 'droppedFrames',
    'totalFrames', 'memoryMB', 'drawCalls', 'triangles', 'batteryLevel', 'batteryStatus',
    'device', 'gpu', 'os', 'series',
  ]) {
    assert.ok(src.includes(`\\"${field}\\"`), `the report must still emit "${field}"`);
  }
});

/* ------------------------------------------------------ source protection -- */

test('the package build refuses to ship source or development files', () => {
  const script = read('scripts/build-unity-package.js');
  for (const ext of ['.cs', '.asmdef', '.pdb', '.map', '.csproj', '.sln']) {
    assert.ok(script.includes(`'${ext}'`), `${ext} must be on the forbidden list`);
  }
  assert.match(script, /refusing to ship/, 'the build must fail rather than leak');
  assert.match(script, /rmSync\(outDir[^)]*\)/, 'a rejected build must not leave a partial package');
  // The claim we make about it must stay honest.
  assert.match(script, /NOT absolute protection/i);
});

test('the shipped package layout is assemblies plus documentation only', () => {
  const script = read('scripts/build-unity-package.js');
  assert.match(script, /Wizardlenz\.ImmersiTest\.dll/);
  assert.match(script, /Wizardlenz\.ImmersiTest\.Editor\.dll/);
  // The editor assembly must be pinned to the Editor platform or player builds break.
  assert.match(script, /editorOnly: true/);
  assert.match(script, /Editor: Editor/);
});

/* ------------------------------------------------------- no accounts, ever -- */

test('the product has no authentication surface', () => {
  const files = [
    ...walk(resolve(root, 'server/src')),
    ...walk(resolve(root, 'web')).filter((f) => !f.includes('vendor')),
  ].filter((f) => ['.js', '.html'].includes(extname(f)));

  const banned = /\b(passport|bcrypt|jsonwebtoken|express-session|\/login\b|\/signup\b|\/register\b|req\.user\b)/i;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!banned.test(src), `${file} looks like it introduces accounts`);
  }
});

test('hosted mode has no route that writes permanent storage', () => {
  const routes = read('server/src/routes/index.js');
  // Everything database-backed sits behind the local-mode guard.
  const guardIndex = routes.indexOf('if (config.isLocal)');
  assert.ok(guardIndex > 0, 'local routes must be mode-guarded');
  for (const mounted of ['projects', 'students', 'sessions', 'bugs', 'dashboard', 'reports', 'migrate', 'data']) {
    assert.ok(
      routes.indexOf(`router.use('/${mounted}'`) > guardIndex,
      `/${mounted} must only be mounted in local mode`,
    );
  }
});

test('the analysis store never writes to disk', () => {
  const src = read('server/src/services/analysisStore.js');
  for (const forbidden of ['writeFile', 'appendFile', 'createWriteStream', 'node:fs', "from 'fs'"]) {
    assert.ok(!src.includes(forbidden), `the temporary store must not use ${forbidden}`);
  }
  assert.match(src, /expiresAt/, 'sessions must carry an expiry');
});

test('temporary session tokens come from a CSPRNG, never from user input', () => {
  const src = read('server/src/services/analysisStore.js');
  assert.match(src, /randomBytes\(\d+\)/);
  const tokenLine = src.match(/const newToken = .*/)[0];
  assert.match(tokenLine, /randomBytes\((\d+)\)/);
  assert.ok(Number(tokenLine.match(/randomBytes\((\d+)\)/)[1]) >= 16, 'at least 128 bits of entropy');
});

/* ------------------------------------------------------------ vocabulary -- */

test('no student/university framing survives in product-facing code', () => {
  const files = [
    ...walk(resolve(root, 'web')).filter((f) => !f.includes('vendor')),
    ...walk(resolve(root, 'shared')),
    resolve(root, 'server/src/services/excel.js'),
  ].filter((f) => ['.js', '.html', '.css'].includes(extname(f)));

  // camelCase identifiers (studentId, renderStudents, #/students) are the
  // stored JSON/DB contract and stay. Prose is what must not survive: a
  // standalone capitalised "Student", or any academic framing at all.
  const PROSE = /\bStudents?\b/;
  // Targets the framing, not the word: a comment may legitimately say
  // "never a person's academic work" while explaining why.
  const ACADEMIC = /\buniversit(y|ies)\b|\bcolleges?\b|\bacademic (grade|report|record)\b|\bProject Guide\b|\bStudent Report\b/i;

  // Comments are exempt: the code documents *why* this framing is banned, and
  // those explanations necessarily use the words. Only shipped copy is policed.
  const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const offender = PROSE.test(line) ? 'Student' : ACADEMIC.test(line) ? 'academic framing' : null;
      if (!offender) return;
      assert.fail(`${file}:${i + 1} still uses ${offender} in user-visible copy:\n    ${line.trim()}`);
    });
  }
});

test('a blank tester name is never replaced with an invented person', () => {
  const files = walk(resolve(root, 'server/src')).concat(walk(resolve(root, 'shared')));
  for (const file of files) {
    assert.ok(
      !readFileSync(file, 'utf8').includes('Unknown Student'),
      `${file} still invents a student for anonymous captures`,
    );
  }
  // Validation must leave it null so consumers can omit the field entirely.
  assert.match(
    read('server/src/ingest/validate.js'),
    /studentName: \(raw\.studentName \?\? ''\)\.toString\(\)\.trim\(\) \|\| null/,
  );
});

test('the documented brand and tagline are used consistently', () => {
  const config = read('server/src/config.js');
  assert.match(config, /product: 'ImmersiTest'/);
  assert.match(config, /vendor: 'Wizardlenz XR Studio'/);
  assert.match(config, /tagline: 'Test the Experience\. Trust the Immersion\.'/);
});

/* -------------------------------------------------- production safety net -- */

test('hosted mode refuses to start without an HTTPS public URL', async () => {
  const src = read('server/src/config.js');
  assert.match(src, /Hosted mode requires an HTTPS XRLAB_PUBLIC_URL/);
  assert.match(src, /XRLAB_ALLOW_INSECURE/, 'the escape hatch must be explicit and named');

  // Prove it, in a child process so this suite's own env stays clean.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['-e', "import('./server/src/config.js').catch(e => { console.error(e.message); process.exit(3); })"],
    {
      cwd: root,
      env: { ...process.env, XRLAB_MODE: 'hosted', XRLAB_PUBLIC_URL: 'http://insecure.example.com', XRLAB_ALLOW_INSECURE: '' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 3, 'startup must fail on a plain-HTTP public URL');
  assert.match(result.stderr, /HTTPS/);
});

test('local mode binds loopback by default', () => {
  const src = read('server/src/config.js');
  assert.match(src, /isHosted \? '0\.0\.0\.0' : '127\.0\.0\.1'/,
    'a local instance must not be reachable from the network by default');
});
