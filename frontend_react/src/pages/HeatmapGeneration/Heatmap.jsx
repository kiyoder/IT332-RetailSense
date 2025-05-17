import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui";
import {useAuth} from "@/AuthContext.jsx";
import axios from 'axios';

export default function HeatmapPage() {
  const { directory } = useParams();
  const { getSession } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [analyticsUrl, setAnalyticsUrl] = useState(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  
  // Poll for status updates
  useEffect(() => {
    if (!directory) return;
    
    const checkStatus = async () => {
      try {
        const session = await getSession();
        const accessToken = session?.access_token;
        
        if (!accessToken) {
          setError('Authentication required');
          setLoading(false);
          return;
        }
        
        const response = await axios.get(
          `${import.meta.env.VITE_API_URL}/api/process/status/${directory}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );
        
        const status = response.data;
        
        // Update status information
        setStatusMessage(status.message);
        setProgress(status.progress);
        
        if (status.status === 'completed') {
          // Processing is complete, get the heatmap and analytics URLs
          setHeatmapUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/heatmap.png`);
          setAnalyticsUrl(`${import.meta.env.VITE_API_URL}/api/files/${directory}/hourly_counts.csv`);
          setProcessing(false);
          setLoading(false);
        } else if (status.status === 'error') {
          // Error occurred
          setError(status.message);
          setProcessing(false);
          setLoading(false);
        } else if (status.status === 'processing' || status.status === 'initializing' || status.status === 'loading') {
          // Still processing
          setProcessing(true);
          setLoading(false);
        } else {
          // Waiting to start or unknown status
          setProcessing(false);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error checking status:', error);
        setError('Error checking processing status');
        setProcessing(false);
        setLoading(false);
      }
    };
    
    // Check status immediately
    checkStatus();
    
    // Then poll every 3 seconds if processing
    const interval = setInterval(() => {
      if (processing) {
        checkStatus();
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [directory, processing, getSession]);
  
  const downloadHeatmap = () => {
    if (heatmapUrl) {
      window.open(heatmapUrl, '_blank');
    }
  };
  
  const downloadAnalytics = () => {
    if (analyticsUrl) {
      window.open(analyticsUrl, '_blank');
    }
  };
  
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
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading...</div>
          ) : error ? (
            <div className="text-center text-red-500 py-8">{error}</div>
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
            </div>
          ) : heatmapUrl ? (
            <div>
              <div className="mb-6">
                <img 
                  src={heatmapUrl} 
                  alt="People Presence Heatmap" 
                  className="w-full rounded-lg shadow-lg"
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
              No heatmap available. Please ensure video processing has been started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
