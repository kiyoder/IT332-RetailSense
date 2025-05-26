import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui";
import { useAuth } from "@/AuthContext.jsx";
import axios from 'axios';
import { Activity, Download, RefreshCw, Play, Bug, AlertCircle, BarChart2 } from 'lucide-react';

export default function HeatmapPage() {
  const { directory } = useParams();
  const { getSession } = useAuth();

  // State management
  const [currentView, setCurrentView] = useState('initializing'); // 'initializing', 'processing', 'results_loading', 'results', 'error'
  const [progress, setProgress] = useState(0);
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [analyticsUrl, setAnalyticsUrl] = useState(null);
  const [error, setError] = useState('');
  const [zoneActivity, setZoneActivity] = useState(null); // To store zone_activity.json
  const [floorplanLayout, setFloorplanLayout] = useState(null); // To store floorplan_layout.json (zone definitions)
  const imageRef = useRef(null); // For getting displayed image dimensions for SVG overlay
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
    let overallSuccess = false; 
    let localHeatmapObjectUrl = null; 
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
      addDebugLog(`Heatmap fetch status: ${heatmapResponse.status}. Content-Type: ${heatmapResponse.headers['content-type']}. Size: ${heatmapResponse.data?.size}`);

      if (heatmapResponse.data && heatmapResponse.data.size > 0 && heatmapResponse.data.type.startsWith('image/')) {
        const objectURLForHeatmap = URL.createObjectURL(heatmapResponse.data);
        if (objectURLForHeatmap) {
          localHeatmapObjectUrl = objectURLForHeatmap;
          setHeatmapUrl(objectURLForHeatmap);
          addDebugLog("Heatmap object URL created and set successfully.");
        } else {
          addDebugLog("URL.createObjectURL for heatmap returned null/falsy. The fetched data might be invalid.");
          throw new Error("Failed to create a displayable URL for the heatmap image. The image data might be corrupted or invalid.");
        }
      } else {
        addDebugLog(`Heatmap data is invalid or empty. Size: ${heatmapResponse.data?.size}, Type: ${heatmapResponse.data?.type}`);
        throw new Error("Received invalid or empty data for the heatmap image from the server.");
      }
      const analyticsResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/files/${directory}/hourly_counts.csv`,
          { headers }
      );
      // For CSV, we can just set the URL to trigger download, or process its content
      const analyticsBlob = new Blob([analyticsResponse.data], { type: 'text/csv' });
      setAnalyticsUrl(URL.createObjectURL(analyticsBlob));
      addDebugLog("Analytics data fetched successfully.");

      // Fetch zone activity data (from video-specific directory)
      try {
        const zoneActivityResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/files/${directory}/zone_activity.json`,
          { headers }
        );
        setZoneActivity(zoneActivityResponse.data);
        addDebugLog("Zone activity data fetched successfully.");
      } catch (zoneErr) {
        console.warn("Could not fetch zone activity data:", zoneErr.message);
        setZoneActivity({}); // Set to empty if not found, so UI can handle it
        addDebugLog(`Warning: Zone activity data not found or error: ${zoneErr.message}`);
      }

      // Fetch floorplan layout (for zone definitions, from user's central assets)
      // User ID is the first part of the directory string (e.g., "userid_timestamp")
      const userIdForLayout = directory.split('_')[0];
      try {
        const floorplanLayoutResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/api/floorplan/${userIdForLayout}`,
          { headers }
        );
        setFloorplanLayout(floorplanLayoutResponse.data);
        addDebugLog("Floorplan layout (for zones) fetched successfully.");
      } catch (layoutErr) {
        console.warn("Could not fetch floorplan layout:", layoutErr.message);
        setFloorplanLayout({ zones: [], aisles: [] }); // Set to empty if not found
        addDebugLog(`Warning: Floorplan layout not found or error: ${layoutErr.message}`);
      }

      overallSuccess = true; 

    } catch (err) {
      console.error('Error fetching heatmap or analytics:', err);
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to load heatmap or analytics.';
      setError(errorMsg);
      addDebugLog(`Error fetching heatmap/analytics: ${errorMsg}`);
    }
    finally {
      if (overallSuccess && localHeatmapObjectUrl) { 
        setCurrentView('results');
      } else if (!overallSuccess) { 
        setCurrentView('error'); // Ensure it's error if not already set
      } else if (overallSuccess && !localHeatmapObjectUrl) {
        addDebugLog("Overall fetch sequence completed, but heatmap object URL was not generated. Setting view to error.");
        setError("Processing completed, but the heatmap image could not be loaded or was invalid (local URL generation failed).");
        setCurrentView('error');
      }
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
      setZoneActivity(null);
      setFloorplanLayout(null);
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
      if (processingCompletedRef.current && heatmapUrl /* && analyticsUrl - other results can be optional for just showing heatmap */) {
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
            isInitializingEffectRunningRef.current = false; // Reset flag
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
          // setCurrentView('results_loading'); // fetchHeatmapAndAnalytics will set this
          fetchHeatmapAndAnalytics();
          isInitializingEffectRunningRef.current = false; // Reset flag
          return; // No polling needed
        }

        if (activeData.is_active) {
          addDebugLog("initializeAndPoll: Processing is active. Starting polling.");
          // Transition to processing view
          setCurrentView('processing');
          // Start polling
          pollingIntervalRef.current = setInterval(pollStatus, POLLING_INTERVAL);
          isInitializingEffectRunningRef.current = false; // Reset flag
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
          // setCurrentView('results_loading'); // fetchHeatmapAndAnalytics will set this
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
      // No, we should reset it here too, in case initializeAndPoll never reaches its finally block due to early return.
      isInitializingEffectRunningRef.current = false;
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
          isPollingRef.current = false; // Reset polling flag
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
        // setCurrentView('results_loading'); // fetchHeatmapAndAnalytics will set this
        fetchHeatmapAndAnalytics(); // Call directly now that polling is stopped
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
    setAnalyticsUrl(null); // Also reset analytics and zone data
    setZoneActivity(null);
    // setAnalyticsUrl(null); // Already set above
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
          isInitializingEffectRunningRef.current = false; // Reset flag
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
        // setCurrentView('results_loading'); // fetchHeatmapAndAnalytics will set this
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
      return (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 rounded-lg flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <div>
            <h3 className="text-red-800 font-medium">Error</h3>
            <p className="text-red-600">{error || 'An unknown error occurred.'}</p>
          </div>
        </div>
      );
    }

    const showProcessingInfo = currentView === 'initializing' || currentView === 'processing' || currentView === 'results_loading' || (currentView === 'results' && (!heatmapUrl));

    return (
      <div className="space-y-6">
        {showProcessingInfo && (
          <div className="p-6 border rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-1">
                <h3 className="font-semibold text-blue-900">Processing Status</h3>
                <p className="text-blue-700">{statusMessage}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-blue-900">{Math.max(0, progress)}%</p>
                <p className="text-sm text-blue-600">Last Updated: {lastUpdated.toLocaleString()}</p>
              </div>
            </div>
            
            {(currentView === 'processing' || currentView === 'initializing') && progress < 100 && (
              <div className="w-full bg-blue-100 rounded-full h-2.5">
                <div
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(0, progress)}%` }}
                />
              </div>
            )}
            
            {currentView === 'results_loading' && (
              <div className="mt-4 flex items-center space-x-2 text-green-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                <span>Processing completed. Fetching results...</span>
              </div>
            )}
          </div>
        )}

        {currentView === 'results' && heatmapUrl && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gray-900">Generated Heatmap</h3>
              <div className="text-sm text-gray-500">Click to view full size</div>
            </div>
            <div className="relative group">
              <img 
                ref={imageRef} 
                src={heatmapUrl} 
                alt="Heatmap" 
                className="w-full h-auto rounded-xl shadow-lg transition-transform duration-200 group-hover:scale-[1.02]" 
                onLoad={() => setLastUpdated(new Date())}
                onError={() => {
                  addDebugLog(`Heatmap image failed to load. URL: ${heatmapUrl}`);
                  setError("Failed to load the generated heatmap image. It might be corrupted or missing on the server.");
                }}
              />
              {floorplanLayout && floorplanLayout.zones && zoneActivity && imageRef.current && imageRef.current.naturalWidth > 0 && (
                <svg 
                  className="absolute top-0 left-0 pointer-events-none" 
                  width={imageRef.current.clientWidth} 
                  height={imageRef.current.clientHeight}
                  viewBox={`0 0 ${imageRef.current.naturalWidth} ${imageRef.current.naturalHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {floorplanLayout.zones.map(zone => {
                    const activity = zoneActivity ? zoneActivity[zone.id] : null;
                    const score = activity ? activity.activity_score : 'N/A';
                    let centroidX = 0;
                    let centroidY = 0;
                    if (zone.points && zone.points.length > 0) {
                      zone.points.forEach(p => { centroidX += p.x; centroidY += p.y; });
                      centroidX /= zone.points.length;
                      centroidY /= zone.points.length;
                    }

                    return (
                      <g key={zone.id}>
                        <polygon 
                          points={zone.points.map(p => `${p.x},${p.y}`).join(' ')} 
                          fill={activity?.color || zone.color || "#CCCCCC"} 
                          fillOpacity="0.2" 
                          stroke={activity?.color || zone.color || "#CCCCCC"} 
                          strokeWidth="2" 
                        />
                        <text 
                          x={centroidX} 
                          y={centroidY} 
                          dy="-5" 
                          textAnchor="middle" 
                          fontSize="12" 
                          fill="white" 
                          stroke="black" 
                          strokeWidth="0.5px" 
                          fontWeight="bold" 
                          style={{paintOrder: "stroke fill", pointerEvents: "none"}}
                        >
                          {zone.name}: {score}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          </div>
        )}

        {currentView === 'results' && analyticsUrl && (
          <div className="p-6 border rounded-xl bg-gradient-to-br from-green-50 to-emerald-50">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-green-900 flex items-center space-x-2">
                  <BarChart2 className="h-5 w-5" />
                  <span>Analytics Data</span>
                </h3>
                <p className="text-green-700">Your analytics data is ready for download</p>
              </div>
              <Button 
                onClick={downloadAnalytics} 
                className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white transition-all duration-200 flex items-center space-x-2"
              >
                <Download className="h-4 w-4" />
                <span>Download Analytics</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <Card className="border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2">
            <Activity className="h-8 w-8 text-indigo-600" />
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Heatmap & Analytics
            </CardTitle>
          </div>
          <CardDescription className="text-base mt-2">
            View the generated heatmap and download analytics data for your video: {directory}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
          
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mt-6">
            <Button 
              onClick={refreshStatus} 
              variant="outline" 
              className="flex items-center space-x-2"
              disabled={currentView === 'initializing' || processingCompletedRef.current || isPollingRef.current || isInitializingEffectRunningRef.current}
            >
              <RefreshCw className="h-4 w-4" />
              <span>Refresh Status</span>
            </Button>
            <Button 
              onClick={restartProcessing} 
              variant="outline" 
              className="flex items-center space-x-2"
              disabled={isInitializingEffectRunningRef.current}
            >
              <Play className="h-4 w-4" />
              <span>Restart Processing</span>
            </Button>
            <Button 
              onClick={toggleDebugLogging} 
              variant="outline" 
              className="ml-auto flex items-center space-x-2"
            >
              <Bug className="h-4 w-4" />
              <span>{debugLoggingEnabledRef.current ? 'Disable Debug Logs' : 'Enable Debug Logs'}</span>
            </Button>
          </div>

          {/* Debug Logs */}
          {debugLoggingEnabledRef.current && debugLogs.length > 0 && (
            <div className="mt-8 p-4 border rounded-lg bg-gray-50">
              <h3 className="text-lg font-semibold mb-3 flex items-center space-x-2">
                <Bug className="h-5 w-5 text-gray-600" />
                <span>Debug Logs</span>
              </h3>
              <div className="max-h-60 overflow-y-auto text-xs font-mono bg-gray-900 text-gray-100 rounded-lg p-4">
                {debugLogs.map((log, index) => (
                  <div key={index} className="py-1 border-b border-gray-700 last:border-0">
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
