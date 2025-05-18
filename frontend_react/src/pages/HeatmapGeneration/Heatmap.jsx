import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui";
import { useAuth } from "@/AuthContext.jsx";
import axios from 'axios';

export default function HeatmapPage() {
  const { directory } = useParams();
  const { getSession } = useAuth();

  // State management
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [analyticsUrl, setAnalyticsUrl] = useState(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [completedTimestamp, setCompletedTimestamp] = useState(null);

  // WebSocket reference
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // Start with 1 second

  // Polling control
  const pollingTimeoutRef = useRef(null);
  const isPollingRef = useRef(false);
  const minPollingInterval = 5000; // Minimum 5 seconds between polls
  const connectionAttemptInProgressRef = useRef(false);

  // File checking timer
  const fileCheckTimerRef = useRef(null);
  const fileCheckAttemptsRef = useRef(0);
  const maxFileCheckAttempts = 10;

  // Use emergency endpoint for file access
  const useEmergencyEndpoint = true;

  // Immediately exit loading state on mount
  useEffect(() => {
    // Short timeout to ensure component is mounted
    const timer = setTimeout(() => {
      setLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Set up periodic file checking
  useEffect(() => {
    if (!directory) return;

    // Set up a timer to check for heatmap existence every 10 seconds
    // This helps in case WebSocket updates fail but file is actually generated
    const checkTimer = setInterval(() => {
      if (processing && !heatmapUrl) {
        console.log('Periodic heatmap check');
        checkHeatmap();
      }
    }, 10000);

    fileCheckTimerRef.current = checkTimer;

    return () => {
      if (fileCheckTimerRef.current) {
        clearInterval(fileCheckTimerRef.current);
      }
    };
  }, [directory, processing, heatmapUrl]);

  // Effect to handle completed status with delay
  useEffect(() => {
    if (!completedTimestamp) return;

    // Calculate time since completion
    const now = new Date();
    const elapsedMs = now - completedTimestamp;

    // If less than 3 seconds have passed, set up a timer to check after delay
    if (elapsedMs < 3000) {
      const remainingDelay = 3000 - elapsedMs;
      console.log(`Processing completed, waiting ${remainingDelay}ms before checking for files`);

      const delayedCheckTimer = setTimeout(() => {
        console.log('Delayed heatmap check after completion');
        checkHeatmap();

        // Set up repeated checks with increasing intervals
        const checkInterval = setInterval(() => {
          if (fileCheckAttemptsRef.current >= maxFileCheckAttempts) {
            console.log(`Max file check attempts (${maxFileCheckAttempts}) reached, stopping checks`);
            clearInterval(checkInterval);
            return;
          }

          if (!heatmapUrl) {
            fileCheckAttemptsRef.current += 1;
            console.log(`Retry heatmap check attempt ${fileCheckAttemptsRef.current}/${maxFileCheckAttempts}`);
            checkHeatmap();
          } else {
            console.log('Heatmap found, stopping retry checks');
            clearInterval(checkInterval);
          }
        }, 2000); // Check every 2 seconds

        // Clean up interval after max attempts or 30 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
        }, 30000);

      }, remainingDelay);

      return () => clearTimeout(delayedCheckTimer);
    }
  }, [completedTimestamp, heatmapUrl]);

  // WebSocket connection setup
  useEffect(() => {
    if (!directory) return;

    let isMounted = true;

    // Function to establish WebSocket connection
    const connectWebSocket = async () => {
      // Prevent multiple simultaneous connection attempts
      if (connectionAttemptInProgressRef.current) {
        console.log('Connection attempt already in progress, skipping');
        return;
      }

      connectionAttemptInProgressRef.current = true;

      try {
        // Get authentication token
        const session = await getSession();
        const accessToken = session?.access_token;

        if (!accessToken) {
          if (isMounted) {
            setError('Authentication required');
            setConnectionStatus('error');
          }
          connectionAttemptInProgressRef.current = false;
          return;
        }

        // Close existing connection if any
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
          wsRef.current.close();
        }

        // Create new WebSocket connection with authentication token
        const wsUrl = `${import.meta.env.VITE_API_URL.replace('http', 'ws')}/api/ws/process/status/${directory}?token=${accessToken}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        // WebSocket event handlers
        ws.onopen = () => {
          if (isMounted) {
            console.log('WebSocket connection established');
            setConnectionStatus('connected');
            reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
            setError('');

            // Stop any active polling when WebSocket connects
            if (pollingTimeoutRef.current) {
              clearTimeout(pollingTimeoutRef.current);
              pollingTimeoutRef.current = null;
            }
            isPollingRef.current = false;

            // Immediately request status update
            ws.send('get_status');
          }
          connectionAttemptInProgressRef.current = false;
        };

        ws.onmessage = (event) => {
          if (isMounted) {
            try {
              const status = JSON.parse(event.data);
              console.log('WebSocket status update:', status);

              // Force a state update to trigger re-render
              setLastUpdated(new Date());

              // Update UI based on status
              setStatusMessage(status.message || 'Processing video');
              setProgress(status.progress || 0);

              if (status.status === 'completed') {
                // Processing complete - record timestamp for delayed checking
                console.log('Processing completed, setting timestamp for delayed file check');
                setCompletedTimestamp(new Date());

                if (useEmergencyEndpoint) {
                  // Use emergency endpoint for file access
                  setHeatmapUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/heatmap.png`);
                  setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/hourly_counts.csv`);
                } else {
                  // Use original endpoint
                  setHeatmapUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png`);
                  setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/hourly_counts.csv`);
                }
                setProcessing(false);

                // File checking will be triggered by the completedTimestamp effect
              } else if (status.status === 'error') {
                // Error occurred
                setError(status.message || 'Error processing video');
                setProcessing(false);
              } else if (status.status === 'processing' || status.status === 'initializing' || status.status === 'loading') {
                // Still processing
                setProcessing(true);
              } else {
                // Waiting to start or unknown status
                setProcessing(false);
              }
            } catch (error) {
              console.error('Error parsing WebSocket message:', error);
            }
          }
        };

        ws.onclose = (event) => {
          if (isMounted) {
            console.log('WebSocket connection closed:', event.code, event.reason);
            setConnectionStatus('disconnected');

            // Force check for heatmap existence on WebSocket close
            // This helps in case the heatmap was generated but WebSocket failed
            checkHeatmap();

            // Attempt to reconnect if not closed cleanly and we haven't exceeded max attempts
            if (!event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
              const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
              console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);

              // Clear any existing reconnect timeout
              if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
              }

              reconnectTimeoutRef.current = setTimeout(() => {
                reconnectAttemptsRef.current += 1;
                connectWebSocket();
              }, delay);
            } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
              setError('Connection lost. Please refresh the page to reconnect.');
              setConnectionStatus('error');

              // Fall back to polling with a reasonable interval after max reconnect attempts
              startPolling();
            }
          }
          connectionAttemptInProgressRef.current = false;
        };

        ws.onerror = (error) => {
          if (isMounted) {
            console.error('WebSocket error:', error);
            setConnectionStatus('error');

            // Check for heatmap on error
            checkHeatmap();
          }
          connectionAttemptInProgressRef.current = false;
        };

      } catch (error) {
        console.error('Error setting up WebSocket:', error);
        if (isMounted) {
          setError('Error connecting to server');
          setConnectionStatus('error');
        }
        connectionAttemptInProgressRef.current = false;
      }
    };

    // Function to start polling with rate limiting
    const startPolling = () => {
      // Only start polling if not already polling
      if (isPollingRef.current) {
        console.log('Polling already active, skipping');
        return;
      }

      isPollingRef.current = true;
      console.log('Starting REST API polling with interval:', minPollingInterval);

      // Initial poll
      checkStatus();

      // Schedule next poll with minimum interval
      pollingTimeoutRef.current = setTimeout(() => {
        if (isMounted && isPollingRef.current) {
          // Only continue polling if WebSocket is not connected
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            checkStatus();
            startPolling(); // Schedule next poll
          } else {
            // WebSocket is connected, stop polling
            isPollingRef.current = false;
          }
        }
      }, minPollingInterval);
    };

    // Initial connection
    connectWebSocket();

    // Fallback to REST API if WebSocket fails to connect within timeout
    const fallbackTimeout = setTimeout(() => {
      if (connectionStatus === 'connecting' && isMounted) {
        console.log('WebSocket connection timeout, falling back to REST API polling');
        startPolling();
      }
    }, 5000);

    // Function to check processing status via REST API (fallback)
    const checkStatus = async () => {
      if (!isMounted) return;

      try {
        const session = await getSession();
        const accessToken = session?.access_token;

        if (!accessToken) {
          if (isMounted) {
            setError('Authentication required');
          }
          return;
        }

        // Add cache-busting parameter
        const cacheBuster = new Date().getTime();

        const response = await axios.get(
            `${import.meta.env.VITE_API_URL}/api/process/status/${directory}?_=${cacheBuster}`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            }
        );

        if (!isMounted) return;

        const status = response.data;
        console.log('REST API status update:', status);

        // Force a state update to trigger re-render
        setLastUpdated(new Date());

        // Update UI based on status
        setStatusMessage(status.message || 'Processing video');
        setProgress(status.progress || 0);

        if (status.status === 'completed') {
          // Processing complete - record timestamp for delayed checking
          console.log('Processing completed (via REST API), setting timestamp for delayed file check');
          setCompletedTimestamp(new Date());

          if (useEmergencyEndpoint) {
            // Use emergency endpoint for file access
            setHeatmapUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/heatmap.png`);
            setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/hourly_counts.csv`);
          } else {
            // Use original endpoint
            setHeatmapUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png`);
            setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/hourly_counts.csv`);
          }
          setProcessing(false);

          // File checking will be triggered by the completedTimestamp effect

          // Stop polling if processing is complete
          isPollingRef.current = false;
          if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
          }
        } else if (status.status === 'error') {
          // Error occurred
          setError(status.message || 'Error processing video');
          setProcessing(false);

          // Stop polling on error
          isPollingRef.current = false;
          if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
          }
        } else if (status.status === 'processing' || status.status === 'initializing' || status.status === 'loading') {
          // Still processing
          setProcessing(true);
        } else {
          // Waiting to start or unknown status
          setProcessing(false);
        }
      } catch (error) {
        console.error('Error checking status:', error);

        if (isMounted) {
          setError('Error checking processing status');

          // Check if heatmap exists despite the error
          checkHeatmap();
        }
      }
    };

    // Clean up on unmount
    return () => {
      isMounted = false;

      // Clear all timeouts
      clearTimeout(fallbackTimeout);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }

      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Reset flags
      isPollingRef.current = false;
      connectionAttemptInProgressRef.current = false;
    };
  }, [directory, getSession]);

  // Function to manually refresh status
  const refreshStatus = async () => {
    try {
      setError('');

      // If WebSocket is connected, send a status request
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send('get_status');
        return;
      }

      // Fallback to REST API
      const session = await getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setError('Authentication required');
        return;
      }

      // Add cache-busting parameter
      const cacheBuster = new Date().getTime();

      const response = await axios.get(
          `${import.meta.env.VITE_API_URL}/api/process/status/${directory}?_=${cacheBuster}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
          }
      );

      const status = response.data;
      console.log('Manual status refresh:', status);

      // Force a state update to trigger re-render
      setLastUpdated(new Date());

      // Update UI based on status
      setStatusMessage(status.message || 'Processing video');
      setProgress(status.progress || 0);

      if (status.status === 'completed') {
        // Processing complete - record timestamp for delayed checking
        console.log('Processing completed (via manual refresh), setting timestamp for delayed file check');
        setCompletedTimestamp(new Date());

        if (useEmergencyEndpoint) {
          // Use emergency endpoint for file access
          setHeatmapUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/heatmap.png`);
          setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/hourly_counts.csv`);
        } else {
          // Use original endpoint
          setHeatmapUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png`);
          setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/hourly_counts.csv`);
        }
        setProcessing(false);

        // File checking will be triggered by the completedTimestamp effect
      } else if (status.status === 'error') {
        // Error occurred
        setError(status.message || 'Error processing video');
        setProcessing(false);
      } else if (status.status === 'processing' || status.status === 'initializing' || status.status === 'loading') {
        // Still processing
        setProcessing(true);
      } else {
        // Waiting to start or unknown status
        setProcessing(false);
      }
    } catch (error) {
      console.error('Error refreshing status:', error);
      setError('Error refreshing status');

      // Check if heatmap exists despite the error
      checkHeatmap();
    }
  };

  // Function to manually check if heatmap exists
  const checkHeatmap = async () => {
    try {
      console.log('Checking if heatmap exists...');
      const session = await getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setError('Authentication required');
        return;
      }

      // Add cache-busting parameter
      const cacheBuster = new Date().getTime();

      // Determine which endpoint to use for checking
      let checkUrl;
      if (useEmergencyEndpoint) {
        // Use emergency endpoint
        checkUrl = `${import.meta.env.VITE_API_URL}/emergency/files/${directory}/heatmap.png?_=${cacheBuster}`;
      } else {
        // Use original endpoint
        checkUrl = `${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png?_=${cacheBuster}`;
      }

      console.log(`Checking heatmap at: ${checkUrl}`);

      // Try to access the file
      await axios.head(checkUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });

      // If we get here, the heatmap exists
      console.log('Heatmap found! Setting URLs...');
      if (useEmergencyEndpoint) {
        // Use emergency endpoint for file access
        setHeatmapUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/heatmap.png?_=${cacheBuster}`);
        setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/hourly_counts.csv?_=${cacheBuster}`);
      } else {
        // Use original endpoint
        setHeatmapUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png?_=${cacheBuster}`);
        setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/hourly_counts.csv?_=${cacheBuster}`);
      }
      setProcessing(false);
      setError('');

      console.log('Heatmap found and URLs set!');

      // Also check for analytics file
      try {
        let analyticsCheckUrl;
        if (useEmergencyEndpoint) {
          analyticsCheckUrl = `${import.meta.env.VITE_API_URL}/emergency/files/${directory}/hourly_counts.csv?_=${cacheBuster}`;
        } else {
          analyticsCheckUrl = `${import.meta.env.VITE_API_URL}/api/files/${directory}/hourly_counts.csv?_=${cacheBuster}`;
        }

        await axios.head(analyticsCheckUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
        console.log('Analytics file found!');
      } catch (analyticsError) {
        console.log('Analytics file not available yet:', analyticsError);
      }
    } catch (error) {
      console.log('Heatmap not available:', error);
      if (error.response && error.response.status === 403) {
        setError('Access denied to heatmap file. Please try refreshing the page.');
      } else {
        setError('Heatmap not available yet');
      }
    }
  };

  const downloadHeatmap = () => {
    if (heatmapUrl) {
      const cacheBuster = new Date().getTime();
      window.open(`${heatmapUrl.split('?')[0]}?_=${cacheBuster}`, '_blank');
    }
  };

  const downloadAnalytics = () => {
    if (analyticsUrl) {
      const cacheBuster = new Date().getTime();
      window.open(`${analyticsUrl.split('?')[0]}?_=${cacheBuster}`, '_blank');
    }
  };

  // Display last updated time for debugging
  const lastUpdateTime = lastUpdated.toLocaleTimeString();

  return (
      <div className="container mx-auto py-8">
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle>Heatmap Visualization</CardTitle>
            <CardDescription>
              {processing
                  ? `Processing: ${statusMessage}`
                  : heatmapUrl
                      ? 'Heatmap generated successfully'
                      : 'Waiting for heatmap generation'}
            </CardDescription>
            <div className="flex justify-between items-center">
              <div className="text-xs text-gray-400">Last updated: {lastUpdateTime}</div>
              <div className={`text-xs ${
                  connectionStatus === 'connected' ? 'text-green-500' :
                      connectionStatus === 'connecting' ? 'text-yellow-500' :
                          connectionStatus === 'disconnected' ? 'text-orange-500' : 'text-red-500'
              }`}>
                {connectionStatus === 'connected' ? 'Live updates active' :
                    connectionStatus === 'connecting' ? 'Connecting...' :
                        connectionStatus === 'disconnected' ? 'Reconnecting...' : 'Connection error'}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
                <div className="text-center py-8">Loading...</div>
            ) : error ? (
                <div className="text-center text-red-500 py-8">
                  {error}
                  <div className="mt-4 flex justify-center gap-2">
                    <Button onClick={refreshStatus} variant="outline" size="sm">
                      Refresh Status
                    </Button>
                    <Button onClick={checkHeatmap} variant="outline" size="sm">
                      Check Heatmap
                    </Button>
                  </div>
                </div>
            ) : processing ? (
                <div className="py-8">
                  <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                    <div
                        className="bg-primary h-2.5 rounded-full"
                        style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="text-center">{progress}% Complete</p>
                  <p className="text-center text-sm text-gray-500 mt-2">{statusMessage}</p>
                  <div className="text-center mt-4 flex justify-center gap-2">
                    <Button onClick={refreshStatus} variant="outline" size="sm">
                      Refresh Status
                    </Button>
                    <Button onClick={checkHeatmap} variant="outline" size="sm">
                      Check Heatmap
                    </Button>
                  </div>
                </div>
            ) : heatmapUrl ? (
                <div>
                  <div className="mb-6">
                    <img
                        src={heatmapUrl}
                        alt="People Presence Heatmap"
                        className="w-full rounded-lg shadow-lg"
                        onError={(e) => {
                          console.error("Error loading heatmap image");
                          setError("Error loading heatmap image. Please try refreshing.");
                          e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23f0f0f0'/%3E%3Ctext x='50' y='50' font-family='Arial' font-size='12' text-anchor='middle' dominant-baseline='middle'%3EImage Error%3C/text%3E%3C/svg%3E";
                          // Try to reload the image with a new cache buster
                          setTimeout(() => {
                            const newCacheBuster = new Date().getTime();
                            if (useEmergencyEndpoint) {
                              setHeatmapUrl(`${import.meta.env.VITE_API_URL}/emergency/files/${directory}/heatmap.png?_=${newCacheBuster}`);
                            } else {
                              setHeatmapUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png?_=${newCacheBuster}`);
                            }
                          }, 2000);
                        }}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
                    <Button onClick={downloadHeatmap}>
                      Download Heatmap
                    </Button>
                    <Button variant="outline" onClick={downloadAnalytics}>
                      Download Analytics Data
                    </Button>
                  </div>
                </div>
            ) : (
                <div className="text-center py-8">
                  <p>No heatmap available. Please ensure video processing has been started.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button onClick={refreshStatus} variant="outline" size="sm">
                      Refresh Status
                    </Button>
                    <Button onClick={checkHeatmap} variant="outline" size="sm">
                      Check Heatmap
                    </Button>
                  </div>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
