import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/AuthContext.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Save, Pencil, X, Check, Calendar } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

export default function FloorplanEditorPage() {
  const { directory: routeDirectory } = useParams();
  const { getSession, user } = useAuth();

  const [layoutImageUrl, setLayoutImageUrl] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const imageRef = useRef(null);

  const [floorplanData, setFloorplanData] = useState({ zones: [], aisles: [] });
  const [currentDrawingTool, setCurrentDrawingTool] = useState(null); 
  const [currentDrawingPoints, setCurrentDrawingPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneColor, setNewZoneColor] = useState('#FF0000'); 
  
  const [hoveredZoneInfo, setHoveredZoneInfo] = useState(null); 
  const [currentZoneActivity, setCurrentZoneActivity] = useState({}); // Renamed from latestZoneActivity
  const [activityPeriodFilter, setActivityPeriodFilter] = useState('all'); // 'all', 'today', 'this_week', 'this_month', 'this_year'

  const lastFetchedRef = useRef({ directory: null, filter: 'all', layoutImageUrl: null, lastCallId: 0 });
  const fetchDataTimeoutRef = useRef(null);
  // console.log("FloorplanEditorPage render - isDrawing:", isDrawing, "currentDrawingTool:", currentDrawingTool, "Points:", currentDrawingPoints.length);


  const getAuthHeader = async () => {
    const session = await getSession();
    if (!session) {
      setError('Authentication required.');
      setIsLoading(false);
      toast.error('Authentication required.');
      return null;
    }
    return { Authorization: `Bearer ${session.access_token}` };
  };

  // Effect for fetching both base data (image and layout) and activity
  useEffect(() => {
    const currentCallId = ++lastFetchedRef.current.lastCallId; // Unique ID for this effect run
    const currentDirectory = routeDirectory || user?.id;

    if (!currentDirectory) {
      setError('No project identifier specified.');
      setLayoutImageUrl(null); setFloorplanData({ zones: [], aisles: [] }); setCurrentZoneActivity({});
      setIsLoading(false);
      toast.error('No project identifier specified. Please select a project.');
      return;
    }

    // Determine if directory changed to reset more states
    const directoryChanged = currentDirectory !== lastFetchedRef.current.directory;
    // Perform immediate state resets if the directory has changed
    if (directoryChanged) {
      // Full reset if directory changes
      setIsDrawing(false);
      setCurrentDrawingTool(null);
      setCurrentDrawingPoints([]);
      setNewZoneName('');
      setNewZoneColor('#FF0000');
      setCurrentZoneActivity({}); // Reset activity only if directory changes
      setLayoutImageUrl(null); // Reset image URL
      setFloorplanData({ zones: [], aisles: [] }); // Reset floorplan data
      // When directory changes, we will definitely fetch, so set loading true early.
      // For filter-only changes, loading will be set inside the debounced function.
      setIsLoading(true); 
    }
    // Clear any existing debounced call
    if (fetchDataTimeoutRef.current) {
      clearTimeout(fetchDataTimeoutRef.current);
    }

    fetchDataTimeoutRef.current = setTimeout(async () => {
      // Check if this is still the latest call
      if (currentCallId !== lastFetchedRef.current.lastCallId) {
        return; // A newer call has been scheduled, so ignore this one
      }

      // Re-evaluate conditions inside the debounced function with potentially updated state
      const freshDirectory = routeDirectory || user?.id; // Use potentially updated route/user
      const freshFilter = activityPeriodFilter; // Use current filter state

      // Re-evaluate conditions inside the debounced function
      const shouldFetchBase = freshDirectory !== lastFetchedRef.current.directory;
      const shouldFetchActivity = freshDirectory !== lastFetchedRef.current.directory || 
                                  freshFilter !== lastFetchedRef.current.filter || 
                                  (shouldFetchBase && !lastFetchedRef.current.layoutImageUrl);

      if (!shouldFetchBase && !shouldFetchActivity) {
        setIsLoading(false); // Ensure loading is false if no fetch happens
        return;
      }

      // If only filter changed and not directory, reset activity to show loading for activity part
      if (!shouldFetchBase && (freshFilter !== lastFetchedRef.current.filter)) {
        setCurrentZoneActivity({});
      }
      
      setIsLoading(true); 
      setError('');
      let newLayoutImageUrl = lastFetchedRef.current.layoutImageUrl; // Preserve by default if base isn't fetched

      if (shouldFetchBase) { 
         newLayoutImageUrl = null; // Will be set if base image fetch is successful
      }

      const headers = await getAuthHeader();
      if (!headers) {
        setIsLoading(false);
        return; 
      }

      if (shouldFetchBase) {
        try {
          const imageResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/files/${freshDirectory}/base_floorplan.png`,
            { headers, responseType: 'blob' }
          ).catch(async (err) => {
            if (err.response?.status === 404) {
              return axios.get(
                `${import.meta.env.VITE_API_URL}/files/${freshDirectory}/base_floorplan.jpg`,
                { headers, responseType: 'blob' }
              );
            }
            throw err;
          });

          const objectURL = URL.createObjectURL(imageResponse.data);
          newLayoutImageUrl = objectURL; // Update local var for this fetch

          const img = new Image();
          img.onload = () => {
              if (imageRef.current) {
                  imageRef.current.dataset.naturalWidth = img.naturalWidth;
                  imageRef.current.dataset.naturalHeight = img.naturalHeight;
              }
          };
          img.src = objectURL;
          setLayoutImageUrl(newLayoutImageUrl); // Set state

        } catch (err) {
          console.error('Error fetching base floorplan image:', err);
          const msg = err.response?.data?.detail || 'Failed to load base floorplan image. Ensure one is uploaded.';
          setError(msg);
          // If base image fails, we might not want to proceed with activity for this base.
          // However, layout might still be useful.
          // For now, we'll let it try to fetch layout.
        } 

        try {
          const layoutResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/api/floorplan/${freshDirectory}`,
            { headers }
          );
          const data = layoutResponse.data || { zones: [], aisles: [] };
          setFloorplanData(data);
        } catch (err) {
          console.warn('No existing floorplan layout found or error fetching:', err.message);
          setFloorplanData({ zones: [], aisles: [] });
        }
      } 

      if (shouldFetchActivity) {
        try {
          const activityResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/api/activity/aggregated_zone_activity/${freshDirectory}`,
            { 
              headers,
              params: { period: freshFilter } 
            }
          );
          setCurrentZoneActivity(activityResponse.data || {});
        } catch (err) {
          console.warn(`Could not fetch aggregated zone activity for period ${freshFilter}:`, err.message);
          setCurrentZoneActivity({});
        }
      }

      lastFetchedRef.current = { 
        directory: freshDirectory, 
        filter: freshFilter, 
        layoutImageUrl: newLayoutImageUrl !== undefined ? newLayoutImageUrl : lastFetchedRef.current.layoutImageUrl, // Prioritize new if fetched
        lastCallId: currentCallId 
      };
      setIsLoading(false);
    }, 1000); // 1-second delay

    return () => {
      if (fetchDataTimeoutRef.current) {
        clearTimeout(fetchDataTimeoutRef.current);
      }
    };
  }, [routeDirectory, user?.id, getSession, activityPeriodFilter]); // Dependencies are correct


  const handleSaveLayout = async () => {
    const directoryToUse = routeDirectory || user?.id;
    if (!directoryToUse) {
      toast.error("Cannot save layout: No project identifier available.");
      return;
    }

    setIsSavingLayout(true);
    setError('');
    try {
      const headers = await getAuthHeader();
      if (!headers) {
        setIsSavingLayout(false); 
        return;
      }
      const dataToSave = {
        zones: floorplanData.zones || [],
        aisles: floorplanData.aisles || [] 
      };
      await axios.post(
        `${import.meta.env.VITE_API_URL}/api/floorplan/${directoryToUse}`,
        dataToSave,
        { headers }
      );
      toast.success('Floorplan layout (zones) saved successfully!');
    } catch (err) {
      console.error('Error saving floorplan layout:', err);
      const errorMsg = err.response?.data?.detail || 'Failed to save floorplan layout.';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsSavingLayout(false);
    }
  };

  const handleStartDrawingZone = () => {
    if (isDrawing) { 
      toast.info(`Please finish or cancel the current drawing first.`);
      return;
    }
    setCurrentDrawingTool('zone');
    setCurrentDrawingPoints([]);
    setIsDrawing(true);
    setNewZoneName(''); 
    setNewZoneColor('#FF0000'); 
    toast.info(`Started drawing zone. Click on the floorplan to add points.`);
  };

  const handleImageClickForDrawing = (e) => {
    // console.log("handleImageClickForDrawing called. isDrawing:", isDrawing, "currentDrawingTool:", currentDrawingTool);
    if (!isDrawing || currentDrawingTool !== 'zone' || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const naturalWidth = parseFloat(imageRef.current.dataset.naturalWidth || imageRef.current.naturalWidth);
    const naturalHeight = parseFloat(imageRef.current.dataset.naturalHeight || imageRef.current.naturalHeight);

    if (!naturalWidth || !naturalHeight) {
        toast.error("Image dimensions not available yet. Please wait for the image to fully load.");
        return;
    }

    const scaleX = naturalWidth / rect.width;
    const scaleY = naturalHeight / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    setCurrentDrawingPoints(prevPoints => {
      const newPoints = [...prevPoints, { x, y }];
      // console.log("Added point:", { x, y }, "Updated points array:", newPoints);
      return newPoints;
    });
  };

  const handleFinishDrawing = () => {
    if (!isDrawing || currentDrawingTool !== 'zone') {
        toast.error("Not currently drawing a zone.");
        return;
    }
    if (currentDrawingPoints.length < 3) {
      toast.error(`Cannot finish drawing: A zone needs at least 3 points.`);
      return;
    }

    const nameToSave = newZoneName.trim();
    const colorToSave = newZoneColor.trim() || '#FF0000'; 
    if (!nameToSave) {
      toast.error("Zone name cannot be empty.");
      return;
    }
    
    const newZone = { id: `zone-${Date.now()}`, name: nameToSave, points: currentDrawingPoints, color: colorToSave };
    setFloorplanData(prevData => ({ 
        ...prevData, 
        zones: [...(prevData.zones || []), newZone],
        aisles: prevData.aisles || [] 
    }));
    toast.success(`Zone "${nameToSave}" added.`);
    
    setIsDrawing(false);
    setCurrentDrawingTool(null);
    setCurrentDrawingPoints([]);
    setNewZoneName(''); 
    setNewZoneColor('#FF0000'); 
  };

  const handleCancelDrawing = () => {
    setIsDrawing(false);
    setCurrentDrawingTool(null);
    setCurrentDrawingPoints([]);
    toast.info("Drawing cancelled.");
    setNewZoneName(''); 
    setNewZoneColor('#FF0000'); 
  };

  const handleDeleteZone = (zoneIdToDelete) => {
    setFloorplanData(prevData => ({
      ...prevData,
      zones: (prevData.zones || []).filter(zone => zone.id !== zoneIdToDelete),
      aisles: prevData.aisles || [] 
    }));
    toast.info("Zone removed. Click 'Save Zones' to make it permanent.");
  };

  const handleZoneMouseEnter = (e, zone) => {
    const activityData = currentZoneActivity ? currentZoneActivity[zone.id] : null;
    const score = activityData ? activityData.activity_score : 0; // Default to 0 if no activity
    const svgContainer = imageRef.current?.closest('div[style*="max-width: 800px"]');
    if (!svgContainer) return;
    const svgRect = svgContainer.getBoundingClientRect();
    
    let tooltipX = e.clientX - svgRect.left + 10;
    let tooltipY = e.clientY - svgRect.top + 10;
    if (zone.points && zone.points.length > 0 && imageRef.current) {
        const naturalWidth = parseFloat(imageRef.current.dataset.naturalWidth || imageRef.current.naturalWidth);
        const naturalHeight = parseFloat(imageRef.current.dataset.naturalHeight || imageRef.current.naturalHeight);
        const displayWidth = imageRef.current.clientWidth;
        const displayHeight = imageRef.current.clientHeight;

        if (naturalWidth && naturalHeight && displayWidth && displayHeight) {
            const firstPoint = zone.points[0];
            tooltipX = (firstPoint.x / naturalWidth) * displayWidth + 10;
            tooltipY = (firstPoint.y / naturalHeight) * displayHeight - 20; 
        }
    }

    setHoveredZoneInfo({
      id: zone.id,
      name: zone.name,
      score: score.toLocaleString(), // Format score with commas
      x: tooltipX,
      y: tooltipY,
    });
  };
  const handleZoneMouseLeave = () => {
    setHoveredZoneInfo(null);
  };

  const imageNaturalWidth = parseFloat(imageRef.current?.dataset.naturalWidth || imageRef.current?.naturalWidth || 1);
  const imageNaturalHeight = parseFloat(imageRef.current?.dataset.naturalHeight || imageRef.current?.naturalHeight || 1);

  const currentDirectoryForDisplay = routeDirectory || user?.id;

  return (
    <div className="container mx-auto p-4 max-w-7xl space-y-6">
      <Card className="border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Floorplan Zone Editor
              </CardTitle>
              <CardDescription className="text-base mt-2">
                {currentDirectoryForDisplay || 'No Project Selected'}
              </CardDescription>
            </div>
            <div className="flex items-center space-x-4">
              <Label htmlFor="activityPeriodFilter" className="text-sm font-medium">Activity Period:</Label>
              <Select value={activityPeriodFilter} onValueChange={setActivityPeriodFilter}>
                <SelectTrigger id="activityPeriodFilter" className="w-[180px]">
                  <SelectValue placeholder="Select period" />
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
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {!currentDirectoryForDisplay && !isLoading && (
            <Alert variant="warning" className="mb-6">
              <AlertTitle>No Project Selected</AlertTitle>
              <AlertDescription>Please upload a base floorplan image via "Configure Floorplan" to begin.</AlertDescription>
            </Alert>
          )}

          <div className="mb-6 flex flex-wrap gap-3">
            <Button 
              onClick={handleSaveLayout} 
              disabled={isSavingLayout || !layoutImageUrl || !currentDirectoryForDisplay}
              className="bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSavingLayout ? 'Saving Layout...' : 'Save Zones'}
            </Button>
            
            {!isDrawing && (
              <Button 
                variant="outline" 
                onClick={handleStartDrawingZone} 
                disabled={!layoutImageUrl}
                className="border-indigo-200 hover:bg-indigo-50"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Draw Zone
              </Button>
            )}
            
            {isDrawing && (
              <>
                <Button 
                  variant="destructive" 
                  onClick={handleCancelDrawing}
                  className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel Drawing
                </Button>
                <Button 
                  onClick={handleFinishDrawing} 
                  disabled={currentDrawingPoints.length < 3}
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Finish Drawing Zone
                </Button>
              </>
            )}
          </div>

          {layoutImageUrl ? (
            <div
              className="relative border border-gray-200 rounded-xl overflow-hidden mx-auto shadow-lg"
              style={{
                width: '100%',
                maxWidth: '800px',
                cursor: isDrawing ? 'crosshair' : 'default'
              }}
            >
              <img
                ref={imageRef}
                src={layoutImageUrl}
                alt="Store Layout"
                className="block w-full h-auto"
                onClick={handleImageClickForDrawing}
                onLoad={(e) => {
                  e.currentTarget.dataset.naturalWidth = e.currentTarget.naturalWidth;
                  e.currentTarget.dataset.naturalHeight = e.currentTarget.naturalHeight;
                }}
              />
              <svg
                className="absolute top-0 left-0 w-full h-full" 
                viewBox={`0 0 ${imageNaturalWidth} ${imageNaturalHeight}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ pointerEvents: isDrawing ? 'none' : 'auto' }} 
              >
                {(floorplanData.zones || []).map(zone => (
                  <polygon
                    key={zone.id}
                    points={zone.points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill={hoveredZoneInfo?.id === zone.id ? (zone.color || "#FF0000") : (zone.color || "#FF0000")}
                    fillOpacity={hoveredZoneInfo?.id === zone.id ? 0.5 : 0.3} 
                    stroke={zone.color || "#FF0000"}
                    strokeWidth={hoveredZoneInfo?.id === zone.id ? 2 : 1} 
                    onMouseEnter={(e) => handleZoneMouseEnter(e, zone)}
                    onMouseLeave={handleZoneMouseLeave}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  />
                ))}
                {isDrawing && currentDrawingTool === 'zone' && currentDrawingPoints.length > 0 && (
                  <polygon
                    points={currentDrawingPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="rgba(255, 165, 0, 0.3)" 
                    stroke="orange"
                    strokeWidth="2" 
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {isDrawing && currentDrawingPoints.map((point, index) => (
                  <circle 
                    key={`drawing-point-${index}`} 
                    cx={point.x} 
                    cy={point.y} 
                    r="3" 
                    fill="orange" 
                    style={{ pointerEvents: 'none' }}
                  />
                ))}
              </svg>
              {hoveredZoneInfo && (
                <div 
                  className="absolute bg-gray-900 text-white text-xs p-3 rounded-lg shadow-xl pointer-events-none z-10"
                  style={{ 
                    left: `${hoveredZoneInfo.x}px`, 
                    top: `${hoveredZoneInfo.y}px`, 
                    transform: 'translateY(-100%)',
                    backdropFilter: 'blur(4px)'
                  }} 
                >
                  <div className="font-semibold mb-1">{hoveredZoneInfo.name}</div>
                  <div className="flex items-center text-gray-300">
                    <Calendar className="h-3 w-3 mr-1" />
                    Activity ({activityPeriodFilter.replace('_', ' ')}): {hoveredZoneInfo.score}
                  </div>
                </div>
              )}
            </div>
          ) : (
            !isLoading && !error && currentDirectoryForDisplay && (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <p className="text-gray-500">Base floorplan image (base_floorplan.png/jpg) not found for this project. Please upload one via "Configure Floorplan".</p>
              </div>
            )
          )}

          {isDrawing && currentDrawingTool === 'zone' && currentDrawingPoints.length >= 3 && (
            <div className="mt-6 p-6 border rounded-xl bg-white shadow-md space-y-4 max-w-md mx-auto">
              <h4 className="text-lg font-semibold text-gray-900">Finalize Zone Details</h4>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="zoneNameInput" className="text-sm font-medium text-gray-700">Zone Name</Label>
                  <Input 
                    id="zoneNameInput"
                    type="text" 
                    value={newZoneName} 
                    onChange={(e) => setNewZoneName(e.target.value)}
                    placeholder="Enter zone name"
                    className="mt-1" 
                  />
                </div>
                <div>
                  <Label htmlFor="zoneColorInput" className="text-sm font-medium text-gray-700">Zone Color</Label>
                  <div className="mt-1 flex items-center space-x-2">
                    <Input 
                      id="zoneColorInput"
                      type="color" 
                      value={newZoneColor} 
                      onChange={(e) => setNewZoneColor(e.target.value)}
                      className="w-12 h-8 p-1" 
                    />
                    <span className="text-sm text-gray-500">Click to choose a color</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-gray-900">Defined Zones</CardTitle>
        </CardHeader>
        <CardContent>
          {(floorplanData.zones || []).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No zones defined yet. Start by drawing a zone on the floorplan above.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {(floorplanData.zones || []).map(zone => (
                <div 
                  key={zone.id} 
                  className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-100 hover:border-indigo-200 transition-colors group"
                >
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-4 h-4 rounded-full border border-gray-200"
                      style={{ backgroundColor: zone.color || '#FF0000' }}
                    />
                    <span className="font-medium text-gray-900">{zone.name}</span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleDeleteZone(zone.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
