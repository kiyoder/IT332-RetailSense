import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from '@/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import { UploadCloud, MapPin, Shapes, Image, ArrowRight } from 'lucide-react';

export default function FloorplanConfigPage() {
  const { getSession, user } = useAuth();
  const navigate = useNavigate();

  const [baseFloorplanFile, setBaseFloorplanFile] = useState(null);
  const [isUploadingBaseFloorplan, setIsUploadingBaseFloorplan] = useState(false);
  const [baseFloorplanUploadError, setBaseFloorplanUploadError] = useState('');
  const [existingFloorplanUrl, setExistingFloorplanUrl] = useState(null);
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);

  // Refs to manage fetching state and object URL lifecycle
  const prevUserIdRef = useRef(null);
  const currentObjectUrlRef = useRef(null);

  useEffect(() => {
    const currentUserId = user?.id;

    // Function to revoke the current object URL if it exists
    const revokePreviousUrl = () => {
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }
    };

    // If user ID is not available (e.g., logged out)
    if (!currentUserId) {
      revokePreviousUrl();
      setExistingFloorplanUrl(null);
      setIsLoadingExisting(false);
      prevUserIdRef.current = null; // Reset prev user ID
      return;
    }

    // WORKAROUND: If user ID hasn't changed and we already have a floorplan URL,
    // assume it's still valid to prevent re-fetch due to unstable getSession.
    if (currentUserId === prevUserIdRef.current && existingFloorplanUrl) {
      setIsLoadingExisting(false); // Ensure loading is false
      return;
    }

    // Proceed with fetching
    setIsLoadingExisting(true);
    revokePreviousUrl(); // Clean up any old URL before fetching a new one
    setExistingFloorplanUrl(null); // Clear current display while loading

    const fetchUserFloorplan = async () => {
      try {
        const session = await getSession(); // Call getSession
        if (!session) {
          setIsLoadingExisting(false);
          return;
        }

        let newUrl = null;
        try {
          const pngResponse = await axios.get(`${import.meta.env.VITE_API_URL}/files/${currentUserId}/base_floorplan.png`, { headers: { Authorization: `Bearer ${session.access_token}` }, responseType: 'blob' });
          newUrl = URL.createObjectURL(pngResponse.data);
        } catch (pngError) {
          if (pngError.response?.status === 404) {
            try {
              const jpgResponse = await axios.get(`${import.meta.env.VITE_API_URL}/files/${currentUserId}/base_floorplan.jpg`, { headers: { Authorization: `Bearer ${session.access_token}` }, responseType: 'blob' });
              newUrl = URL.createObjectURL(jpgResponse.data);
            } catch (jpgError) { /* Neither found */ }
          } else { /* Other error fetching PNG */ }
        }

        currentObjectUrlRef.current = newUrl;
        setExistingFloorplanUrl(newUrl);
        prevUserIdRef.current = currentUserId;

      } catch (error) { /* Error from getSession or unexpected */ }
      finally {
        setIsLoadingExisting(false);
      }
    };

    fetchUserFloorplan();

    // Cleanup function for when the component unmounts
    return () => {
      revokePreviousUrl();
    };
  }, [user?.id, getSession]);

  const onDropBaseFloorplan = useCallback(acceptedFiles => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      setBaseFloorplanFile(acceptedFiles[0]);
      setBaseFloorplanUploadError('');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropBaseFloorplan,
    accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] },
    multiple: false,
  });

  const handleBaseFloorplanUpload = async () => {
    if (!baseFloorplanFile) {
      setBaseFloorplanUploadError('Please select a base floorplan image (PNG or JPG).');
      return;
    }
    setIsUploadingBaseFloorplan(true);
    setBaseFloorplanUploadError('');
    try {
      const session = await getSession();
      if (!session || !user?.id) {
        setBaseFloorplanUploadError('Authentication required or user ID not found.');
        setIsUploadingBaseFloorplan(false);
        toast.error('Authentication required or user ID not found.');
        return;
      }
      const formData = new FormData();
      formData.append('file', baseFloorplanFile);

      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/project/base_floorplan`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      toast.success(`Base floorplan '${response.data.filename}' uploaded successfully!`);
      setBaseFloorplanFile(null);
      prevUserIdRef.current = null; // Force re-fetch by clearing the prevUserIdRef
                                    // The useEffect will then run fetchUserFloorplan again.
    } catch (err) {
      console.error('Error uploading base floorplan:', err);
      const msg = err.response?.data?.detail || 'Failed to upload base floorplan image.';
      setBaseFloorplanUploadError(msg);
      toast.error(msg);
    } finally {
      setIsUploadingBaseFloorplan(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-pulse rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="text-gray-600">Please log in to configure your floorplan.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-8 max-w-6xl">
      <Card className="border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2">
            <UploadCloud className="h-8 w-8 text-indigo-600" />
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Upload Base Floorplan Image
            </CardTitle>
          </div>
          <CardDescription className="text-base mt-2">
            Upload your store's 2D base floorplan image (.png, .jpg). This image will be the foundation for setting camera perspectives and defining zones/aisles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`p-12 border-2 border-dashed rounded-xl cursor-pointer text-center mb-6 transition-all duration-200
              ${isDragActive 
                ? 'border-indigo-500 bg-indigo-50 scale-[1.02]' 
                : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}
          >
            <input {...getInputProps()} />
            <div className="space-y-4">
              <div className="flex justify-center">
                <Image className="h-12 w-12 text-gray-400" />
              </div>
              {baseFloorplanFile ? (
                <div className="space-y-2">
                  <p className="text-gray-900 font-medium">Selected: {baseFloorplanFile.name}</p>
                  <p className="text-sm text-gray-500">Click or drag to change file</p>
                </div>
              ) : isDragActive ? (
                <p className="text-indigo-600 font-medium">Drop the image here ...</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-gray-900 font-medium">Drag 'n' drop a floorplan image here</p>
                  <p className="text-sm text-gray-500">or click to select file (PNG/JPG)</p>
                </div>
              )}
            </div>
          </div>

          {baseFloorplanUploadError && (
            <Alert variant="destructive" className="mb-6">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{baseFloorplanUploadError}</AlertDescription>
            </Alert>
          )}

          <Button 
            onClick={handleBaseFloorplanUpload} 
            disabled={!baseFloorplanFile || isUploadingBaseFloorplan} 
            className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition-all duration-200"
          >
            {isUploadingBaseFloorplan ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Uploading Floorplan...</span>
              </div>
            ) : (
              'Upload Base Floorplan'
            )}
          </Button>

          {isLoadingExisting && (
            <div className="mt-8 flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="text-gray-600">Loading existing floorplan...</p>
            </div>
          )}

          {!isLoadingExisting && existingFloorplanUrl && (
            <div className="mt-8 space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Current Base Floorplan</h3>
              <div className="relative w-full max-w-3xl mx-auto">
                <img 
                  src={existingFloorplanUrl} 
                  alt="Current Base Floorplan" 
                  className="w-full h-auto rounded-lg shadow-lg border border-gray-200" 
                />
              </div>
            </div>
          )}

          {!isLoadingExisting && !existingFloorplanUrl && (
            <Alert variant="info" className="mt-8">
              <AlertTitle>No Base Floorplan Set</AlertTitle>
              <AlertDescription>Upload a base floorplan image to proceed with configuration.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className={`border-none shadow-lg bg-gradient-to-br from-white to-gray-50 transition-all duration-200 ${!existingFloorplanUrl ? 'opacity-50' : 'hover:shadow-xl'}`}>
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2">
            <Shapes className="h-8 w-8 text-indigo-600" />
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Define Zones & Aisles
            </CardTitle>
          </div>
          <CardDescription className="text-base mt-2">
            Draw and label important zones and aisles on your base floorplan for detailed analytics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            asChild 
            className={`w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition-all duration-200 ${!existingFloorplanUrl ? 'cursor-not-allowed' : ''}`}
            disabled={!existingFloorplanUrl}
          >
            <Link to={`/floorplaneditor/${user.id}`} className="flex items-center justify-center space-x-2">
              <span>Go to Zone/Aisle Editor</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
