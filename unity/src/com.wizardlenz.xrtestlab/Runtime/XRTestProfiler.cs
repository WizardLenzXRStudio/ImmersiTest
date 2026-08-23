// =============================================================================
//  XRTestProfiler.cs  —  ImmersiTest runtime capture component
//  Wizardlenz XR Studio · Test the Experience. Trust the Immersion.
//
//  WHAT IT DOES
//    Records FPS, frame time (ms), 1% low FPS, dropped frames, allocated
//    memory, draw calls, triangles and battery/thermal state where available,
//    during a timed test session, then writes a single JSON report.
//
//  WHAT IT DOES NOT DO
//    It never reads, packages or transmits your project. The report contains
//    only the measurements below plus the device/GPU/OS strings Unity exposes.
//    No scenes, prefabs, assets, source or repository data is touched.
//
//  USAGE
//    ImmersiTest -> Add Test Profiler   creates the GameObject for you.
//    ImmersiTest -> Run XR Test         validates, then enters Play Mode.
//    Leaving Play Mode finalises the report and offers to analyse it.
//
//  Draw call / triangle stats come from UnityStats in the Editor only; in a
//  build those fields are reported as -1 ("unavailable") by design.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;
using UnityEngine.Serialization;

namespace Wizardlenz.ImmersiTest
{
    /// <summary>
    /// Drop-in XR performance capture. Add one to the first scene of the
    /// experience under test.
    /// </summary>
    [AddComponentMenu("ImmersiTest/XR Test Profiler")]
    [DisallowMultipleComponent]
    public class XRTestProfiler : MonoBehaviour
    {
        /// <summary>Schema identifier of the emitted report. Do not change.</summary>
        public const string Schema = "xr-test-profile-v1";

        /// <summary>Folder (relative to the project root) used in the Editor.</summary>
        public const string EditorReportFolder = "XRTestReports";

        [Header("Application")]
        [Tooltip("Name of the XR application under test. Appears on the report.")]
        [FormerlySerializedAs("projectName")]
        public string applicationName = "Untitled XR Application";

        [Tooltip("\"VR\" or \"AR\". Selects the memory budget used when scoring.")]
        public string platform = "VR";

        [Header("Tester (optional)")]
        [Tooltip("Optional. Who ran this test. Leave blank if you do not want it in the report.")]
        [FormerlySerializedAs("studentName")]
        public string testerName = "";

        [Header("Performance Target")]
        [Tooltip("72 or 90 for VR headsets, 60 for mobile AR.")]
        public int targetFps = 72;

        [Header("Session Control")]
        [Tooltip("Profiling starts by itself when Play begins. Leave this on unless you want to drive sessions manually.")]
        public bool autoStartOnPlay = true;

        [Tooltip("If > 0 and autoStartOnPlay is on, the session stops automatically after this many seconds.")]
        public float autoStopAfterSeconds = 0f;

        public KeyCode startKey = KeyCode.F1;
        public KeyCode stopKey = KeyCode.F2;

        [Header("Sampling")]
        [Tooltip("How often (seconds) to record a sample point for the time-series graphs.")]
        public float sampleInterval = 0.5f;

        [Header("On-Screen Overlay")]
        public bool showOverlay = true;

        // ---- serialized config migration ----
        // Bumped whenever a default changes in a way that must also reach
        // components serialized under an older version. Unity keeps the stored
        // value, so changing a field initializer alone is NOT enough.
        private const int CurrentConfigVersion = 2;
        [SerializeField, HideInInspector] private int _configVersion = 0;

        // ---- runtime state ----
        private bool _running;
        private float _sessionStartTime;
        private float _lastSampleTime;
        private readonly List<float> _frameTimesMs = new List<float>();   // every frame
        private readonly List<Sample> _samples = new List<Sample>();      // downsampled series
        private int _droppedFrames;
        private float _targetFrameMs;
        private bool _skipWarmupFrame;   // discard the Play-Mode / scene-load hitch
#if ENABLE_LEGACY_INPUT_MANAGER
        private bool _hotkeysUnavailable;
#endif

        [Serializable]
        private struct Sample
        {
            public float t;        // seconds since session start
            public float fps;
            public float frameMs;
            public float memMB;
        }

        /// <summary>Absolute path of the most recent report written this session.</summary>
        public static string LastReportPath { get; private set; }

        // Upgrades a component serialized before a default changed. Runs once
        // per component; afterwards the user's own choice is preserved.
        private void MigrateConfig()
        {
            if (_configVersion >= CurrentConfigVersion) return;
            if (_configVersion < 1) autoStartOnPlay = true;   // v0 -> v1
            // v1 -> v2 renamed fields only; FormerlySerializedAs handles the data.
            _configVersion = CurrentConfigVersion;
        }

#if UNITY_EDITOR
        private void OnValidate()
        {
            // Applies the upgrade in edit mode so the Inspector shows the real
            // value. Save the scene to persist it.
            MigrateConfig();
        }
#endif

