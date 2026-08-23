// =============================================================================
//  ImmersiTestSettings.cs  —  where the package points and how it behaves
//  Wizardlenz XR Studio
//
//  Stored in EditorPrefs, scoped by project path, so nothing is added to the
//  user's repository and no settings asset needs to be committed.
// =============================================================================

using UnityEditor;
using UnityEngine;

namespace Wizardlenz.ImmersiTest.Editor
{
    internal static class ImmersiTestSettings
    {
        /// <summary>
        /// Production ImmersiTest service. Must be HTTPS: the package refuses
        /// to upload to a plain-HTTP host unless it is explicitly localhost.
        /// </summary>
        public const string DefaultServiceUrl = "https://xrtestlab.wizardlenz.com";

        // EditorPrefs storage key. Deliberately still "Wizardlenz.XRTestLab." —
        // it is an internal identifier that no user ever sees, and changing it
        // would silently reset the configured Service URL on every machine that
        // already has one. Renaming it buys nothing; leave it alone.
        private const string KeyPrefix = "Wizardlenz.XRTestLab.";

        private static string Scoped(string key) => KeyPrefix + key + "." + Application.dataPath.GetHashCode();

        public static string ServiceUrl
        {
            get => EditorPrefs.GetString(Scoped("ServiceUrl"), DefaultServiceUrl).TrimEnd('/');
            set => EditorPrefs.SetString(Scoped("ServiceUrl"), (value ?? string.Empty).Trim().TrimEnd('/'));
        }

        public static bool OpenBrowserOnComplete
        {
            get => EditorPrefs.GetBool(Scoped("OpenBrowser"), true);
            set => EditorPrefs.SetBool(Scoped("OpenBrowser"), value);
        }

        /// <summary>Most recent report URL, so it can be reopened from the menu.</summary>
        public static string LastReportUrl
        {
            get => EditorPrefs.GetString(Scoped("LastReportUrl"), string.Empty);
            set => EditorPrefs.SetString(Scoped("LastReportUrl"), value ?? string.Empty);
        }

        /// <summary>True when the configured endpoint is safe to upload to.</summary>
        public static bool IsSecureEndpoint(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return false;
            if (url.StartsWith("https://", System.StringComparison.OrdinalIgnoreCase)) return true;
            // Local development only.
            return url.StartsWith("http://localhost", System.StringComparison.OrdinalIgnoreCase)
                || url.StartsWith("http://127.0.0.1", System.StringComparison.OrdinalIgnoreCase);
        }

        [SettingsProvider]
        public static SettingsProvider CreateProvider()
        {
            return new SettingsProvider("Project/ImmersiTest", SettingsScope.Project)
            {
                label = "ImmersiTest",
                keywords = new[] { "xr", "test", "lab", "profiler", "wizardlenz", "vr", "ar" },
                guiHandler = _ =>
                {
                    EditorGUILayout.Space(6);
                    EditorGUILayout.LabelField("ImmersiTest", EditorStyles.boldLabel);
                    EditorGUILayout.LabelField("Wizardlenz XR Studio — Test the Experience. Trust the Immersion.",
                        EditorStyles.miniLabel);
                    EditorGUILayout.Space(10);

                    EditorGUI.BeginChangeCheck();
                    string url = EditorGUILayout.TextField(
                        new GUIContent("Service URL", "The ImmersiTest service that analyses your reports."),
                        ServiceUrl);
                    bool open = EditorGUILayout.Toggle(
                        new GUIContent("Open browser on complete", "Open the report automatically once analysis is ready."),
                        OpenBrowserOnComplete);
                    if (EditorGUI.EndChangeCheck())
                    {
                        ServiceUrl = url;
                        OpenBrowserOnComplete = open;
                    }

                    if (!IsSecureEndpoint(ServiceUrl))
                    {
                        EditorGUILayout.HelpBox(
                            "The service URL must use HTTPS (localhost is allowed for development). "
                            + "Uploads are blocked while it does not.",
                            MessageType.Error);
                    }

                    EditorGUILayout.Space(12);
                    EditorGUILayout.LabelField("Privacy", EditorStyles.boldLabel);
                    EditorGUILayout.HelpBox(
                        "Only the generated XR Test Profiler JSON is uploaded.\n\n"
                        + "Your Unity project, C# source, scenes, prefabs, assets, models, textures, "
                        + "materials and repository are never read or transmitted by this package.\n\n"
                        + "Reports are held temporarily by the service and deleted automatically.",
                        MessageType.Info);

                    EditorGUILayout.Space(6);
                    if (!string.IsNullOrEmpty(LastReportUrl))
                    {
                        EditorGUILayout.LabelField("Last report", LastReportUrl, EditorStyles.miniLabel);
                        if (GUILayout.Button("Open Last Report", GUILayout.Width(160)))
                        {
                            Application.OpenURL(LastReportUrl);
                        }
                    }

                    EditorGUILayout.Space(6);
                    if (GUILayout.Button("Reset To Defaults", GUILayout.Width(160)))
                    {
                        ServiceUrl = DefaultServiceUrl;
                        OpenBrowserOnComplete = true;
                    }
                },
            };
        }
    }
}
