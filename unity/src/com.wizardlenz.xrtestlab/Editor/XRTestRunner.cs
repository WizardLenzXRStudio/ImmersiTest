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

        /// <summary>True when the run began from ImmersiTest &gt; Run XR Test.</summary>
        private const string KeyExplicit = "Wizardlenz.XRTestLab.RunExplicit";

        /// <summary>Path + write stamp of the last report auto-uploaded this session.</summary>
        private const string KeyLastUploaded = "Wizardlenz.XRTestLab.LastAutoUploaded";

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

        /// <summary>Marks the next Play Mode session as an explicit ImmersiTest run.</summary>
        public static void BeginRun()
        {
            // Make sure the hook exists even if this is the very first call on a
            // fresh domain and neither load hook has run yet.
            Register();
            Arm();
            SessionState.SetBool(KeyExplicit, true);
            SessionState.EraseString(KeyPending);
        }

        /// <summary>
        /// Timestamps the start of a Play Mode session, so the report written by
        /// that session can be told apart from older files in the folder.
        /// </summary>
        private static void Arm()
        {
            SessionState.SetBool(KeyActive, true);
            // A second of slack, so a report written the instant Play begins still counts.
            SessionState.SetString(KeyStartedTicks, (DateTime.UtcNow.Ticks - TimeSpan.TicksPerSecond).ToString());
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            // Arm on EVERY entry into Play Mode, not only runs launched from the
            // ImmersiTest menu. Pressing Unity's own Play button is the normal way
            // people test, and it must produce a report just the same — previously
            // the flag was only set by Run XR Test, so an ordinary Play/Stop
            // captured the JSON and then silently did nothing with it.
            if (state == PlayModeStateChange.EnteredPlayMode)
            {
                if (!SessionState.GetBool(KeyActive, false)) Arm();
                return;
            }

            if (state != PlayModeStateChange.EnteredEditMode) return;
            if (!SessionState.GetBool(KeyActive, false)) return;

            SessionState.SetBool(KeyActive, false);
            Debug.Log("[ImmersiTest] PLAYMODE EXIT DETECTED");

            long ticks;
            long.TryParse(SessionState.GetString(KeyStartedTicks, "0"), out ticks);
            var since = ticks > 0 ? new DateTime(ticks, DateTimeKind.Utc) : DateTime.UtcNow.AddMinutes(-10);

            bool explicitRun = SessionState.GetBool(KeyExplicit, false);
            SessionState.SetBool(KeyExplicit, false);

            // Deferred: give the profiler's file write a moment to land, and avoid
            // starting a web request while Unity is still tearing down Play Mode.
            EditorApplication.delayCall += () => Finish(since, explicitRun);
        }

        private static void Finish(DateTime since, bool explicitRun)
        {
            var newest = NewestReportSince(since);

            if (newest == null)
            {
                // A Play session that produced nothing is only noteworthy when the
                // user actually asked for a test. Pressing Play for unrelated work
                // must stay silent.
                if (explicitRun)
                {
                    Debug.LogWarning(
                        "[ImmersiTest] The test finished but no report file was found in "
                        + XRTestProfiler.ReportFolder()
                        + ".\nCheck the Console for \"[ImmersiTest] Session STARTED\" — if it is missing, the "
                        + "profiler did not run.");
                }
                return;
            }

            // One report is uploaded once. Guards against a second delayCall and
            // against a later Play session that produced no new file of its own.
            var stamp = newest.FullName + "|" + newest.LastWriteTimeUtc.Ticks;
            if (SessionState.GetString(KeyLastUploaded, string.Empty) == stamp) return;
            SessionState.SetString(KeyLastUploaded, stamp);

            Debug.Log("[ImmersiTest] REPORT FOUND: " + newest.FullName);
            Analyse(newest.FullName);
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
        private static FileInfo NewestReportSince(DateTime since)
        {
            var folder = XRTestProfiler.ReportFolder();
            if (!Directory.Exists(folder)) return null;

            try
            {
                return new DirectoryInfo(folder)
                    .GetFiles("xrtest_*.json")
                    .Where(f => f.LastWriteTimeUtc >= since)
                    .OrderByDescending(f => f.LastWriteTimeUtc)
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