        private void Awake()
        {
            // Runtime safety net: guarantees the upgrade even if the scene was
            // never re-saved after OnValidate ran.
            MigrateConfig();
            RefreshFrameBudget();
        }

        private void Start()
        {
            RefreshFrameBudget();
            if (autoStartOnPlay) StartSession();
        }

        private void Update()
        {
            // Metric collection runs FIRST and is never gated behind input
            // polling, so a missing/disabled legacy Input Manager cannot stop
            // the recording.
            if (_running) RecordFrame();
            PollHotkeys();
        }

        // ---- session finalization ------------------------------------------
        // StopSession() is the only writer of the report, so every way a session
        // can end funnels into it. OnApplicationQuit fires first on quit / Play
        // Mode exit; OnDisable covers component disable, object destruction and
        // scene unload. StopSession() clears _running before doing any work, so
        // the second callback is a no-op and the report is written exactly once.

        private void OnApplicationQuit() => FinalizeIfRunning("application quit");

        private void OnDisable() => FinalizeIfRunning("profiler disabled or destroyed");

        private void FinalizeIfRunning(string reason)
        {
            if (!_running) return;
            Debug.Log($"[ImmersiTest] Finalizing active session ({reason}).");
            StopSession();
        }

        private void RefreshFrameBudget()
        {
            _targetFrameMs = 1000f / Mathf.Max(1, targetFps);
        }

        private void RecordFrame()
        {
            // The first frame after a session starts carries the Play-Mode /
            // scene load stall (often 100-500 ms). Counting it would wreck
            // minFps, the 1% low and the dropped-frame count, so it is dropped.
            if (_skipWarmupFrame)
            {
                _skipWarmupFrame = false;
                return;
            }

            float frameMs = Time.unscaledDeltaTime * 1000f;
            _frameTimesMs.Add(frameMs);

            // Never allow a zero budget - it would mark every frame as dropped.
            if (_targetFrameMs <= 0f) RefreshFrameBudget();

            // A "bad" frame took meaningfully longer than the target budget.
            if (frameMs > _targetFrameMs * 1.5f) _droppedFrames++;

            float now = Time.unscaledTime;
            if (now - _lastSampleTime >= sampleInterval)
            {
                _lastSampleTime = now;
                _samples.Add(new Sample
                {
                    t = now - _sessionStartTime,
                    fps = 1000f / Mathf.Max(0.0001f, frameMs),
                    frameMs = frameMs,
                    memMB = CurrentMemoryMB()
                });
            }

            if (autoStartOnPlay && autoStopAfterSeconds > 0f &&
                now - _sessionStartTime >= autoStopAfterSeconds)
            {
                StopSession();
            }
        }

        // F1 / F2 are a manual override only. They compile out entirely when the
        // project runs on the new Input System alone, and any unexpected failure
        // latches them off instead of throwing every frame.
        private void PollHotkeys()
        {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (_hotkeysUnavailable) return;
            try
            {
                if (Input.GetKeyDown(startKey) && !_running) StartSession();
                else if (Input.GetKeyDown(stopKey) && _running) StopSession();
            }
            catch (Exception e)
            {
                _hotkeysUnavailable = true;
                Debug.LogWarning($"[ImmersiTest] Keyboard hotkeys unavailable ({e.GetType().Name}: {e.Message}). " +
                                 "Profiling is unaffected - sessions start automatically and finalize on Stop.");
            }
#endif
        }

        public void StartSession()
        {
            // Recomputed here so a session started before Start() (or after
            // targetFps changed at runtime) always has a valid frame budget.
            RefreshFrameBudget();

            _running = true;
            _sessionStartTime = Time.unscaledTime;
            _lastSampleTime = _sessionStartTime;
            _frameTimesMs.Clear();
            _samples.Clear();
            _droppedFrames = 0;
            _skipWarmupFrame = true;
            Debug.Log($"[ImmersiTest] Session STARTED for '{applicationName}' (target {targetFps} FPS).");
        }

        public void StopSession()
        {
            if (!_running) return;
            _running = false;   // cleared first: duplicate calls are no-ops
            float duration = Time.unscaledTime - _sessionStartTime;
            string json = BuildReportJson(duration);

            string fileName = $"xrtest_{Sanitize(applicationName)}_{DateTime.Now:yyyyMMdd_HHmmss}.json";
            string fullPath = null;

            try
            {
                string folder = ReportFolder();
                if (!Directory.Exists(folder)) Directory.CreateDirectory(folder);
                fullPath = Path.Combine(folder, fileName);
                File.WriteAllText(fullPath, json);
                LastReportPath = fullPath;
            }
            catch (Exception e)
            {
                // Never swallow the reason - the capture is otherwise lost silently.
                Debug.LogError($"[ImmersiTest] FAILED to write report to '{fullPath ?? "(path not resolved)"}': " +
                               $"{e.GetType().Name}: {e.Message}");
                Debug.LogException(e, this);
                Debug.LogWarning("[ImmersiTest] Report JSON follows so the capture is not lost:\n" + json);
                return;
            }

            Debug.Log($"[ImmersiTest] Session STOPPED. Report saved to:\n{fullPath}");
        }

