import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui";
import { useAuth } from "@/AuthContext.jsx";
import axios from 'axios';

// Define processing states as constants for clarity
const PROCESS_STATE = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error'
};

export default function HeatmapPage() {
  const { directory } = useParams();
  const { getSession } = useAuth();
  const location = useLocation();

  // Simplified state management
  const [processState, setProcessState] = useState(
      location.state?.initialProcessingStatus?.status === 'processing' ||
      location.state?.initialProcessingStatus?.status === 'pending' ||
      location.state?.initialProcessingStatus?.status === 'waiting'
          ? PROCESS_STATE.PROCESSING
          : PROCESS_STATE.IDLE
  );
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [error, setError] = useState('');

  // Results state
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [analyticsUrl, setAnalyticsUrl] = useState(null);

  // Fetching state - separate from process state
  const [isFetchingResults, setIsFetchingResults] = useState(false);

  // Debug state (optional, can be removed if not needed)
  const [debugLogs, setDebugLogs] = useState([]);
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(true);

  // Polling interval in ms
  const POLLING_INTERVAL = 2000;

  // Use a ref to track the polling interval
  const pollingIntervalRef = useRef(null);

  // Flag to track if we've already tried to fetch the heatmap
  const heatmapFetchAttemptedRef = useRef(false);

  // Add debug log (simplified)
  const addDebugLog = useCallback((message) => {
    if (debugLoggingEnabled) {
      setDebugLogs(prevLogs => [...prevLogs, `${new Date().toISOString()} - ${message}`]);
    }
  }, [debugLoggingEnabled]);

  // Helper to get authorization header
  const getAuthHeader = useCallback(async () => {
    const session = await getSession();
    if (!session) {
      setError('Authentication required.');
      throw new Error('Authentication required.');
    }
    return { Authorization: `Bearer ${session.access_token}` };
  }, [getSession]);

  // Helper to clear polling interval
  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      addDebugLog("Clearing polling interval");
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [addDebugLog]);

  // Fetch heatmap and analytics data
  const fetchHeatmapAndAnalytics = useCallback(async () => {
    // Don't fetch if we already have the heatmap or are currently fetching
    if (heatmapUrl || isFetchingResults || heatmapFetchAttemptedRef.current) {
      return;
    }

    addDebugLog("Fetching heatmap and analytics data...");
    setIsFetchingResults(true);
    heatmapFetchAttemptedRef.current = true;

    try {
      const headers = await getAuthHeader();

      // Fetch heatmap image
      const heatmapResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/files/${directory}/heatmap.png`,
          { headers, responseType: 'blob' }
      );

      // Create URL from blob
      const heatmapObjectUrl = URL.createObjectURL(heatmapResponse.data);
      setHeatmapUrl(heatmapObjectUrl);
      addDebugLog("Heatmap fetched successfully: " + heatmapObjectUrl);

      // Fetch analytics CSV
      const analyticsResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/files/${directory}/hourly_counts.csv`,
          { headers }
      );
      const analyticsBlob = new Blob([analyticsResponse.data], { type: 'text/csv' });
      setAnalyticsUrl(URL.createObjectURL(analyticsBlob));
      addDebugLog("Analytics data fetched successfully.");

      // Make sure polling is stopped
      clearPolling();
    } catch (err) {
      console.error('Error fetching heatmap or analytics:', err);
      setError(err.response?.data?.detail || 'Failed to load heatmap or analytics.');
      addDebugLog(`Error fetching heatmap/analytics: ${err.response?.data?.detail || err.message}`);

      // Reset the flag so we can try again
      heatmapFetchAttemptedRef.current = false;
    } finally {
      setIsFetchingResults(false);
    }
  }, [directory, getAuthHeader, heatmapUrl, isFetchingResults, clearPolling, addDebugLog]);

  // Unified function to check processing status
  const checkProcessingStatus = useCallback(async () => {
    // Don't check if we're already in completed state and have the heatmap
    if (processState === PROCESS_STATE.COMPLETED && heatmapUrl) {
      clearPolling();
      return;
    }

    try {
      const headers = await getAuthHeader();
      const statusUrl = `${import.meta.env.VITE_API_URL}/api/process/status/${directory}`;

      addDebugLog("Checking processing status...");
      const response = await axios.get(statusUrl, { headers });
      const data = response.data;

      addDebugLog(`Status response: ${JSON.stringify(data)}`);
      setStatusMessage(data.message || 'Processing...');
      setProgress(data.progress || 0);
      setLastUpdated(new Date());

      // Update state based on status
      if (data.status === 'completed') {
        setProcessState(PROCESS_STATE.COMPLETED);

        // Stop polling immediately
        clearPolling();

        // Fetch results if we don't have them yet and haven't attempted
        if (!heatmapUrl && !isFetchingResults && !heatmapFetchAttemptedRef.current) {
          fetchHeatmapAndAnalytics();
        }
      } else if (data.status === 'processing' || data.status === 'pending' || data.status === 'waiting') {
        setProcessState(PROCESS_STATE.PROCESSING);
      } else {
        setProcessState(PROCESS_STATE.ERROR);
        setError(data.message || 'Unknown processing status.');
        clearPolling();
      }
    } catch (err) {
      console.error('Error checking processing status:', err);
      setError(err.response?.data?.detail || 'Failed to check processing status.');
      addDebugLog(`Status check error: ${err.response?.data?.detail || err.message}`);
    }
  }, [directory, getAuthHeader, processState, heatmapUrl, isFetchingResults, clearPolling, fetchHeatmapAndAnalytics, addDebugLog]);

  // Function to initiate processing
  const initiateProcessing = useCallback(async () => {
    try {
      // Clear any existing polling
      clearPolling();

      // Reset state
      setProcessState(PROCESS_STATE.PROCESSING);
      setProgress(0);
      setStatusMessage('Initiating processing...');
      setHeatmapUrl(null);
      setAnalyticsUrl(null);
      setError('');
      heatmapFetchAttemptedRef.current = false;

      const headers = await getAuthHeader();
      const processUrl = `${import.meta.env.VITE_API_URL}/api/process/${directory}`;

      addDebugLog("Initiating processing...");
      await axios.post(processUrl, {}, { headers });
      addDebugLog("Processing initiated successfully.");

      // Start polling after successful initiation
      startPolling();
    } catch (err) {
      console.error('Error initiating processing:', err);
      setError(err.response?.data?.detail || 'Failed to initiate processing.');
      setProcessState(PROCESS_STATE.ERROR);
      addDebugLog(`Initiate processing error: ${err.response?.data?.detail || err.message}`);
    }
  }, [directory, getAuthHeader, clearPolling, addDebugLog]);

  // Start polling function
  const startPolling = useCallback(() => {
    // Clear any existing polling first
    clearPolling();

    // Initial check immediately
    checkProcessingStatus();

    // Set up interval for polling
    pollingIntervalRef.current = setInterval(checkProcessingStatus, POLLING_INTERVAL);
    addDebugLog("Started polling for status updates.");
  }, [clearPolling, checkProcessingStatus, addDebugLog]);

  // Check if processing is already active on component mount
  const checkInitialStatus = useCallback(async () => {
    try {
      const headers = await getAuthHeader();
      const activeUrl = `${import.meta.env.VITE_API_URL}/api/process/active/${directory}`;

      addDebugLog("Checking if processing is already active...");
      const response = await axios.get(activeUrl, { headers });
      const { is_active, status, progress, message } = response.data;

      addDebugLog(`Active check response: ${JSON.stringify(response.data)}`);

      if (is_active) {
        setStatusMessage(message || 'Processing...');
        setProgress(progress || 0);

        if (status === 'completed') {
          setProcessState(PROCESS_STATE.COMPLETED);
          // We'll fetch the heatmap in the useEffect that watches processState
        } else {
          setProcessState(PROCESS_STATE.PROCESSING);
          // Start polling for updates
          startPolling();
        }
      } else {
        // If not active, we're in idle state
        setProcessState(PROCESS_STATE.IDLE);
      }
    } catch (err) {
      console.error('Error checking if processing is active:', err);
      addDebugLog(`Active check error: ${err.response?.data?.detail || err.message}`);
      // Don't set error state here, just continue with idle state
      setProcessState(PROCESS_STATE.IDLE);
    }
  }, [directory, getAuthHeader, startPolling, addDebugLog]);

  // Effect to fetch heatmap when process state changes to COMPLETED
  useEffect(() => {
    if (processState === PROCESS_STATE.COMPLETED && !heatmapUrl && !isFetchingResults && !heatmapFetchAttemptedRef.current) {
      addDebugLog("Process completed, fetching heatmap and analytics...");
      fetchHeatmapAndAnalytics();
    }

    // Stop polling when we're not in PROCESSING state
    if (processState !== PROCESS_STATE.PROCESSING) {
      clearPolling();
    }
  }, [processState, heatmapUrl, isFetchingResults, fetchHeatmapAndAnalytics, clearPolling, addDebugLog]);

  // Main effect for initialization - runs only once
  useEffect(() => {
    if (!directory) {
      setError('No directory specified.');
      return;
    }

    // Initial status check
    checkInitialStatus();

    // Cleanup on unmount
    return () => {
      clearPolling();

      // Clean up object URLs to prevent memory leaks
      if (heatmapUrl) {
        URL.revokeObjectURL(heatmapUrl);
      }
      if (analyticsUrl) {
        URL.revokeObjectURL(analyticsUrl);
      }
    };
  }, [directory, checkInitialStatus, clearPolling, heatmapUrl, analyticsUrl]);

  // Manual refresh handler
  const refreshStatus = () => {
    addDebugLog("Manual status refresh initiated.");
    checkProcessingStatus();
  };

  // Restart processing handler
  const restartProcessing = () => {
    addDebugLog("Restarting processing...");
    initiateProcessing();
  };

  // Start processing handler (for initial start)
  const startProcessing = () => {
    addDebugLog("Starting processing...");
    initiateProcessing();
  };

  // Download analytics handler
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

  // Toggle debug logging
  const toggleDebugLogging = () => {
    setDebugLoggingEnabled(prev => !prev);
    addDebugLog(`Debug logging ${!debugLoggingEnabled ? 'enabled' : 'disabled'}.`);
    if (debugLoggingEnabled) {
      setDebugLogs([]);
    }
  };

  // Determine if we're in a loading state
  const isLoading = isFetchingResults;

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

            {/* Heatmap Display */}
            {heatmapUrl ? (
                <div className="mb-4">
                  <h3 className="text-xl font-semibold mb-2">Generated Heatmap</h3>
                  <img src={heatmapUrl} alt="Heatmap" className="max-w-full h-auto rounded-lg shadow-lg" />
                </div>
            ) : (
                <div className="mb-4 p-4 border rounded-lg bg-blue-50 text-blue-700">
                  <p className="font-semibold">
                    Processing Status: {statusMessage || (processState === PROCESS_STATE.IDLE ? 'Ready to process' : 'Processing...')}
                  </p>

                  {processState === PROCESS_STATE.PROCESSING && (
                      <>
                        <p>Progress: {progress}%</p>
                        <p className="text-sm text-gray-500">Last Updated: {lastUpdated.toLocaleTimeString()}</p>
                        <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                          <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                        </div>
                      </>
                  )}

                  {processState === PROCESS_STATE.COMPLETED && isLoading && (
                      <p className="mt-2">Loading heatmap results...</p>
                  )}

                  {processState === PROCESS_STATE.COMPLETED && !isLoading && !heatmapUrl && (
                      <div className="mt-2">
                        <p className="text-amber-600">Heatmap not found. Please try restarting the process.</p>
                        <Button onClick={fetchHeatmapAndAnalytics} className="mt-2">
                          Retry Loading Heatmap
                        </Button>
                      </div>
                  )}

                  {processState === PROCESS_STATE.IDLE && (
                      <div className="mt-4">
                        <Button onClick={startProcessing}>Start Processing</Button>
                      </div>
                  )}
                </div>
            )}

            {/* Analytics Download */}
            {heatmapUrl && analyticsUrl && (
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

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-4">
              {processState === PROCESS_STATE.PROCESSING && (
                  <Button onClick={refreshStatus} variant="outline">
                    Refresh Status
                  </Button>
              )}

              {(processState === PROCESS_STATE.COMPLETED || processState === PROCESS_STATE.ERROR) && (
                  <Button onClick={restartProcessing} variant="outline">
                    Restart Processing
                  </Button>
              )}

              <Button onClick={toggleDebugLogging} variant="outline" className="ml-auto">
                {debugLoggingEnabled ? 'Disable Debug Logs' : 'Enable Debug Logs'}
              </Button>
            </div>

            {/* Debug Logs */}
            {debugLoggingEnabled && debugLogs.length > 0 && (
                <div className="mt-8 p-4 border rounded-lg bg-gray-50">
                  <h3 className="text-lg font-semibold mb-2">Debug Logs</h3>
                  <div className="max-h-60 overflow-y-auto text-xs font-mono">
                    {debugLogs.map((log, index) => (
                        <div key={index} className="py-1 border-b border-gray-200">
                          {log}
                        </div>
                    ))}
                  </div>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
