import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/AuthContext'; // Assuming AuthContext provides user and getSession
import axios from 'axios';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Import Select
import { ArrowRight, ArrowUp, Filter, Users, Clock, BarChart2, MapPin, Activity, Calendar, AlertCircle } from "lucide-react"
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OverviewPage() {
  console.log("[Main.jsx] OverviewPage function body start");
  const { user, getSession } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [totalVisitors, setTotalVisitors] = useState(0);
  const [peakHours, setPeakHours] = useState('N/A');
  const [zoneAnalysis, setZoneAnalysis] = useState([]); // Changed from popularZones string to array of objects
  const [baseStoreLayoutUrl, setBaseStoreLayoutUrl] = useState('https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-RQEFh9vdrXwSK1QMBcSd74LKNQCe12.png'); // Renamed, Default placeholder
  const [hourlyTrendData, setHourlyTrendData] = useState([]);
  const [floorplanLayoutData, setFloorplanLayoutData] = useState({ zones: [], aisles: [] }); // For SVG overlay
  const baseImageRef = useRef(null); // Ref for the base image in dashboard
  const [baseImageDimensions, setBaseImageDimensions] = useState({ width: 1, height: 1 });

  // State for the timeframe filter
  const currentBaseStoreLayoutObjectUrlRef = useRef(null); // To manage object URL lifecycle
  const [selectedTimeframe, setSelectedTimeframe] = useState('all');



  useEffect(() => {
    console.log("[Main.jsx] useEffect triggered. user.id:", user?.id, "selectedTimeframe:", selectedTimeframe);
    if (!user?.id) {
      console.log("[Main.jsx] useEffect: No user.id found, setting isLoading to false.");
      setIsLoading(false);
      return;
    }

    const revokePreviousLayoutUrl = () => {
      if (currentBaseStoreLayoutObjectUrlRef.current) {
        URL.revokeObjectURL(currentBaseStoreLayoutObjectUrlRef.current);
        currentBaseStoreLayoutObjectUrlRef.current = null;
      }
    };

    const fetchData = async () => {
      console.log("[Main.jsx] fetchData: Started. Setting isLoading to true.");
      setIsLoading(true);
      setError('');
      try {
        const session = await getSession();
        if (!session) {
          throw new Error("Authentication session not found.");
        }
        const headers = { Authorization: `Bearer ${session.access_token}` };

        revokePreviousLayoutUrl(); // Clean up old object URL before fetching new

        // 1. Fetch Aggregated Zone Activity for Popular Zones
        const zoneActivityResponse = await axios.get(
          `${import.meta.env.VITE_API_URL}/api/activity/aggregated_zone_activity/${user.id}?period=${selectedTimeframe}`,
          { headers }
        );
        const zonesData = zoneActivityResponse.data;
        if (zonesData && Object.keys(zonesData).length > 0) {
          const allZoneScores = Object.values(zonesData).map(z => z.activity_score);
          const maxScore = Math.max(...allZoneScores, 0);

          const classifiedZones = Object.entries(zonesData)
            .map(([zoneId, zoneDetails]) => {
              const score = zoneDetails.activity_score || 0;
              let level = 'Low';
              if (maxScore > 0) {
                if (score >= maxScore * 0.66) level = 'High';
                else if (score >= maxScore * 0.33) level = 'Medium';
              } else if (score === 0 && maxScore === 0) {
                level = 'N/A';
              }
              return {
                id: zoneId,
                name: zoneDetails.name || `Zone ${zoneId.slice(-4)}`,
                score: score,
                level: level,
                color: zoneDetails.color || '#718096' // Default color if not provided
              };
            })
            .sort((a, b) => b.score - a.score);
          setZoneAnalysis(classifiedZones);
        } else {
          setZoneAnalysis([]);
        }

        // 2. Fetch base_floorplan image (remains the same, user's central asset)
        try {
          const baseImageResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/files/${user.id}/base_floorplan.png`,
            { headers, responseType: 'blob' }
          ).catch(async (err) => {
            if (err.response?.status === 404 || err.response?.status === 403) { // Also catch 403 if PNG is forbidden
              console.warn("Dashboard: base_floorplan.png not found or access denied, trying .jpg for user:", user.id);
              return axios.get(
                `${import.meta.env.VITE_API_URL}/files/${user.id}/base_floorplan.jpg`,
                { headers, responseType: 'blob' }
              );
            }
            throw err; // Re-throw other errors
          });
          if (!baseImageResponse || !baseImageResponse.data) {
            throw new Error("Base floorplan image response or data is undefined.");
          }
          const newObjectUrl = URL.createObjectURL(baseImageResponse.data);
          currentBaseStoreLayoutObjectUrlRef.current = newObjectUrl;
          setBaseStoreLayoutUrl(newObjectUrl);
        } catch (imgErr) {
          console.error("Dashboard: Error fetching base_floorplan image:", imgErr);
          setBaseStoreLayoutUrl('https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-RQEFh9vdrXwSK1QMBcSd74LKNQCe12.png'); // Fallback to placeholder
        }
        
        // Fetch floorplan layout data (zones and aisles) for SVG overlay
        try {
          const layoutResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/api/floorplan/${user.id}`,
            { headers }
          );
          setFloorplanLayoutData(layoutResponse.data || { zones: [], aisles: [] });
        } catch (layoutErr) {
          console.warn("Dashboard: Could not fetch floorplan layout for overlay:", layoutErr.message);
          setFloorplanLayoutData({ zones: [], aisles: [] }); // Default to empty if error
        }


        // 3. Fetch AGGREGATED hourly counts based on selectedTimeframe
        //    This assumes a new backend endpoint like /api/activity/aggregated_hourly_counts
        try {
          const aggregatedHourlyResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/api/activity/aggregated_hourly_counts/${user.id}?period=${selectedTimeframe}`,
            { headers }
          );
          // Assuming the backend returns an array of objects: [{ hour: "ISO_timestamp", count: number }]
          const aggregatedHourlyData = aggregatedHourlyResponse.data || [];
          setHourlyTrendData(aggregatedHourlyData);

          let total = 0;
          let maxCount = 0;
          let currentPeakHours = [];
          aggregatedHourlyData.forEach(item => {
            total += item.count;
            if (item.count > maxCount) {
              maxCount = item.count;
              // Assuming item.hour is a full ISO timestamp string
              currentPeakHours = [new Date(item.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })];
            } else if (item.count === maxCount && maxCount > 0) {
              currentPeakHours.push(new Date(item.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
            }
          });
          setTotalVisitors(total);
          setPeakHours(currentPeakHours.length > 0 ? currentPeakHours.join(' & ') : 'N/A');
        } catch (hourlyErr) {
          console.error("Dashboard: Error fetching aggregated hourly counts:", hourlyErr);
          toast.error("Failed to load hourly visitor data for the selected period.");
          setHourlyTrendData([]);
          setTotalVisitors(0);
          setPeakHours('N/A');
        }

      } catch (err) {
        console.error("Error fetching overview data:", err);
        setError('Failed to load dashboard data. ' + (err.message || ''));
        toast.error('Failed to load dashboard data.');
      } finally {
        console.log("[Main.jsx] fetchData: Finally block. Setting isLoading to false.");
        setIsLoading(false);
      }
    };

    fetchData();

    return () => {
      revokePreviousLayoutUrl(); // Cleanup object URL on component unmount or before next fetch
    };
  }, [user?.id, getSession, selectedTimeframe]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="text-gray-600">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-600 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5" />
          <span>Error: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Store Analytics Dashboard
          </h1>
          <p className="text-gray-500">Monitor visitor traffic and zone activity</p>
        </div>
        <div className="w-full sm:w-auto">
          <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe}>
            <SelectTrigger className="w-full sm:w-[200px] bg-white">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <SelectValue placeholder="Select timeframe" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this_week">This Week</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="this_year">This Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-white to-gray-50 border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-500">Total Visitors</p>
                <h3 className="text-3xl font-bold text-gray-900">{totalVisitors}</h3>
              </div>
              <div className="p-3 bg-orange-100 rounded-full">
                <Users className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-white to-gray-50 border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-500">Peak Hours</p>
                <h3 className="text-3xl font-bold text-gray-900">{peakHours}</h3>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <Clock className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-white to-gray-50 border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-500">Zone Analysis</p>
                <h3 className="text-xl font-bold text-gray-900">Traffic Levels</h3>
              </div>
              <div className="p-3 bg-purple-100 rounded-full">
                <Activity className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            {zoneAnalysis.length > 0 ? (
              <div className="mt-4 space-y-2 max-h-24 overflow-y-auto pr-2">
                {zoneAnalysis.slice(0, 3).map(zone => (
                  <div key={zone.id} className="flex items-center text-sm bg-white p-2 rounded-lg shadow-sm">
                    <span 
                      className="w-3 h-3 rounded-full mr-2" 
                      style={{ backgroundColor: zone.color }}
                    />
                    <span className="font-medium truncate flex-1" title={zone.name}>
                      {zone.name}
                    </span>
                    <span className={`ml-2 px-2 py-0.5 text-xs rounded-full font-medium
                      ${zone.level === 'High' ? 'bg-red-100 text-red-700' :
                        zone.level === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                        zone.level === 'Low' ? 'bg-blue-100 text-blue-700' : 
                        'bg-gray-100 text-gray-700'}`}>
                      {zone.level}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-400">No zone data for this period.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Store Layout and Hourly Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gradient-to-br from-white to-gray-50 border-none shadow-lg">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <MapPin className="h-5 w-5 text-indigo-600" />
              <CardTitle>Store Layout</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative h-[400px] bg-gray-50 rounded-lg overflow-hidden">
              <img
                ref={baseImageRef}
                src={baseStoreLayoutUrl}
                alt="Store Layout / Base Floorplan"
                className="w-full h-full object-contain"
                onLoad={(e) => {
                  setBaseImageDimensions({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                }}
                onError={(e) => { 
                  e.target.src = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-RQEFh9vdrXwSK1QMBcSd74LKNQCe12.png'; 
                  e.target.alt = 'Error loading store layout. Placeholder shown.'; 
                  setBaseImageDimensions({ width: 1, height: 1 });
                }}
              />
              {baseStoreLayoutUrl && baseStoreLayoutUrl !== 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-RQEFh9vdrXwSK1QMBcSd74LKNQCe12.png' && baseImageDimensions.width > 1 && (
                <svg
                  className="absolute top-0 left-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${baseImageDimensions.width} ${baseImageDimensions.height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {(floorplanLayoutData.zones || []).map(zone => (
                    <polygon
                      key={`dashboard-zone-${zone.id}`}
                      points={zone.points.map(p => `${p.x},${p.y}`).join(' ')}
                      fill={zone.color || "#FF0000"}
                      fillOpacity="0.3"
                      stroke={zone.color || "#FF0000"}
                      strokeWidth="1"
                    />
                  ))}
                </svg>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-white to-gray-50 border-none shadow-lg">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <BarChart2 className="h-5 w-5 text-indigo-600" />
              <CardTitle>Hourly Trend</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[400px] bg-gray-50 rounded-lg p-6">
              {hourlyTrendData.length > 0 ? (
                <div className="h-full w-full flex items-end justify-between">
                  {hourlyTrendData.map((item, i) => (
                    <div key={item.hour} className="flex flex-col items-center gap-2 mx-1 flex-1 max-w-[50px] group">
                      <div 
                        className="w-6 bg-gradient-to-t from-indigo-500 to-indigo-600 rounded-t-lg transition-all duration-200 group-hover:from-indigo-600 group-hover:to-indigo-700"
                        style={{ height: `${Math.min(150, Math.max(5, item.count * 5))}px` }}
                        title={`Hour: ${new Date(item.hour).toLocaleTimeString([], { hour: '2-digit', hour12: false })}\nCount: ${item.count}`}
                      />
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(item.hour).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(':00 ', '')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-gray-500">No hourly trend data available.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
