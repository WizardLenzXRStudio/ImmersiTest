// =============================================================================
//  ImmersiTestMenu.cs  —  the "ImmersiTest" Unity menu
//  Wizardlenz XR Studio
//
//    ImmersiTest / Add Test Profiler    create + select the profiler object
//    ImmersiTest / Run XR Test          validate, then enter Play Mode
//    ImmersiTest / Open Last Report     reopen the most recent analysis
//    ImmersiTest / Open Reports Folder  where the JSON files are written
//    ImmersiTest / Settings             Project Settings > ImmersiTest
//    ImmersiTest / About
// =============================================================================

using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Wizardlenz.ImmersiTest.Editor
{
    internal static class ImmersiTestMenu
    {
        private const string Root = "ImmersiTest/";

        /* ------------------------------------------------ add test profiler -- */

        [MenuItem(Root + "Add Test Profiler", false, 10)]
        public static void AddTestProfiler()
        {
            var existing = FindProfiler();
            if (existing != null)
            {
                // Never create a second one: two profilers would race for the
                // same report file and produce two partial captures.
                Selection.activeGameObject = existing.gameObject;
                EditorGUIUtility.PingObject(existing.gameObject);
                EditorUtility.DisplayDialog("ImmersiTest",
                    $"This scene already has an XR Test Profiler on \"{existing.gameObject.name}\".\n\n"
                    + "It has been selected for you.", "OK");
                return;
            }

            var go = new GameObject("XR Test Profiler");
            Undo.RegisterCreatedObjectUndo(go, "Add XR Test Profiler");
            var profiler = Undo.AddComponent<XRTestProfiler>(go);

            // A sensible starting name beats "Untitled XR Application".
            if (!string.IsNullOrWhiteSpace(Application.productName))
            {
                profiler.applicationName = Application.productName;
            }

            Selection.activeGameObject = go;
            EditorGUIUtility.PingObject(go);
            EditorSceneManager.MarkSceneDirty(go.scene);

            Debug.Log("[ImmersiTest] Profiler added. Set the Application Name and Target FPS in the Inspector, "
                      + "then run ImmersiTest > Run XR Test.");
        }

        /* -------------------------------------------------------- run test -- */

        [MenuItem(Root + "Run XR Test", false, 11)]
        public static void RunXRTest()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                EditorUtility.DisplayDialog("ImmersiTest", "Play Mode is already running.", "OK");
                return;
            }

            var profiler = FindProfiler();
            if (profiler == null)
            {
                if (EditorUtility.DisplayDialog("ImmersiTest — No Profiler",
                        "This scene has no XR Test Profiler.\n\nAdd one now?",
                        "Add Test Profiler", "Cancel"))
                {
                    AddTestProfiler();
                }
                return;
            }

            if (!Validate(profiler)) return;

            if (!ImmersiTestSettings.IsSecureEndpoint(ImmersiTestSettings.ServiceUrl)
                && !EditorUtility.DisplayDialog("ImmersiTest — Insecure Endpoint",
                    "The configured service URL is not HTTPS, so the report cannot be uploaded "
                    + "when the test finishes.\n\nRun the test anyway and keep the report locally?",
                    "Run Anyway", "Cancel"))
            {
                return;
            }

            // Hand off to XRTestRunner, which watches for Play Mode ending.
            XRTestRunner.BeginRun();
            EditorApplication.isPlaying = true;
        }

        private static bool Validate(XRTestProfiler profiler)
        {
            if (string.IsNullOrWhiteSpace(profiler.applicationName)
                || profiler.applicationName == "Untitled XR Application")
            {
                if (EditorUtility.DisplayDialog("ImmersiTest — Configuration",
                        "Set an Application Name on the XR Test Profiler before running a test.\n\n"
                        + "It identifies the application on the report.",
                        "Select Profiler", "Cancel"))
                {
                    Selection.activeGameObject = profiler.gameObject;
                    EditorGUIUtility.PingObject(profiler.gameObject);
                }
                return false;
            }

            if (profiler.targetFps < 1)
            {
                EditorUtility.DisplayDialog("ImmersiTest — Configuration",
                    "Target FPS must be at least 1. Use 72 or 90 for VR headsets, 60 for mobile AR.", "OK");
                Selection.activeGameObject = profiler.gameObject;
                return false;
            }

            if (!profiler.autoStartOnPlay)
            {
                return EditorUtility.DisplayDialog("ImmersiTest — Manual Session",
                    "\"Auto Start On Play\" is off, so profiling will not begin by itself.\n\n"
                    + $"Start it manually with {profiler.startKey} during Play Mode.",
                    "Run Anyway", "Cancel");
            }

            if (!profiler.isActiveAndEnabled || !profiler.gameObject.activeInHierarchy)
            {
                EditorUtility.DisplayDialog("ImmersiTest — Configuration",
                    "The XR Test Profiler GameObject is disabled and will not record anything.\n\n"
                    + "Enable it, then run the test again.", "OK");
                Selection.activeGameObject = profiler.gameObject;
                return false;
            }

            return true;
        }

        /* ---------------------------------------------------------- reports -- */

        [MenuItem(Root + "Open Last Report", false, 30)]
        public static void OpenLastReport()
        {
            var url = ImmersiTestSettings.LastReportUrl;
            if (string.IsNullOrEmpty(url))
            {
                EditorUtility.DisplayDialog("ImmersiTest",
                    "No analysis has been created from this project yet.\n\n"
                    + "Run ImmersiTest > Run XR Test to produce one.", "OK");
                return;
            }
            Application.OpenURL(url);
        }

        [MenuItem(Root + "Open Last Report", true)]
        public static bool OpenLastReportValidate() => !string.IsNullOrEmpty(ImmersiTestSettings.LastReportUrl);

        [MenuItem(Root + "Open Reports Folder", false, 31)]
        public static void OpenReportsFolder()
        {
            var folder = XRTestProfiler.ReportFolder();
            if (!Directory.Exists(folder)) Directory.CreateDirectory(folder);
            EditorUtility.RevealInFinder(folder + Path.DirectorySeparatorChar);
        }

        [MenuItem(Root + "Analyse an Existing Report…", false, 32)]
        public static void AnalyseExisting()
        {
            var folder = XRTestProfiler.ReportFolder();
            if (!Directory.Exists(folder)) Directory.CreateDirectory(folder);

            var path = EditorUtility.OpenFilePanel("Select an XR Test Profiler report", folder, "json");
            if (string.IsNullOrEmpty(path)) return;
            ImmersiTestUploader.UploadAndOpen(path);
        }

        /* --------------------------------------------------------- settings -- */

        [MenuItem(Root + "Settings", false, 50)]
        public static void OpenSettings() => SettingsService.OpenProjectSettings("Project/ImmersiTest");

        [MenuItem(Root + "About", false, 51)]
        public static void About()
        {
            EditorUtility.DisplayDialog("ImmersiTest",
                "ImmersiTest 2.0.0\n"
                + "Wizardlenz XR Studio\n"
                + "Test the Experience. Trust the Immersion.\n\n"
                + "Free XR application testing and analysis.\n\n"
                + "Privacy: only the generated profiler JSON is uploaded. Your project, source, "
                + "scenes, prefabs, assets and repository never leave this machine. Reports are held "
                + "temporarily by the service and deleted automatically.\n\n"
                + "Service: " + ImmersiTestSettings.ServiceUrl,
                "Close");
        }

        /* ---------------------------------------------------------- helpers -- */

        /// <summary>First profiler across all loaded scenes, including inactive objects.</summary>
        internal static XRTestProfiler FindProfiler()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded) continue;
                foreach (var root in scene.GetRootGameObjects())
                {
                    var found = root.GetComponentsInChildren<XRTestProfiler>(true).FirstOrDefault();
                    if (found != null) return found;
                }
            }
            return null;
        }
    }
}
