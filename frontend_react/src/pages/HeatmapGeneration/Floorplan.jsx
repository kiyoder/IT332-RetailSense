import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {useAuth} from "@/AuthContext.jsx";
import axios from 'axios';
import { toast } from 'sonner';
import { Camera, RefreshCw, ArrowRight, MapPin, Video, AlertCircle } from 'lucide-react';


export default function FloorplanPage() {
  const { directory } = useParams(); // This is the video-specific directory (e.g., user-id_timestamp)
  const location = useLocation();
  const navigate = useNavigate();
  const { user, getSession } = useAuth(); // user.id will be used for central assets
  
  const [baseFloorplanImage, setBaseFloorplanImage] = useState(null);
  const [floorplanLayout, setFloorplanLayout] = useState({ zones: [], aisles: [] });
  const [corners, setCorners] = useState([]);
  const [currentCorner, setCurrentCorner] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [isLoadingBaseFloorplan, setIsLoadingBaseFloorplan] = useState(true);
  const [isLoadingVideoFrame, setIsLoadingVideoFrame] = useState(true); // Will always start true for video frame
  const [videoFirstFrameUrl, setVideoFirstFrameUrl] = useState(null); // Initialize to null, always fetch
  
  const imageRef = useRef(null); // This ref is for the INTERACTIVE base floorplan image
  
  const cornerLabels = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];
  const cornerColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];
  
  // Refs for workaround
  const prevVideoDirRef = useRef(null);
  const prevUserIdRef = useRef(null);
  const currentBaseFloorplanObjectUrlRef = useRef(null);
  const currentVideoFrameObjectUrlRef = useRef(null);
  const initialFetchAttemptedForCurrentIdsRef = useRef(false);

  useEffect(() => {
    const currentVideoDir = directory;
    const currentUserId = user?.id;

    const revokeUrls = () => {
      if (currentBaseFloorplanObjectUrlRef.current) {
        URL.revokeObjectURL(currentBaseFloorplanObjectUrlRef.current);
        currentBaseFloorplanObjectUrlRef.current = null;
      }
      if (currentVideoFrameObjectUrlRef.current) {
        URL.revokeObjectURL(currentVideoFrameObjectUrlRef.current);
        currentVideoFrameObjectUrlRef.current = null;
      }
    };

    if (!currentVideoDir || !currentUserId) {
      setError('Directory or User ID missing. Cannot load floorplan data.');
      revokeUrls();
      setBaseFloorplanImage(null);
      setVideoFirstFrameUrl(null);
      setIsLoadingBaseFloorplan(true); // Reset loading states
      setIsLoadingVideoFrame(true);
      setFloorplanLayout({ zones: [], aisles: [] }); // Reset layout too
      prevVideoDirRef.current = null; // Reset refs
      prevUserIdRef.current = null;
      initialFetchAttemptedForCurrentIdsRef.current = false; // Reset fetch attempt flag
      return;
    }

    const directoryOrUserChanged = currentVideoDir !== prevVideoDirRef.current || currentUserId !== prevUserIdRef.current;

    if (directoryOrUserChanged) {
      // console.log(`Floorplan.jsx: Directory or User changed. Resetting states.`);
      setError('');
      revokeUrls();
      setBaseFloorplanImage(null);
      setFloorplanLayout({ zones: [], aisles: [] });
      setIsLoadingBaseFloorplan(true);
      setIsLoadingVideoFrame(true); // Always true on directory change as we will fetch
      setVideoFirstFrameUrl(null); // Always reset to null to trigger fetch for the new directory
      initialFetchAttemptedForCurrentIdsRef.current = false; // Reset this flag to ensure fetch happens
      // prevVideoDirRef and prevUserIdRef will be updated after successful fetch attempt
    } else if (initialFetchAttemptedForCurrentIdsRef.current) {
      // Directory and user are the same, and an initial fetch has been attempted.
      // Only proceed if essential data is still missing.
      const essentialBaseDataMissing = !baseFloorplanImage;
      const essentialVideoFrameMissing = !videoFirstFrameUrl && !(location.state?.firstFrame && location.state?.directory === currentVideoDir);
      if (!essentialBaseDataMissing && !essentialVideoFrameMissing ) {
        // console.log("Floorplan.jsx: Skipping fetch. IDs same, fetch attempted, and essential data present.");
        return;
      }
      // console.log("Floorplan.jsx: Same IDs, fetch attempted, but essential data missing. Proceeding to fetch.");
    }


    const fetchInitialDataInternal = async (videoDir, userId) => {
      setError(''); 
      setIsLoadingBaseFloorplan(true); // Reset for base floorplan fetch
      setIsLoadingVideoFrame(true); // Reset for video frame fetch
      try {
        if (!userId) {
          setError('Authentication required: User ID not found.');
          return;
        }

        const session = await getSession();
        const accessToken = session?.access_token;

        if (!accessToken) {
          setError('Authentication required: Access token not found.');
          return;
        }

        // 1. Fetch base_floorplan.png or .jpg (from central assets using userId)
        try {
          const baseImageResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/files/${userId}/base_floorplan.png`,
            { responseType: 'blob', headers: { 'Authorization': `Bearer ${accessToken}` } }
          ).catch(async (err) => {
            if (err.response?.status === 404) {
              return axios.get(
                `${import.meta.env.VITE_API_URL}/files/${userId}/base_floorplan.jpg`,
                { responseType: 'blob', headers: { 'Authorization': `Bearer ${accessToken}` } }
              );
            }
            throw err;
          });
          const newBaseUrl = URL.createObjectURL(baseImageResponse.data);
          currentBaseFloorplanObjectUrlRef.current = newBaseUrl;
          setBaseFloorplanImage(newBaseUrl);
          setIsLoadingBaseFloorplan(false);
        } catch (err) {
           console.error('Error fetching base floorplan:', err);
           setError('Base floorplan image (base_floorplan.png/jpg) not found. Please upload one via "Configure Floorplan".');
           setIsLoadingBaseFloorplan(false);
        }


        // 2. Fetch floorplan layout (zones and aisles) (from central assets using userId)
        try {
          const layoutResponse = await axios.get(
            `${import.meta.env.VITE_API_URL}/api/floorplan/${userId}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          setFloorplanLayout(layoutResponse.data || { zones: [], aisles: [] });
        } catch (err) {
          console.warn("Could not fetch floorplan layout for POV setup:", err.message);
        }

        // 3. Fetch video's first frame (layout.jpg)
        // This is from the video-specific directory (videoDir).
        // We always try to fetch it if videoFirstFrameUrl is not already set (which it won't be on initial load or dir change)
        if (!videoFirstFrameUrl && videoDir) { // Check if videoFirstFrameUrl is already set
          try {
              const firstFrameResponse = await axios.get(
                `${import.meta.env.VITE_API_URL}/files/${videoDir}/layout.jpg`,
                { responseType: 'blob', headers: { 'Authorization': `Bearer ${accessToken}` } }
              );
              const newVideoFrameUrl = URL.createObjectURL(firstFrameResponse.data);
              currentVideoFrameObjectUrlRef.current = newVideoFrameUrl;
              setVideoFirstFrameUrl(newVideoFrameUrl);
              setIsLoadingVideoFrame(false);
          } catch (err) {
              console.error("Error fetching video's first frame:", err);
              setError(prevError => prevError ? `${prevError}\nVideo's first frame (layout.jpg) not found. Ensure video processing has started.` : "Video's first frame (layout.jpg) not found. Ensure video processing has started.");
              setIsLoadingVideoFrame(false);
          }
        } else if (videoFirstFrameUrl) { // If it was somehow already set (e.g. from a previous successful fetch for same dir)
            setIsLoadingVideoFrame(false); // Ensure loading is false
        }
        prevVideoDirRef.current = videoDir;
        prevUserIdRef.current = userId;
        initialFetchAttemptedForCurrentIdsRef.current = true; // Mark that fetch has been attempted

      } catch (error) { 
        console.error('Error fetching initial data for floor plan POV setup:', error);
        setError(prevError => prevError ? `${prevError}\nAn unexpected error occurred while fetching data.` : 'An unexpected error occurred while fetching data.');
      } finally {
        // Ensure loading states are false if not already set by specific fetches
        if (isLoadingBaseFloorplan) setIsLoadingBaseFloorplan(false);
        if (isLoadingVideoFrame) setIsLoadingVideoFrame(false);
      }
    };
    
    fetchInitialDataInternal(currentVideoDir, currentUserId);

    return () => {
      revokeUrls();
    };
  }, [directory, user?.id, getSession]); // location.state removed as direct source for videoFirstFrameUrl
  
  const handleImageClick = (e) => {
    if (currentCorner >= 4 || !imageRef.current) return;
    
    const interactiveImageElement = imageRef.current;

    const rect = interactiveImageElement.getBoundingClientRect();
    const scaleX = interactiveImageElement.naturalWidth / rect.width;
    const scaleY = interactiveImageElement.naturalHeight / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    
    const newCorners = [...corners];
    newCorners[currentCorner] = { x, y };
    setCorners(newCorners);
    setCurrentCorner(currentCorner + 1);
  };
  
  const resetCorners = () => {
    setCorners([]);
    setCurrentCorner(0);
    setError('');
    toast.info("Corner selection reset.");
  };

  const saveCornersAndProcess = async () => {
    if (corners.length !== 4) {
      setError('Please select all 4 corners.');
      toast.error('Please select all 4 corners.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (!user?.id) {
        setError('Authentication required: User ID not found.');
        toast.error('Authentication required: User ID not found.');
        setSaving(false);
        return;
      }

      const session = await getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setError('Authentication required: Access token not found.');
        toast.error('Authentication required: Access token not found.');
        setSaving(false);
        return;
      }

      // Save the corner coordinates to the user's central assets directory
      await axios.post(
          `${import.meta.env.VITE_API_URL}/api/corners/${user.id}`,
          { coordinates: corners },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
      );
      toast.success("Perspective corners saved successfully!");

      // Start processing for the specific video (directory)
      await axios.post(
          `${import.meta.env.VITE_API_URL}/api/process/${directory}`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
      );
      toast.info("Video processing initiated.");
      navigate(`/heatmap/${directory}`);

    } catch (error) {
      console.error('Error saving corners or starting processing:', error);
      const errorMsg = error.response?.data?.detail || 'Error saving corners or starting processing.';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="w-full max-w-6xl mx-auto border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2">
            <Camera className="h-8 w-8 text-indigo-600" />
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Set Camera Point of View
            </CardTitle>
          </div>
          <CardDescription className="text-base mt-2">
            Click the 4 points on your base floorplan that correspond to the camera's view. Use the video's first frame as a reference.
            <br />
            <span className="font-medium text-indigo-600">Order: Top-Left → Top-Right → Bottom-Right → Bottom-Left</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 items-center">
            {/* Interactive Base Floorplan Image */}
            <div className="w-full max-w-3xl">
              <div className="bg-white rounded-xl shadow-md border-2 border-indigo-500 p-4">
                <h3 className="text-lg font-semibold mb-3 text-center flex items-center justify-center space-x-2">
                  <MapPin className="h-5 w-5 text-indigo-600" />
                  <span>Your Base Floorplan</span>
                  <span className="text-sm font-normal text-indigo-600">(Click to set POV points)</span>
                </h3>
                {baseFloorplanImage ? (
                  <div className="relative group">
                    <img 
                      ref={imageRef}
                      src={baseFloorplanImage} 
                      alt="Your Base Floorplan" 
                      className="w-full h-auto block rounded-lg cursor-crosshair transition-transform duration-200 group-hover:scale-[1.01]" 
                      onClick={handleImageClick}
                    />
                    {/* SVG Overlay for zones and aisles */}
                    <svg 
                      className="absolute top-0 left-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${imageRef.current?.naturalWidth || 100} ${imageRef.current?.naturalHeight || 100}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {floorplanLayout.zones.map(zone => (
                        <polygon
                          key={`zone-${zone.id}`}
                          points={zone.points.map(p => `${p.x},${p.y}`).join(' ')}
                          fill={zone.color || "#FF0000"}
                          fillOpacity="0.2"
                          stroke={zone.color || "#FF0000"}
                          strokeWidth="1"
                        />
                      ))}
                      {floorplanLayout.aisles.map(aisle => (
                        <polyline
                          key={`aisle-${aisle.id}`}
                          points={aisle.points.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke="#007bff"
                          strokeWidth="2"
                        />
                      ))}
                    </svg>
                    
                    {/* Display selected corners */}
                    {corners.map((corner, index) => (
                      <div 
                        key={index}
                        className="absolute w-4 h-4 rounded-full border-2 border-white shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                        style={{ 
                          left: `${(corner.x / (imageRef.current?.naturalWidth || 1)) * 100}%`,
                          top: `${(corner.y / (imageRef.current?.naturalHeight || 1)) * 100}%`,
                          backgroundColor: cornerColors[index]
                        }}
                      >
                        <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs font-bold whitespace-nowrap bg-black bg-opacity-75 text-white px-2 py-1 rounded-full shadow-md">
                          {cornerLabels[index]}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : isLoadingBaseFloorplan ? (
                  <div className="flex items-center justify-center py-12 space-x-2 text-gray-600">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    <span>Loading base floorplan...</span>
                  </div>
                ) : error && (error.includes('Base floorplan image') || error.includes('base_floorplan.png/jpg')) ? (
                  <div className="flex items-center justify-center py-12 space-x-2 text-red-600 bg-red-50 rounded-lg">
                    <AlertCircle className="h-5 w-5" />
                    <span>{error}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12 space-x-2 text-gray-600">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    <span>Loading base floorplan...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Reference Video Frame Image */}
            <div className="w-full max-w-3xl">
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
                <h3 className="text-lg font-semibold mb-3 text-center flex items-center justify-center space-x-2">
                  <Video className="h-5 w-5 text-gray-600" />
                  <span>Video's First Frame</span>
                  <span className="text-sm font-normal text-gray-500">(Reference Only)</span>
                </h3>
                {videoFirstFrameUrl ? (
                  <img 
                    src={videoFirstFrameUrl} 
                    alt="Video First Frame" 
                    className="w-full h-auto block rounded-lg shadow-sm" 
                  />
                ) : isLoadingVideoFrame ? (
                  <div className="flex items-center justify-center py-12 space-x-2 text-gray-600">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    <span>Loading video frame...</span>
                  </div>
                ) : error && (error.includes("Video's first frame") || error.includes("layout.jpg")) ? (
                  <div className="flex items-center justify-center py-12 space-x-2 text-red-600 bg-red-50 rounded-lg">
                    <AlertCircle className="h-5 w-5" />
                    <span>{error}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12 space-x-2 text-gray-600">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    <span>Loading video frame...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4 bg-gray-50 p-4 rounded-lg">
            <div className="flex-1">
              {currentCorner < 4 ? (
                <p className="font-medium text-gray-900">
                  Click to select the{' '}
                  <span className="font-bold" style={{color: cornerColors[currentCorner]}}>
                    {cornerLabels[currentCorner]}
                  </span>{' '}
                  corner on your Base Floorplan
                </p>
              ) : (
                <p className="text-green-600 font-medium flex items-center space-x-2">
                  <span className="h-2 w-2 bg-green-500 rounded-full"></span>
                  <span>All 4 corners selected! Ready to process.</span>
                </p>
              )}
            </div>
            <div className="flex space-x-3">
              <Button 
                variant="outline" 
                onClick={resetCorners}
                className="flex items-center space-x-2"
                disabled={saving}
              >
                <RefreshCw className="h-4 w-4" />
                <span>Reset Corners</span>
              </Button>
            </div>
          </div>
          
          {error && !error.includes('Base floorplan image') && !error.includes("Video's first frame") && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center space-x-2">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition-all duration-200"
            onClick={saveCornersAndProcess}
            disabled={corners.length !== 4 || saving || !baseFloorplanImage}
          >
            {saving ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Saving & Processing...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <span>Save Corners & Start Processing</span>
                <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
