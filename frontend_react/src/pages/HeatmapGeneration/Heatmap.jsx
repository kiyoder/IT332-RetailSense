import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui";
import { useAuth } from "@/AuthContext.jsx";
import axios from 'axios';

export default function HeatmapPage() {
  const { directory } = useParams();
  const { getSession } = useAuth();

  // State management
  const [currentView, setCurrentView] = useState('initializing'); // 'initializing', 'processing', 'results_loading', 'results', 'error'
  const [progress, setProgress] = useState(0);
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [analyticsUrl, setAnalyticsUrl] = useState(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState(currentView === 'initializing' ? 'Initializing...' : ''); // Initialize status message
  const [lastUpdated, setLastUpdated] = useState(new Date()); // Keep for display
  const [debugLogs, setDebugLogs] = useState([]);
  const debugLoggingEnabledRef = useRef(true); // Control debug logging verbosity

  // ---- Race Condition Guards ----
  const processingCompletedRef = useRef(false); // Guard for completed polling
  const pollingIntervalRef = useRef(null);
  // Only allow one pollStatus() at a time
  const isPollingRef = useRef(false); // Renamed from isFetchingRef for clarity
  // Store the last progress value to prevent resetting to 0
  const lastProgressRef = useRef(0);
  // Flag to prevent multiple initializations triggered by useEffect
  const isInitializingEffectRunningRef = useRef(false); // Renamed and refined
  const prevDirectoryRef = useRef(null); // Track previous directory

  // Polling interval in ms
  const POLLING_INTERVAL = 2000;
  const INITIAL_LOAD_DELAY = 3000; // 3 seconds delay on initial load/directory change

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
      setCurrentView('error'); // Set view to error if auth fails
      // Do NOT throw here, let the caller handle the absence of headers
      addDebugLog("Authentication required. Cannot get auth header.");
      return null; // Return null or undefined to indicate failure
    }
    return { Authorization: `Bearer ${session.access_token}` };
  };

  // Fetch heatmap and analytics data once processing is complete
  const fetchHeatmapAndAnalytics = async () => {
    addDebugLog("Fetching heatmap and analytics data...");
    setCurrentView('results_loading'); // Ensure view is set correctly before fetch
    try {
      const headers = await getAuthHeader();
      if (!headers) {
          addDebugLog("Aborting fetchHeatmapAndAnalytics: No auth headers.");
          setCurrentView('error');
          setError('Authentication failed.');
          return;
      }

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

      setCurrentView('results'); // Transition to results view on success
    } catch (err) {
      console.error('Error fetching heatmap or analytics:', err);
      const errorMsg = err.response?.data?.detail || 'Failed to load heatmap or analytics.';
      setError(errorMsg);
      setCurrentView('error'); // Transition to error view on failure
      addDebugLog(`Error fetching heatmap/analytics: ${errorMsg}`);
    }
  };

  // Effect for initial status check and polling (race-free)
  useEffect(() => {
    if (!directory) {
      setError('No directory specified.');
      setCurrentView('error');
      isInitializingEffectRunningRef.current = false; // Ensure flag is reset if we exit early
      return; // Exit early if no directory
    }

    const directoryHasChanged = prevDirectoryRef.current !== directory;

    // If directory has changed, perform a full reset.
    if (directoryHasChanged) {
      addDebugLog(`useEffect: Directory changed from ${prevDirectoryRef.current} to ${directory}. Performing full reset.`);
      setCurrentView('initializing'); // Ensure view is set for new initialization
      setHeatmapUrl(null);
      setAnalyticsUrl(null);
      setError('');
      setProgress(0);
      setStatusMessage('Initializing for new directory...'); // Or a generic 'Initializing...'
      processingCompletedRef.current = false;
      isPollingRef.current = false;
      lastProgressRef.current = 0;
      prevDirectoryRef.current = directory; // Update prevDirectoryRef *after* reset logic for the new directory

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        addDebugLog("Cleared existing polling interval due to directory change.");
      }
      // Proceed to initializeAndPoll for the new directory
    } else {
      // Directory is the same. useEffect re-ran.
      // If already completed and results are shown, do nothing more.
      if (processingCompletedRef.current && heatmapUrl && analyticsUrl) {
        addDebugLog("useEffect: Same directory, completed and results shown. No action.");
        if(currentView !== 'results') setCurrentView('results'); // Ensure view is correct
        return;
      }
      // If an initialization/polling is already in progress for this directory, don't start another one.
      if (isInitializingEffectRunningRef.current) {
        addDebugLog("useEffect: Same directory, initialization/polling already in progress. Skipping duplicate start.");
        return;
      }
    }

    isInitializingEffectRunningRef.current = true; // Set flag at the start of initialization
    addDebugLog("useEffect: Starting initial status check and polling setup.");

    const initializeAndPoll = async () => {
      try {
        // Guard: If processing is completed and results are already loaded, do nothing further.
        if (processingCompletedRef.current && heatmapUrl && analyticsUrl) {
          addDebugLog("initializeAndPoll: Processing completed and results loaded. Exiting.");
          setCurrentView('results'); // Ensure correct view
          isInitializingEffectRunningRef.current = false; // Initialization is effectively "done" for this state
          return;
        }

        // Ensure status message is appropriate if we are in initializing view and it wasn't set by directory change
        if (currentView === 'initializing' && statusMessage !== 'Initializing for new directory...' && statusMessage !== 'Initializing...') {
            setStatusMessage('Initializing...');
        }

        addDebugLog("initializeAndPoll: Starting initial check/setup.");

        // Introduce a delay before the first API call
        addDebugLog(`initializeAndPoll: Delaying for ${INITIAL_LOAD_DELAY}ms before first API call.`);
        await new Promise(resolve => setTimeout(resolve, INITIAL_LOAD_DELAY));

        const headers = await getAuthHeader(); // This might return null if auth fails
        if (!headers) {
            addDebugLog("Aborting initializeAndPoll: No auth headers.");
            // getAuthHeader already set error view
            return; // Stop the process if auth failed
        }

        // 1. Check if processing is already active
        addDebugLog("initializeAndPoll: Checking active status...");
        // Use a timeout for this initial check to avoid getting stuck
        const activeResponse = await axios.get(`${import.meta.env.VITE_API_URL}/api/process/active/${directory}`, { headers, timeout: 5000 }); // 5s timeout
        const activeData = activeResponse.data;
        addDebugLog(`initializeAndPoll: Active status response: ${JSON.stringify(activeData)}`);
        setLastUpdated(new Date()); // Update last updated time

        // Update status/progress based on active check
        setStatusMessage(activeData.message || 'Checking status...');
        const initialProgress = activeData.progress || 0;
        setProgress(initialProgress);
        lastProgressRef.current = initialProgress;

        if (activeData.status === 'completed') {
          addDebugLog("initializeAndPoll: Already completed. Fetching results.");
          processingCompletedRef.current = true;
          // Transition to results_loading *before* fetching
          setCurrentView('results_loading');
          fetchHeatmapAndAnalytics();
          return; // No polling needed
        }

        if (activeData.is_active) {
          addDebugLog("initializeAndPoll: Processing is active. Starting polling.");
          // Transition to processing view
          setCurrentView('processing');
          // Start polling
          pollingIntervalRef.current = setInterval(pollStatus, POLLING_INTERVAL);
          return;
        }

        // 2. If not active, initiate processing (POST)
        addDebugLog("initializeAndPoll: Not active. Initiating processing (POST)...");
        // Transition to processing view *before* POST
        setCurrentView('processing');
        setStatusMessage('Initiating processing...');
        setProgress(0); // Reset progress for a new start

        const postResponse = await axios.post(`${import.meta.env.VITE_API_URL}/api/process/${directory}`, {}, { headers });
        const postData = postResponse.data;
        addDebugLog(`initializeAndPoll: POST response: ${JSON.stringify(postData)}`);
        setLastUpdated(new Date()); // Update last updated time

        // Update status/progress based on POST response
        setStatusMessage(postData.message || 'Processing initiated...');
        const postProgress = postData.progress || 0;
        setProgress(postProgress);
        lastProgressRef.current = postProgress;

        if (postData.status === 'completed') {
          addDebugLog("initializeAndPoll: Completed immediately after POST. Fetching results.");
          processingCompletedRef.current = true;
          // Transition to results_loading *before* fetching
          setCurrentView('results_loading');
          fetchHeatmapAndAnalytics();
        } else if (postData.status === 'error') {
          setError(postData.message || 'Failed to start processing.');
          setCurrentView('error');
        } else { // 'processing', 'pending', 'initializing', etc.
          // Ensure we are in processing view and start polling
          setCurrentView('processing');
          pollingIntervalRef.current = setInterval(pollStatus, POLLING_INTERVAL);
        }

      } catch (err) {
        console.error('Error during initialization or POST:', err);
        const errorMsg = err.response?.data?.detail || err.message || 'Failed to initialize processing.';
        setError(errorMsg);
        setCurrentView('error'); // Ensure view is error on any init/post failure
        addDebugLog(`initializeAndPoll: Error - ${errorMsg}`);
      } finally {
          isInitializingEffectRunningRef.current = false; // Reset flag after initialization attempt
      }
    };

    initializeAndPoll();

    // Cleanup on unmount
    return () => {
      addDebugLog("useEffect cleanup: Clearing polling interval.");
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      // isInitializingEffectRunningRef.current is reset in the finally block of initializeAndPoll.
      // If the effect cleans up before initializeAndPoll completes (e.g., unmount),
      // this ensures the flag is reset for any potential future re-renders if the component remounts.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, getSession]); // Depend on directory and getSession

  const pollStatus = async () => {
    if (processingCompletedRef.current || isPollingRef.current) {
      addDebugLog(`pollStatus: Skipped (completed=${processingCompletedRef.current}, polling=${isPollingRef.current})`);
      return;
    }

    isPollingRef.current = true; // Set polling flag
    addDebugLog("pollStatus: Starting status poll...");

    try {
      const headers = await getAuthHeader();
       if (!headers) {
          addDebugLog("Aborting pollStatus: No auth headers.");
          // getAuthHeader already set error view
          return; // Stop polling if auth failed
      }
      const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/process/status/${directory}`, { headers });
      const data = response.data;
      addDebugLog(`pollStatus: GET status response: ${JSON.stringify(data)}`);

      setStatusMessage(data.message || 'Fetching status...');
      setLastUpdated(new Date());

      const newProgress = data.progress || 0;
      // Allow progress update if it's greater or if an error occurs (to show 0% for error)
      // or if it's the same (e.g. stuck at a certain percentage but message changes)
      if (newProgress >= lastProgressRef.current || data.status === 'error') {
        setProgress(newProgress);
        lastProgressRef.current = newProgress;
      } else {
        addDebugLog(`pollStatus: Progress ${newProgress} ignored as it's less than last known ${lastProgressRef.current}`);
      }

      if (data.status === 'completed') {
        addDebugLog("pollStatus: Processing completed. Stopping polling, fetching results.");
        processingCompletedRef.current = true;
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        setCurrentView('results_loading'); // Trigger re-render, useEffect/initializeAndPoll will handle fetching results
        // fetchHeatmapAndAnalytics(); // DO NOT CALL DIRECTLY - let useEffect handle it
      } else if (data.status === 'error') {
        addDebugLog(`pollStatus: Processing error - ${data.message}`);
        setError(data.message || 'Processing failed.');
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        setCurrentView('error'); // Transition to error view
      } else { // 'processing', 'pending', 'initializing', etc.
        // Ensure we are in the processing view if the backend says so
        setCurrentView('processing');
      }
    } catch (err) {
      console.error('Error polling status:', err);
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to poll status.';
      // Don't set main error for transient polling failures. Log it.
      addDebugLog(`pollStatus: Network or server error - ${errorMsg}`);
      // Optionally, if specific errors (e.g., 403, 404 on status) should stop polling:
      // if (err.response?.status === 403 || err.response?.status === 404) {
      //   setError(errorMsg); setCurrentView('error');
      //   if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      // }
    } finally {
      isPollingRef.current = false; // Reset polling flag
    }
  };

  const refreshStatus = () => {
    addDebugLog("Manual status refresh initiated.");
    // Only allow manual refresh if not already polling or initializing
    if (!isPollingRef.current && !isInitializingEffectRunningRef.current) {
        pollStatus(); // Re-use the polling logic for a manual refresh
    } else {
        addDebugLog("Manual refresh skipped: Already polling or initializing.");
    }
  };

  const restartProcessing = async () => {
    addDebugLog("Restarting processing...");
    // Prevent restart if initialization is already running
     if (isInitializingEffectRunningRef.current) {
        addDebugLog("Restart skipped: Initialization already in progress.");
        return;
    }

    // Set initializing flag for the restart process
    isInitializingEffectRunningRef.current = true;

    // Reset relevant states and refs
    setCurrentView('processing'); // Assume we will be processing after restart
    setProgress(0);
    setHeatmapUrl(null);
    setAnalyticsUrl(null);
    setError('');
    setStatusMessage('Restarting processing...');
    processingCompletedRef.current = false;
    isPollingRef.current = false; // Ensure polling is off during restart
    lastProgressRef.current = 0; // Reset progress for restart

    // Clear existing polling if any
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    try {
      const headers = await getAuthHeader();
       if (!headers) {
          addDebugLog("Aborting restartProcessing: No auth headers.");
          // getAuthHeader already set error view
          return; // Stop the process if auth failed
      }
      const processUrl = `${import.meta.env.VITE_API_URL}/api/process/${directory}`;
      addDebugLog(`POST /api/process/${directory} for restart initiated.`);
      setStatusMessage('Sending restart request...'); // Immediate feedback
      const response = await axios.post(processUrl, {}, { headers });
      addDebugLog(`Restart Processing API call response: ${JSON.stringify(response.data)}`);

      const data = response.data;
      setStatusMessage(data.message || 'Processing restarted...');
      const restartProgress = data.progress || 0;
      setProgress(restartProgress);
      lastProgressRef.current = restartProgress;

      if (data.status === 'completed') {
        processingCompletedRef.current = true;
        setCurrentView('results_loading');
        fetchHeatmapAndAnalytics();
      } else if (data.status === 'error') {
        setError(data.message || 'Failed to restart processing.');
        setCurrentView('error');
      } else {
        // Ensure we are in processing view and start polling
        setCurrentView('processing');
        pollingIntervalRef.current = setInterval(pollStatus, POLLING_INTERVAL);
      }
    } catch (err) {
      console.error('Error restarting processing:', err);
      setError(err.response?.data?.detail || 'Failed to restart processing.');
      setCurrentView('error'); // Ensure view is error on restart failure
      addDebugLog(`Restart processing API error: ${err.response?.data?.detail || err.message}`);
    } finally { isInitializingEffectRunningRef.current = false; } // Reset flag after restart attempt
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
    }
  };

  const toggleDebugLogging = () => {
    debugLoggingEnabledRef.current = !debugLoggingEnabledRef.current;
    addDebugLog(`Debug logging ${debugLoggingEnabledRef.current ? 'enabled' : 'disabled'}.`);
    if (!debugLoggingEnabledRef.current) {
      setDebugLogs([]);
    }
  };

  const renderContent = () => {
    if (currentView === 'error') {
      return <div className="text-red-500 mb-4 p-4 border border-red-300 bg-red-50 rounded-lg">{error || 'An unknown error occurred.'}</div>;
    }

    // Show processing info if we are initializing, processing, loading results,
    // or in results view but assets are not yet loaded.
    const showProcessingInfo = currentView === 'initializing' || currentView === 'processing' || currentView === 'results_loading' || (currentView === 'results' && (!heatmapUrl || !analyticsUrl));

    return (
      <div>
        {showProcessingInfo && (
            <div className="mb-4 p-4 border rounded-lg bg-blue-50 text-blue-700">
              <p className="font-semibold">Status: {statusMessage}</p>
              <p>Progress: {Math.max(0, progress)}%</p> {/* Ensure progress is not negative */}
              <p className="text-sm text-gray-500">Last Updated: {lastUpdated.toLocaleTimeString()}</p>
              {(currentView === 'processing' || currentView === 'initializing') && progress < 100 && ( // Show progress bar in initializing too
                  <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full"
                      style={{
                        width: `${Math.max(0, progress)}%`, // Ensure width is not negative
                        transition: 'width 0.3s ease-in-out' // Smoother transition for width changes
                      }}></div>
                  </div>
              )}
              {currentView === 'results_loading' && (
                  <p className="mt-2 text-green-600">Processing completed. Fetching results...</p>
              )}
            </div>
        )}

        {currentView === 'results' && heatmapUrl && (
            <div className="mb-4">
              <h3 className="text-xl font-semibold mb-2">Generated Heatmap</h3>
              <img src={heatmapUrl} alt="Heatmap" className="max-w-full h-auto rounded-lg shadow-lg" />
            </div>
        )}

        {currentView === 'results' && analyticsUrl && (
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
      </div>
    );
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
            {renderContent()}
            {/* Action Buttons - outside renderContent if always visible, or inside if view-dependent */}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button onClick={refreshStatus} variant="outline" disabled={currentView === 'initializing' || processingCompletedRef.current || isPollingRef.current || isInitializingEffectRunningRef.current}>
                Refresh Status
              </Button>
              <Button onClick={restartProcessing} variant="outline" disabled={isInitializingEffectRunningRef.current}>
                Restart Processing
              </Button>
              <Button onClick={toggleDebugLogging} variant="outline" className="ml-auto">
                {debugLoggingEnabledRef.current ? 'Disable Debug Logs' : 'Enable Debug Logs'}
              </Button>
            </div>

            {/* Debug Logs */}
            {debugLoggingEnabledRef.current && debugLogs.length > 0 && (
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
