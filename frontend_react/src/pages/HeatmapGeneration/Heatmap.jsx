import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui";
import { useAuth } from "@/AuthContext.jsx";
import axios from 'axios';

export default function HeatmapPage() {
  const { directory } = useParams();
  const { getSession } = useAuth();
  const location = useLocation();

  // State management
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [analyticsUrl, setAnalyticsUrl] = useState(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [processingStarted, setProcessingStarted] = useState(
      location.state?.initialProcessingStatus?.status === 'processing' ||
      location.state?.initialProcessingStatus?.status === 'pending' ||
      location.state?.initialProcessingStatus?.status === 'waiting' ||
      false
  );
  const [debugLogs, setDebugLogs] = useState([]);
  const debugLoggingEnabledRef = useRef(true); // Control debug logging verbosity

  // ---- Race Condition Guards ----
  const processingCompletedRef = useRef(false); // Guard for completed polling
  const processInitiatedRef = useRef(false); // POST /api/process only once per run
  const pollingIntervalRef = useRef(null);
  // New: Only allow one fetchProcessingStatus() at a time
  const isFetchingRef = useRef(false);

  // Polling interval in ms
  const POLLING_INTERVAL = 2000;

  // Add debug log
  const addDebugLog = (message) => {
    if (debugLoggingEnabledRef.current) {
      setDebugLogs(prevLogs => [...prevLogs, `${new Date().toISOString()} - ${message}`]);
    }
  };

  // Helper to get authorization header
  const getAuthHeader = async () => {
    const session = await getSession();
    if (!session) {
      setError('Authentication required.');
      throw new Error('Authentication required.');
    }
    return { Authorization: `Bearer ${session.access_token}` };
  };

  // Fetch heatmap and analytics data once processing is complete
  const fetchHeatmapAndAnalytics = async () => {
    addDebugLog("Fetching heatmap and analytics data...");
    try {
      setLoading(true);
      const headers = await getAuthHeader();

      const heatmapResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/files/${directory}/heatmap.png`,
          { headers, responseType: 'blob' }
      );
      setHeatmapUrl(URL.createObjectURL(heatmapResponse.data));
      addDebugLog("Heatmap fetched successfully.");

      const analyticsResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/files/${directory}/hourly_counts.csv`,
          { headers }
      );
      // For CSV, we can just set the URL to trigger download, or process its content
      const analyticsBlob = new Blob([analyticsResponse.data], { type: 'text/csv' });
      setAnalyticsUrl(URL.createObjectURL(analyticsBlob));
      addDebugLog("Analytics data fetched successfully.");
    } catch (err) {
      console.error('Error fetching heatmap or analytics:', err);
      setError(err.response?.data?.detail || 'Failed to load heatmap or analytics.');
      addDebugLog(`Error fetching heatmap/analytics: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetches initial status or initiates processing (with atomic guard)
  const fetchProcessingStatus = async () => {
    // Prevent concurrent calls
    if (isFetchingRef.current) {
      addDebugLog("fetchProcessingStatus: Skipped (already in flight)");
      return;
    }
    isFetchingRef.current = true;

    try {
      if (processingCompletedRef.current) {
        addDebugLog("Processing already completed, skipping status fetch.");
        return;
      }
      addDebugLog(`fetchProcessingStatus: processInitiatedRef.current=${processInitiatedRef.current}, processingStarted=${processingStarted}`);
      setLoading(true);
      const headers = await getAuthHeader();
      const statusUrl = `${import.meta.env.VITE_API_URL}/api/process/status/${directory}`;
      const processUrl = `${import.meta.env.VITE_API_URL}/api/process/${directory}`;

      let response;
      // Only POST if not POSTed this run and not started
      if (!processInitiatedRef.current && !processingStarted) {
        processInitiatedRef.current = true;
        addDebugLog("POST /api/process to initiate processing...");
        response = await axios.post(processUrl, {}, { headers });
        setProcessingStarted(true);
        addDebugLog(`POST response: ${JSON.stringify(response.data)}`);
      } else {
        addDebugLog("GET /api/process/status to poll status...");
        response = await axios.get(statusUrl, { headers });
        addDebugLog(`GET status response: ${JSON.stringify(response.data)}`);
      }

      const data = response.data;
      setStatusMessage(data.message || 'Fetching status...');
      setProgress(data.progress || 0);

      if (data.status === 'completed') {
        setProcessing(false);
        processingCompletedRef.current = true;
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        fetchHeatmapAndAnalytics();
        addDebugLog("Processing completed, polling stopped.");
      } else if (data.status === 'processing') {
        setProcessing(true);
        setProcessingStarted(true);
        addDebugLog("Processing in progress.");
      } else if (data.status === 'pending' || data.status === 'waiting') {
        setProcessing(false);
        setProcessingStarted(true);
        addDebugLog("Processing pending/waiting.");
      } else {
        setProcessing(false);
        setError(data.message || 'Unknown processing status.');
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        addDebugLog(`Processing error: ${data.message}`);
      }
    } catch (err) {
      console.error('Error fetching processing status:', err);
      setError(err.response?.data?.detail || 'Failed to fetch processing status.');
      setProcessing(false);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      addDebugLog(`API error: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
      isFetchingRef.current = false;
    }
  };

  // Effect for initial status check and polling (race-free)
  useEffect(() => {
    if (!directory) {
      setError('No directory specified.');
      setLoading(false);
      return;
    }

    addDebugLog("useEffect: Initializing status check and polling.");

    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Reset refs on directory change/mount
    processInitiatedRef.current = false;
    processingCompletedRef.current = false;
    isFetchingRef.current = false;
    setProcessingStarted(false);

    // Immediately fetch status (which might initiate POST if not already started)
    fetchProcessingStatus();

    // Set up polling
    pollingIntervalRef.current = setInterval(() => {
      fetchProcessingStatus();
    }, POLLING_INTERVAL);

    // Cleanup on unmount
    return () => {
      addDebugLog("useEffect cleanup: Clearing polling interval.");
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
    // eslint-disable-next-line
  }, [directory, getSession]);

  const refreshStatus = () => {
    addDebugLog("Manual status refresh initiated.");
    fetchProcessingStatus();
  };

  const restartProcessing = async () => {
    addDebugLog("Restarting processing...");
    // Reset relevant states and refs
    setProcessing(true);
    setProgress(0);
    setHeatmapUrl(null);
    setAnalyticsUrl(null);
    setError('');
    setStatusMessage('Restarting processing...');
    processingCompletedRef.current = false;
    processInitiatedRef.current = false;
    isFetchingRef.current = false;
    setProcessingStarted(false);

    // Clear existing polling if any
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    try {
      const headers = await getAuthHeader();
      const processUrl = `${import.meta.env.VITE_API_URL}/api/process/${directory}`;
      addDebugLog(`POST /api/process/${directory} for restart initiated.`);
      const response = await axios.post(processUrl, {}, { headers });
      addDebugLog(`Restart Processing API call response: ${JSON.stringify(response.data)}`);

      // After restart, start polling again
      fetchProcessingStatus();
      pollingIntervalRef.current = setInterval(() => {
        fetchProcessingStatus();
      }, POLLING_INTERVAL);
    } catch (err) {
      console.error('Error restarting processing:', err);
      setError(err.response?.data?.detail || 'Failed to restart processing.');
      setProcessing(false);
      addDebugLog(`Restart processing API error: ${err.response?.data?.detail || err.message}`);
    }
  };

  const downloadAnalytics = () => {
    if (analyticsUrl) {
      const link = document.createElement('a');
      link.href = analyticsUrl;
      link.setAttribute('download', `analytics_${directory}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addDebugLog("Analytics download initiated.");
    } else {
      addDebugLog("No analytics URL available to download.");
      setError("Analytics data not available for download.");
    }
  };

  const toggleDebugLogging = () => {
    debugLoggingEnabledRef.current = !debugLoggingEnabledRef.current;
    addDebugLog(`Debug logging ${debugLoggingEnabledRef.current ? 'enabled' : 'disabled'}.`);
    if (!debugLoggingEnabledRef.current) {
      setDebugLogs([]);
    }
  };

  return (
      <div className="container mx-auto p-4 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Heatmap & Analytics for {directory}</CardTitle>
            <CardDescription>
              View the generated heatmap and download analytics data for your video.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
                <div className="text-red-500 mb-4">{error}</div>
            )}

            {loading && !heatmapUrl ? (
                <div className="text-center py-8">Loading...</div>
            ) : (
                <div>
                  {/* Heatmap Display */}
                  {heatmapUrl ? (
                      <div className="mb-4">
                        <h3 className="text-xl font-semibold mb-2">Generated Heatmap</h3>
                        <img src={heatmapUrl} alt="Heatmap" className="max-w-full h-auto rounded-lg shadow-lg" />
                      </div>
                  ) : (
                      <div className="mb-4 p-4 border rounded-lg bg-blue-50 text-blue-700">
                        <p className="font-semibold">Processing Status: {statusMessage}</p>
                        <p>Progress: {progress}%</p>
                        <p className="text-sm text-gray-500">Last Updated: {lastUpdated.toLocaleTimeString()}</p>
                        {processing && (
                            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                            </div>
                        )}
                        {progress === 100 && !heatmapUrl && (
                            <p className="mt-2 text-green-600">Processing completed. Fetching heatmap...</p>
                        )}
                      </div>
                  )}

                  {/* Analytics Download */}
                  {heatmapUrl && (
                      <div className="mb-4 p-4 border rounded-lg bg-green-50 text-green-700 flex justify-between items-center">
                        <div>
                          <h3 className="text-xl font-semibold mb-2">Analytics Data</h3>
                          <p>Analytics data is ready for download.</p>
                        </div>
                        <div>
                          <Button onClick={downloadAnalytics} variant="outline">
                            Download Analytics Data
                          </Button>
                        </div>
                      </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={refreshStatus} variant="outline">
                      Refresh Status
                    </Button>
                    <Button onClick={restartProcessing} variant="outline">
                      Restart Processing
                    </Button>
                    <Button onClick={toggleDebugLogging} variant="outline" size="sm" className="ml-auto">
                      {debugLoggingEnabledRef.current ? 'Disable Logs' : 'Enable Logs'}
                    </Button>
                  </div>

                  {/* Debug logs (collapsible) */}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-gray-500">Debug Logs</summary>
                    <div className="mt-2 p-2 bg-gray-100 rounded text-xs font-mono h-40 overflow-y-auto">
                      {debugLogs.map((log, index) => (
                          <div key={index} className="pb-1">{log}</div>
                      ))}
                    </div>
                  </details>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}