        /// <summary>
        /// Editor: a folder beside Assets/, so reports are not imported as
        /// assets. Player: the platform's persistent data path.
        /// </summary>
        public static string ReportFolder()
        {
            // Deliberately a RUNTIME check, not #if UNITY_EDITOR. This assembly
            // ships as a precompiled DLL built by the Editor, so a compile-time
            // branch would bake the Editor path into player builds and reports
            // would be written somewhere unwritable on device.
            if (Application.isEditor)
            {
                string projectRoot = Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
                return Path.Combine(projectRoot, EditorReportFolder);
            }

            return Application.persistentDataPath;
        }

        // ---- metric helpers -------------------------------------------------

        private float CurrentMemoryMB()
        {
            long bytes = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
            return bytes / (1024f * 1024f);
        }

        private void ComputeFpsStats(out float avgFps, out float minFps, out float onePercentLow)
        {
            if (_frameTimesMs.Count == 0) { avgFps = minFps = onePercentLow = 0f; return; }

            double sum = 0; float worstMs = 0;
            var sorted = new List<float>(_frameTimesMs);
            foreach (var ms in _frameTimesMs) { sum += ms; if (ms > worstMs) worstMs = ms; }
            float avgMs = (float)(sum / _frameTimesMs.Count);
            avgFps = 1000f / Mathf.Max(0.0001f, avgMs);
            minFps = 1000f / Mathf.Max(0.0001f, worstMs);

            // 1% low = average FPS of the worst 1% of frames.
            sorted.Sort();
            int onePctCount = Mathf.Max(1, Mathf.RoundToInt(sorted.Count * 0.01f));
            double slowSum = 0;
            for (int i = sorted.Count - onePctCount; i < sorted.Count; i++) slowSum += sorted[i];
            float slowAvgMs = (float)(slowSum / onePctCount);
            onePercentLow = 1000f / Mathf.Max(0.0001f, slowAvgMs);
        }

        /* --------------------------------------------------- editor stats -- */

        // Draw calls and triangles come from UnityEditor.UnityStats, which lives
        // in the editor-only UnityEditor assembly.
        //
        // They are read REFLECTIVELY, on purpose. A direct call would compile a
        // hard UnityEditor reference into this RUNTIME assembly. Because we ship
        // that assembly precompiled, the reference travels into user projects and
        // breaks their player builds outright:
        //
        //     The Assembly UnityEditor.CoreModule is referenced by
        //     Wizardlenz.ImmersiTest ... But the dll is not allowed to be included
        //
        // Resolving the type at runtime keeps one assembly valid on every
        // platform while preserving the exact published behaviour: real counts in
        // the Editor, -1 ("unavailable") in a build. No editor functionality is
        // moved here — this only reads two integers when the Editor happens to be
        // the host.
        private static bool _editorStatsProbed;
        private static PropertyInfo _drawCallsProperty;
        private static PropertyInfo _trianglesProperty;

        private static void ProbeEditorStats()
        {
            _editorStatsProbed = true;

            // A player has no UnityEditor assembly, so do not even look for it.
            if (!Application.isEditor) return;

            Type stats = Type.GetType("UnityEditor.UnityStats, UnityEditor")
                         ?? Type.GetType("UnityEditor.UnityStats, UnityEditor.CoreModule");

            if (stats == null)
            {
                // Fall back to a scan: the assembly-qualified name has moved
                // between Unity versions, but the type name has not.
                foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
                {
                    try
                    {
                        stats = assembly.GetType("UnityEditor.UnityStats", false);
                    }
                    catch
                    {
                        stats = null;   // an assembly we cannot inspect is not fatal
                    }
                    if (stats != null) break;
                }
            }

            if (stats == null) return;

            const BindingFlags flags = BindingFlags.Public | BindingFlags.Static;
            _drawCallsProperty = stats.GetProperty("drawCalls", flags);
            _trianglesProperty = stats.GetProperty("triangles", flags);
        }

        /// <summary>The statistic, or -1 when it is unavailable.</summary>
        private static int ReadEditorStat(PropertyInfo property)
        {
            if (property == null) return -1;
            try
            {
                return property.GetValue(null, null) is int value ? value : -1;
            }
            catch
            {
                // A stat we cannot read is "unavailable" — never a failed capture.
                return -1;
            }
        }

