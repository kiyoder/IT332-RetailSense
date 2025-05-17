import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useSupabaseClient } from '@supabase/auth-helpers-react';
import axios from 'axios';

export default function FloorplanPage() {
  const { directory } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const supabase = useSupabaseClient();
  
  const [firstFrame, setFirstFrame] = useState(location.state?.firstFrame || null);
  const [corners, setCorners] = useState([]);
  const [currentCorner, setCurrentCorner] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  
  const imageRef = useRef(null);
  
  const cornerLabels = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];
  const cornerColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];
  
  useEffect(() => {
    // If we don't have the first frame from location state, try to fetch it
    if (!firstFrame && directory) {
      fetchFirstFrame();
    }
  }, [directory, firstFrame]);
  
  const fetchFirstFrame = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Authentication required');
        return;
      }
      
      // Fetch the status to get the layout image URL
      const response = await axios.get(
        `${import.meta.env.VITE_API_URL}/api/status/${directory}`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        }
      );
      
      // If we have a layout image, set it
      if (response.data.layout_url) {
        setFirstFrame(response.data.layout_url);
      } else {
        setError('Could not find floor plan image');
      }
    } catch (error) {
      console.error('Error fetching floor plan:', error);
      setError('Error fetching floor plan');
    }
  };
  
  const handleImageClick = (e) => {
    if (currentCorner >= 4) return;
    
    // Get click coordinates relative to the image
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    
    // Add the new corner
    const newCorners = [...corners];
    newCorners[currentCorner] = { x, y };
    setCorners(newCorners);
    
    // Move to the next corner
    setCurrentCorner(currentCorner + 1);
  };
  
  const resetCorners = () => {
    setCorners([]);
    setCurrentCorner(0);
  };
  
  const saveCorners = async () => {
    if (corners.length !== 4) {
      setError('Please select all 4 corners');
      return;
    }
    
    try {
      setSaving(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Authentication required');
        setSaving(false);
        return;
      }
      
      // Save the corner coordinates
      await axios.post(
        `${import.meta.env.VITE_API_URL}/api/corners/${directory}`,
        { coordinates: corners },
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        }
      );
      
      // Start processing
      await axios.post(
        `${import.meta.env.VITE_API_URL}/api/process/${directory}`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        }
      );
      
      // Navigate to the heatmap page
      navigate(`/heatmap/${directory}`);
      
    } catch (error) {
      console.error('Error saving corners:', error);
      setError(error.response?.data?.detail || 'Error saving corner coordinates');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="container mx-auto py-8">
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Select Floor Plan Corners</CardTitle>
          <CardDescription>
            Click on the 4 corners of the floor plan in this order: Top-Left, Top-Right, Bottom-Right, Bottom-Left
          </CardDescription>
        </CardHeader>
        <CardContent>
          {firstFrame ? (
            <div className="relative">
              <img 
                ref={imageRef}
                src={firstFrame} 
                alt="Floor Plan" 
                className="w-full cursor-crosshair"
                onClick={handleImageClick}
              />
              
              {/* Display selected corners */}
              {corners.map((corner, index) => (
                <div 
                  key={index}
                  className="absolute w-4 h-4 rounded-full -translate-x-2 -translate-y-2"
                  style={{ 
                    left: `${corner.x}px`, 
                    top: `${corner.y}px`,
                    backgroundColor: cornerColors[index]
                  }}
                >
                  <div className="absolute top-4 left-4 text-xs font-bold whitespace-nowrap">
                    {cornerLabels[index]} ({corner.x}, {corner.y})
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center text-red-500 py-8">{error}</div>
          ) : (
            <div className="text-center py-8">Loading floor plan...</div>
          )}
          
          <div className="mt-4 flex justify-between items-center">
            <div>
              {currentCorner < 4 ? (
                <p>Select the {cornerLabels[currentCorner]} corner</p>
              ) : (
                <p className="text-green-500">All corners selected!</p>
              )}
            </div>
            <div>
              <Button 
                variant="outline" 
                onClick={resetCorners}
                className="mr-2"
              >
                Reset
              </Button>
            </div>
          </div>
          
          {error && (
            <div className="mt-2 text-red-500 text-sm">{error}</div>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            className="w-full" 
            onClick={saveCorners}
            disabled={corners.length !== 4 || saving}
          >
            {saving ? 'Processing...' : 'Generate Heatmap'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
