// =============================================================================
//  XRTestRunner.cs  —  Play Mode lifecycle and AUTOMATIC analysis
//  Wizardlenz XR Studio
//
//  Run XR Test enters Play Mode. When Play Mode ends, the profiler has already
//  written its JSON (StopSession runs from OnApplicationQuit / OnDisable), so
//  this picks up the newest report produced during the run and uploads it
//  WITHOUT asking. There is deliberately no prompt between stopping Play Mode
//  and the report opening in the browser.
//
//  TWO REGISTRATION PATHS, ON PURPOSE
//  ----------------------------------
//  [InitializeOnLoad] runs a static constructor on domain load. In a package
//  built from SOURCE that is enough. In a package shipped as a PRECOMPILED
//  assembly the static constructor is not a reliable hook on its own, so
//  [InitializeOnLoadMethod] is also present. Both funnel into Register(),
//  which unsubscribes before subscribing and is therefore safe to run twice.
//  This is the difference that made the DLL-only package behave differently
//  from the source package.
//
//  State lives in SessionState rather than a static field: exiting Play Mode
//  triggers a domain reload, which would wipe statics before the run finished.
// =============================================================================

using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Wizardlenz.ImmersiTest.Editor
{
    [InitializeOnLoad]
    internal static class XRTestRunner
    {
        // SessionState keys. Deliberately still "Wizardlenz.XRTestLab.*" —
        // internal identifiers, invisible to users, and only meaningful for the
        // lifetime of one editor session. Renaming them buys nothing.
        private const string KeyActive = "Wizardlenz.XRTestLab.RunActive";
        private const string KeyStartedTicks = "Wizardlenz.XRTestLab.RunStartedTicks";
        private const string KeyPending = "Wizardlenz.XRTestLab.PendingReport";

        /// <summary>Set once Register() has run, so double registration is a no-op.</summary>
        private static bool _registered;

        static XRTestRunner() => Register();

        /// <summary>
        /// Second entry point. Unity invokes this on every domain load, including
        /// for types that live in a precompiled editor assembly.
        /// </summary>
        [InitializeOnLoadMethod]
        private static void OnLoadMethod() => Register();

        private static void Register()
        {
            if (_registered) return;
            _registered = true;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
        }

        /// <summary>Marks the next Play Mode session as an ImmersiTest run.</summary>
        public static void BeginRun()
        {
            // Make sure the hook exists even if this is the very first call on a
            // fresh domain and neither load hook has run yet.
            Register();
            SessionState.SetBool(KeyActive, true);
            SessionState.EraseString(KeyPending);
            // A tick before entry, so a report written immediately still counts.
            SessionState.SetString(KeyStartedTicks, (DateTime.UtcNow.Ticks - TimeSpan.TicksPerSecond).ToString());
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredEditMode) return;
            if (!SessionState.GetBool(KeyActive, false)) return;

            SessionState.SetBool(KeyActive, false);
            Debug.Log("[ImmersiTest] PLAYMODE EXIT DETECTED");

            long ticks;
            long.TryParse(SessionState.GetString(KeyStartedTicks, "0"), out ticks);
            var since = ticks > 0 ? new DateTime(ticks, DateTimeKind.Utc) : DateTime.UtcNow.AddMinutes(-10);

            // Deferred: give the profiler's file write a moment to land, and avoid
            // starting a web request while Unity is still tearing down Play Mode.
            EditorApplication.delayCall += () => Finish(since);
        }

        private static void Finish(DateTime since)
        {
            string report = NewestReportSince(since);

            if (report == null)
            {
                Debug.LogWarning(
                    "[ImmersiTest] The test finished but no report file was found in "
                    + XRTestProfiler.ReportFolder()
                    + ".\nCheck the Console for \"[ImmersiTest] Session STARTED\" — if it is missing, the "
                    + "profiler did not run.");
                return;
            }

            Debug.Log("[ImmersiTest] REPORT FOUND: " + report);
            Analyse(report);
        }

        /// <summary>
        /// Uploads without asking. The whole point of the product flow is that
        /// stopping Play Mode is the last thing the user has to do.
        /// </summary>
        private static void Analyse(string report)
        {
            SessionState.SetString(KeyPending, report);
            Debug.Log("[ImmersiTest] AUTO ANALYSIS STARTED");
            ImmersiTestUploader.UploadAndOpen(report, OnUploadFailed);
        }

        /// <summary>
        /// Only surfaced when the service could not be reached. Retry re-sends the
        /// exact same generated file; Later leaves it on disk.
        /// </summary>
        private static void OnUploadFailed(string report, string reason)
        {
            bool retry = EditorUtility.DisplayDialog(
                "ImmersiTest",
                "ImmersiTest could not analyse this test because the service is unavailable.\n\n"
                + reason
                + "\n\nYour report is saved locally:\n" + report,
                "Retry",
                "Later");

            if (retry)
            {
                Debug.Log("[ImmersiTest] RETRY REQUESTED");
                ImmersiTestUploader.UploadAndOpen(report, OnUploadFailed);
                return;
            }

            Debug.Log($"[ImmersiTest] Report kept locally:\n{report}\n"
                      + "Analyse it later with ImmersiTest > Analyse an Existing Report.");
        }

        /// <summary>Newest xrtest_*.json written at or after <paramref name="since"/>.</summary>
        private static string NewestReportSince(DateTime since)
        {
            var folder = XRTestProfiler.ReportFolder();
            if (!Directory.Exists(folder)) return null;

            try
            {
                return new DirectoryInfo(folder)
                    .GetFiles("xrtest_*.json")
                    .Where(f => f.LastWriteTimeUtc >= since)
                    .OrderByDescending(f => f.LastWriteTimeUtc)
                    .Select(f => f.FullName)
                    .FirstOrDefault();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[ImmersiTest] Could not scan the reports folder: {e.Message}");
                return null;
            }
        }
    }
}
