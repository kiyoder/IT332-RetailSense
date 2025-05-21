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

// Debounce function to prevent rapid-fire API calls
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

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
  const [filesVerified, setFilesVerified] = useState(false);

  // Fetching state - separate from process state
  const [isFetchingResults, setIsFetchingResults] = useState(false);

  // Debug state (optional, can be removed if not needed)
  const [debugLogs, setDebugLogs] = useState([]);
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(true);

  // Polling interval in ms
  const POLLING_INTERVAL = 2000;
  // Debounce delay in ms
  const DEBOUNCE_DELAY = 500;

  // Use a ref to track the polling interval
  const pollingIntervalRef = useRef(null);

  // Flag to track if we've already tried to fetch the heatmap
  const heatmapFetchAttemptedRef = useRef(false);

  // Flag to track if polling has been stopped due to completion
  const pollingStoppedRef = useRef(false);

  // Flag to track if files have been verified successfully
  const filesVerifiedRef = useRef(false);

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

      // Mark polling as stopped
      pollingStoppedRef.current = true;
    }
  }, [addDebugLog]);

  // Verify both files exist
  const verifyFiles = useCallback(async () => {
    // Skip verification if already verified successfully
    if (filesVerifiedRef.current) {
      addDebugLog("Files already verified, skipping verification");
      return true;
    }

    try {
      const headers = await getAuthHeader();

      // Check if both files exist
      const heatmapPromise = axios.head(
          `${import.meta.env.VITE_API_URL}/files/${directory}/heatmap.png`,
          { headers }
      );

      const analyticsPromise = axios.head(
          `${import.meta.env.VITE_API_URL}/files/${directory}/hourly_counts.csv`,
          { headers }
      );

      // Wait for both checks to complete
      const results = await Promise.allSettled([heatmapPromise, analyticsPromise]);

      // Check if both files exist
      const heatmapExists = results[0].status === 'fulfilled';
      const analyticsExists = results[1].status === 'fulfilled';

      if (heatmapExists && analyticsExists) {
        addDebugLog("Both files verified to exist");
        setFilesVerified(true);
        filesVerifiedRef.current = true;

        // Stop polling immediately when files are verified
        clearPolling();
        pollingStoppedRef.current = true;
        addDebugLog("Files verified - permanently stopping all polling");

        return true;
      } else {
        // Set appropriate error message
        if (!heatmapExists && !analyticsExists) {
          setError('Both heatmap and analytics files are missing.');
        } else if (!heatmapExists) {
          setError('Heatmap file is missing.');
        } else {
          setError('Analytics file is missing.');
        }
        addDebugLog(`File verification failed: ${!heatmapExists ? 'Heatmap missing' : ''} ${!analyticsExists ? 'Analytics missing' : ''}`);
        setFilesVerified(false);
        filesVerifiedRef.current = false;
        return false;
      }
    } catch (err) {
      console.error('Error verifying files:', err);
      setError('Failed to verify required files.');
      addDebugLog(`Error verifying files: ${err.message}`);
      setFilesVerified(false);
      filesVerifiedRef.current = false;
      return false;
    }
  }, [directory, getAuthHeader, addDebugLog, clearPolling]);

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
      // First verify both files exist
      const filesExist = await verifyFiles();

      if (!filesExist) {
        throw new Error('Required files are missing');
      }

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
          {
            headers,
            responseType: 'blob'
          }
      );

      // Create URL from blob with proper MIME type
      const analyticsBlob = new Blob([analyticsResponse.data], { type: 'text/csv' });
      setAnalyticsUrl(URL.createObjectURL(analyticsBlob));
      addDebugLog("Analytics data fetched successfully.");

      // Make sure polling is stopped
      clearPolling();
    } catch (err) {
      console.error('Error fetching heatmap or analytics:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to load heatmap or analytics.');
      addDebugLog(`Error fetching heatmap/analytics: ${err.response?.data?.detail || err.message}`);

      // Reset the flag so we can try again
      heatmapFetchAttemptedRef.current = false;
    } finally {
      setIsFetchingResults(false);
    }
  }, [directory, getAuthHeader, heatmapUrl, isFetchingResults, clearPolling, addDebugLog, verifyFiles]);

  // Unified function to check processing status - using the consolidated endpoint
  const checkProcessingStatus = useCallback(async () => {
    // Don't check if polling has been stopped due to completion
    if (pollingStoppedRef.current) {
      addDebugLog("Skipping status check - polling has been stopped");
      return;
    }

    // Don't check if we're already in completed state and files are verified
    if (processState === PROCESS_STATE.COMPLETED && filesVerifiedRef.current) {
      addDebugLog("Stopping polling - process is completed and files are verified");
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
        // Verify both files exist before setting completed state
        const filesExist = await verifyFiles();

        if (filesExist) {
          setProcessState(PROCESS_STATE.COMPLETED);

          // Stop polling immediately and permanently
          clearPolling();
          pollingStoppedRef.current = true;
          addDebugLog("Process completed and files verified - permanently stopping all polling");

          // Fetch results if we don't have them yet and haven't attempted
          if (!heatmapUrl && !isFetchingResults && !heatmapFetchAttemptedRef.current) {
            fetchHeatmapAndAnalytics();
          }
        } else {
          // Backend says completed but files are missing
          setProcessState(PROCESS_STATE.ERROR);
          setError('Processing completed but required files are missing.');
          clearPolling();
        }
      } else if (data.status === 'processing' || data.status === 'pending' || data.status === 'waiting') {
        setProcessState(PROCESS_STATE.PROCESSING);
      } else if (data.status === 'error') {
        setProcessState(PROCESS_STATE.ERROR);
        setError(data.message || 'An error occurred during processing.');
        clearPolling();
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
  }, [directory, getAuthHeader, processState, heatmapUrl, isFetchingResults, clearPolling, fetchHeatmapAndAnalytics, addDebugLog, verifyFiles]);

  // Create a debounced version of the status check function
  const debouncedCheckStatus = useCallback(
      debounce((force = false) => {
        // Skip if polling has been stopped, unless forced
        if (pollingStoppedRef.current && !force) {
          return;
        }
        checkProcessingStatus();
      }, DEBOUNCE_DELAY),
      [checkProcessingStatus, DEBOUNCE_DELAY]
  );

  // Function to initiate processing
  const initiateProcessing = useCallback(async () => {
    try {
      // Clear any existing polling
      clearPolling();

      // Reset polling stopped flag
      pollingStoppedRef.current = false;
      filesVerifiedRef.current = false;

      // Reset state
      setProcessState(PROCESS_STATE.PROCESSING);
      setProgress(0);
      setStatusMessage('Initiating processing...');
      setHeatmapUrl(null);
      setAnalyticsUrl(null);
      setFilesVerified(false);
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
    // Don't start polling if it's been stopped due to completion
    if (pollingStoppedRef.current) {
      addDebugLog("Not starting polling - polling has been permanently stopped");
      return;
    }

    // Clear any existing polling first
    clearPolling();

    // Reset the polling stopped flag
    pollingStoppedRef.current = false;

    // Initial check immediately
    checkProcessingStatus();

    // Set up interval for polling
    pollingIntervalRef.current = setInterval(() => {
      // Only continue polling if not stopped and files not verified
      if (!pollingStoppedRef.current && !filesVerifiedRef.current) {
        debouncedCheckStatus();
      } else {
        // If polling has been stopped or files verified, clear the interval
        clearPolling();
      }
    }, POLLING_INTERVAL);

    addDebugLog("Started polling for status updates.");
  }, [clearPolling, checkProcessingStatus, debouncedCheckStatus, addDebugLog]);

  // Check initial status on component mount - using the consolidated endpoint
  const checkInitialStatus = useCallback(async () => {
    try {
      const headers = await getAuthHeader();
      const statusUrl = `${import.meta.env.VITE_API_URL}/api/process/status/${directory}`;

      addDebugLog("Checking initial status...");
      const response = await axios.get(statusUrl, { headers });
      const { is_active, status, progress, message } = response.data;

      addDebugLog(`Initial status response: ${JSON.stringify(response.data)}`);

      setStatusMessage(message || 'Processing...');
      setProgress(progress || 0);

      if (status === 'completed') {
        // Verify both files exist before setting completed state
        const filesExist = await verifyFiles();

        if (filesExist) {
          setProcessState(PROCESS_STATE.COMPLETED);
          // Mark polling as permanently stopped
          pollingStoppedRef.current = true;
          addDebugLog("Initial status is completed and files verified - permanently stopping all polling");
          // We'll fetch the heatmap in the useEffect that watches processState
        } else {
          // Backend says completed but files are missing
          setProcessState(PROCESS_STATE.ERROR);
          setError('Processing marked as completed but required files are missing.');
        }
      } else if (status === 'processing' || status === 'pending' || status === 'waiting') {
        setProcessState(PROCESS_STATE.PROCESSING);
        // Start polling for updates if processing is active
        if (is_active) {
          startPolling();
        }
      } else if (status === 'error') {
        setProcessState(PROCESS_STATE.ERROR);
        setError(message || 'An error occurred during processing.');
      } else {
        // If not active, we're in idle state
        setProcessState(PROCESS_STATE.IDLE);
      }
    } catch (err) {
      console.error('Error checking initial status:', err);
      addDebugLog(`Initial status check error: ${err.response?.data?.detail || err.message}`);
      // Don't set error state here, just continue with idle state
      setProcessState(PROCESS_STATE.IDLE);
    }
  }, [directory, getAuthHeader, startPolling, addDebugLog, verifyFiles]);

  // Effect to fetch heatmap when process state changes to COMPLETED
  useEffect(() => {
    if (processState === PROCESS_STATE.COMPLETED) {
      // Always ensure polling is stopped when state is COMPLETED
      clearPolling();
      pollingStoppedRef.current = true;
      addDebugLog("Process state changed to COMPLETED - permanently stopping all polling");

      // Fetch heatmap if needed
      if (!heatmapUrl && !isFetchingResults && !heatmapFetchAttemptedRef.current) {
        addDebugLog("Process completed, fetching heatmap and analytics...");
        fetchHeatmapAndAnalytics();
      }
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
    debouncedCheckStatus(true); // Force check even if polling is stopped
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
      try {
        addDebugLog("Analytics download initiated.");

        // Create a direct download link with proper attributes
        const link = document.createElement('a');
        link.href = analyticsUrl;
        link.setAttribute('download', `analytics_${directory}.csv`);
        link.setAttribute('type', 'text/csv');

        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();

        // Small timeout before removing to ensure download starts
        setTimeout(() => {
          document.body.removeChild(link);
        }, 100);
      } catch (err) {
        console.error('Error downloading analytics:', err);
        setError(`Download failed: ${err.message}`);
        addDebugLog(`Analytics download error: ${err.message}`);
      }
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
            {heatmapUrl && filesVerified ? (
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
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-4">
              {/* Download Analytics Button - Only show if analytics URL is available */}
              {analyticsUrl && filesVerified && (
                  <Button onClick={downloadAnalytics} className="bg-green-600 hover:bg-green-700">
                    Download Analytics Data
                  </Button>
              )}

              {/* Process/Restart Button */}
              {processState === PROCESS_STATE.IDLE ? (
                  <Button onClick={startProcessing} className="bg-blue-600 hover:bg-blue-700">
                    Start Processing
                  </Button>
              ) : processState === PROCESS_STATE.ERROR || processState === PROCESS_STATE.COMPLETED ? (
                  <Button onClick={restartProcessing} className="bg-yellow-600 hover:bg-yellow-700">
                    Restart Processing
                  </Button>
              ) : null}

              {/* Refresh Status Button - Only show during processing */}
              {processState === PROCESS_STATE.PROCESSING && (
                  <Button onClick={refreshStatus} className="bg-gray-600 hover:bg-gray-700">
                    Refresh Status
                  </Button>
              )}

              {/* Debug Toggle Button */}
              <Button
                  onClick={toggleDebugLogging}
                  className="bg-purple-600 hover:bg-purple-700"
              >
                {debugLoggingEnabled ? 'Disable Debug Logs' : 'Enable Debug Logs'}
              </Button>
            </div>

            {/* Debug Logs */}
            {debugLoggingEnabled && debugLogs.length > 0 && (
                <div className="mt-8 p-4 border rounded bg-gray-50">
                  <h3 className="text-lg font-semibold mb-2">Debug Logs</h3>
                  <div className="max-h-60 overflow-y-auto text-xs font-mono">
                    {debugLogs.map((log, index) => (
                        <div key={index} className="mb-1">{log}</div>
                    ))}
                  </div>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
