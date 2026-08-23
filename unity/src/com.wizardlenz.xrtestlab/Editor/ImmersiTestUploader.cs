// =============================================================================
//  ImmersiTestUploader.cs  —  sends ONE JSON file and opens the report
//  Wizardlenz XR Studio
//
//  PRIVACY CONTRACT
//  ----------------
//  This is the only place in the package that performs network I/O, and the
//  only thing it ever reads from disk is the single profiler report file whose
//  path it is given. It does not walk the project, does not touch Assets/,
//  Library/, Packages/ or any version-control directory, and has no code path
//  that can attach an additional file to the request body.
//
//  The request body is exactly the bytes of that one JSON report.
// =============================================================================

using System;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace Wizardlenz.ImmersiTest.Editor
{
    internal static class ImmersiTestUploader
    {
        [Serializable]
        private class AnalyzeResponse
        {
            public string token;
            public string reportId;
            public string reportUrl;
            public string expiresAt;
            public int expiresInSeconds;
        }

        [Serializable]
        private class ApiErrorEnvelope
        {
            public ApiError error;
        }

        [Serializable]
        private class ApiError
        {
            public string code;
            public string message;
        }

        /// <summary>
        /// Uploads one profiler report and opens the resulting analysis.
        /// </summary>
        /// <param name="reportPath">Absolute path of the JSON report to send.</param>
        /// <param name="onFailure">
        /// Invoked with (reportPath, reason) when the upload could not complete.
        /// The automatic post-Play-Mode flow passes a handler that offers Retry;
        /// when null the failure is reported with a plain dialog instead.
        /// </param>
        public static void UploadAndOpen(string reportPath, Action<string, string> onFailure = null)
        {
            if (string.IsNullOrEmpty(reportPath) || !File.Exists(reportPath))
            {
                EditorUtility.DisplayDialog("ImmersiTest",
                    "The report file could not be found.\n\n" + (reportPath ?? "(no path)"), "OK");
                return;
            }

            string serviceUrl = ImmersiTestSettings.ServiceUrl;
            if (!ImmersiTestSettings.IsSecureEndpoint(serviceUrl))
            {
                Debug.LogError("[ImmersiTest] UPLOAD BLOCKED: endpoint is not HTTPS -> " + serviceUrl);
                EditorUtility.DisplayDialog("ImmersiTest — Insecure Endpoint",
                    "Uploads must use HTTPS.\n\nCurrent service URL:\n" + serviceUrl
                    + "\n\nSet an https:// address in Project Settings > ImmersiTest.",
                    "OK");
                return;
            }

            string json;
            try
            {
                // The one and only file this package reads for upload.
                json = File.ReadAllText(reportPath);
            }
            catch (Exception e)
            {
                EditorUtility.DisplayDialog("ImmersiTest",
                    "Could not read the report file.\n\n" + e.Message, "OK");
                return;
            }

            // Always the API endpoint. The '#/r/<token>' fragment belongs to the
            // browser URL the server returns, never to the POST target.
            string endpoint = serviceUrl + "/api/analyze";
            Debug.Log("[ImmersiTest] UPLOAD STARTED -> " + endpoint);
            var request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbPOST)
            {
                uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(json)),
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = 60,
            };
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Accept", "application/json");

            var operation = request.SendWebRequest();
            EditorUtility.DisplayProgressBar("ImmersiTest", "Uploading test report…", 0.25f);

            void Poll()
            {
                if (!operation.isDone)
                {
                    EditorUtility.DisplayProgressBar("ImmersiTest", "Uploading test report…",
                        Mathf.Clamp01(0.25f + operation.progress * 0.7f));
                    return;
                }

                EditorApplication.update -= Poll;
                EditorUtility.ClearProgressBar();
                Complete(request, reportPath, onFailure);
            }

            EditorApplication.update += Poll;
        }

        private static void Complete(UnityWebRequest request, string reportPath, Action<string, string> onFailure)
        {
            try
            {
#if UNITY_2020_2_OR_NEWER
                bool failed = request.result != UnityWebRequest.Result.Success;
#else
                bool failed = request.isNetworkError || request.isHttpError;
#endif
                string body = request.downloadHandler?.text ?? string.Empty;

                if (failed)
                {
                    string detail = FriendlyError(request, body);
                    Debug.LogError($"[ImmersiTest] UPLOAD FAILED ({request.responseCode}): {detail}\n{body}");

                    if (onFailure != null)
                    {
                        // The automatic flow owns the retry conversation.
                        onFailure(reportPath, detail);
                        return;
                    }

                    if (EditorUtility.DisplayDialog("ImmersiTest — Upload Failed",
                            detail + "\n\nYour report is still saved locally at:\n" + reportPath,
                            "Show Report File", "Close"))
                    {
                        EditorUtility.RevealInFinder(reportPath);
                    }
                    return;
                }

                var parsed = JsonUtility.FromJson<AnalyzeResponse>(body);
                if (parsed == null || string.IsNullOrEmpty(parsed.reportUrl))
                {
                    Debug.LogError("[ImmersiTest] The service returned an unexpected response:\n" + body);
                    if (onFailure != null)
                    {
                        onFailure(reportPath, "The service returned an unexpected response.");
                        return;
                    }
                    EditorUtility.DisplayDialog("ImmersiTest",
                        "The service returned an unexpected response. See the Console for details.", "OK");
                    return;
                }

                ImmersiTestSettings.LastReportUrl = parsed.reportUrl;
                int minutes = Mathf.Max(1, parsed.expiresInSeconds / 60);

                Debug.Log("[ImmersiTest] UPLOAD SUCCESS");
                Debug.Log($"[ImmersiTest] This temporary analysis expires in about {minutes} minute(s).");

                // The automatic flow always opens the report: stopping Play Mode is
                // the last action the user should have to take.
                if (onFailure != null || ImmersiTestSettings.OpenBrowserOnComplete)
                {
                    Debug.Log("[ImmersiTest] OPENING REPORT: " + parsed.reportUrl);
                    Application.OpenURL(parsed.reportUrl);
                }
                else if (EditorUtility.DisplayDialog("ImmersiTest — Analysis Ready",
                             $"Your report is ready and expires in about {minutes} minute(s).",
                             "Open In Browser", "Later"))
                {
                    Application.OpenURL(parsed.reportUrl);
                }
            }
            finally
            {
                request.Dispose();
            }
        }

        private static string FriendlyError(UnityWebRequest request, string body)
        {
            // Prefer the API's own plain-English message when there is one.
            try
            {
                var envelope = JsonUtility.FromJson<ApiErrorEnvelope>(body);
                if (!string.IsNullOrEmpty(envelope?.error?.message)) return envelope.error.message;
            }
            catch
            {
                /* fall through to the transport-level message */
            }

            if (request.responseCode == 0)
            {
                return "Could not reach the ImmersiTest service. Check your internet connection "
                     + "and the service URL in Project Settings > ImmersiTest.";
            }
            if (request.responseCode == 413) return "That report is too large to analyse.";
            if (request.responseCode == 429) return "Too many uploads from this connection. Wait a moment and try again.";
            return string.IsNullOrEmpty(request.error) ? $"HTTP {request.responseCode}" : request.error;
        }
    }
}