        /// <summary>
        /// Builds the report. The wire field names are the published
        /// xr-test-profile-v1 contract and are deliberately unchanged, so
        /// reports from older profiler versions still analyse correctly.
        /// </summary>
        private string BuildReportJson(float duration)
        {
            ComputeFpsStats(out float avgFps, out float minFps, out float onePctLow);

            if (!_editorStatsProbed) ProbeEditorStats();
            int drawCalls = ReadEditorStat(_drawCallsProperty);
            int triangles = ReadEditorStat(_trianglesProperty);

            float batteryLevel = SystemInfo.batteryLevel;            // -1 if unknown
            string batteryStatus = SystemInfo.batteryStatus.ToString();

            string plat = (platform ?? "VR").Trim().ToUpperInvariant();
            if (plat != "VR" && plat != "AR") plat = "VR";

            var sb = new StringBuilder();
            var ci = CultureInfo.InvariantCulture;
            sb.Append("{");
            sb.AppendFormat(ci, "\"schema\":\"{0}\",", Schema);
            sb.AppendFormat(ci, "\"projectName\":{0},", Q(applicationName));
            sb.AppendFormat(ci, "\"studentName\":{0},", Q(testerName));
            // Retained as an always-empty field so the published xr-test-profile-v1
            // contract is unchanged and existing reports still validate. There is
            // deliberately no Inspector field behind it — the product does not ask
            // for identity information.
            sb.AppendFormat(ci, "\"studentId\":{0},", Q(""));
            sb.AppendFormat(ci, "\"platform\":{0},", Q(plat));
            sb.AppendFormat(ci, "\"capturedAt\":{0},", Q(DateTime.UtcNow.ToString("o", ci)));
            sb.AppendFormat(ci, "\"durationSec\":{0:0.0},", duration);
            sb.AppendFormat(ci, "\"targetFps\":{0},", Mathf.Max(1, targetFps));
            sb.AppendFormat(ci, "\"avgFps\":{0:0.0},", avgFps);
            sb.AppendFormat(ci, "\"minFps\":{0:0.0},", minFps);
            sb.AppendFormat(ci, "\"onePercentLowFps\":{0:0.0},", onePctLow);
            sb.AppendFormat(ci, "\"avgFrameMs\":{0:0.00},", _frameTimesMs.Count > 0 ? 1000f / Mathf.Max(0.1f, avgFps) : 0f);
            sb.AppendFormat(ci, "\"droppedFrames\":{0},", _droppedFrames);
            sb.AppendFormat(ci, "\"totalFrames\":{0},", _frameTimesMs.Count);
            sb.AppendFormat(ci, "\"memoryMB\":{0:0.0},", CurrentMemoryMB());
            sb.AppendFormat(ci, "\"drawCalls\":{0},", drawCalls);
            sb.AppendFormat(ci, "\"triangles\":{0},", triangles);
            sb.AppendFormat(ci, "\"batteryLevel\":{0:0.00},", batteryLevel);
            sb.AppendFormat(ci, "\"batteryStatus\":{0},", Q(batteryStatus));
            sb.AppendFormat(ci, "\"device\":{0},", Q(SystemInfo.deviceModel));
            sb.AppendFormat(ci, "\"gpu\":{0},", Q(SystemInfo.graphicsDeviceName));
            sb.AppendFormat(ci, "\"os\":{0},", Q(SystemInfo.operatingSystem));

            sb.Append("\"series\":[");
            for (int i = 0; i < _samples.Count; i++)
            {
                var s = _samples[i];
                if (i > 0) sb.Append(",");
                sb.AppendFormat(ci, "{{\"t\":{0:0.0},\"fps\":{1:0.0},\"frameMs\":{2:0.00},\"memMB\":{3:0.0}}}",
                                s.t, s.fps, s.frameMs, s.memMB);
            }
            sb.Append("]");
            sb.Append("}");
            return sb.ToString();
        }

        private static string Q(string s)
        {
            if (s == null) return "\"\"";
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '\"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        // Escape any remaining control characters as \u00XX.
                        if (c < ' ') sb.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append("\"");
            return sb.ToString();
        }

        private static string Sanitize(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "report";
            foreach (char c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s.Replace(' ', '_');
        }

        // Optional on-screen readout while testing in a headset.
        private void OnGUI()
        {
            if (!showOverlay) return;
            var style = new GUIStyle { fontSize = 22, normal = { textColor = Color.white } };
            float fps = _frameTimesMs.Count > 0 ? 1000f / Mathf.Max(0.1f, _frameTimesMs[_frameTimesMs.Count - 1]) : 0f;
            string state = _running ? $"REC  {fps:0} FPS  bad:{_droppedFrames}" : "idle";
            GUI.Label(new Rect(20, 20, 600, 40), $"[ImmersiTest] {state}", style);
        }
    }
}
