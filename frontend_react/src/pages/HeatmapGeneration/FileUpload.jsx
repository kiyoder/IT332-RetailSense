import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom'; // Added Link
import { Button, Label, Input } from '@/components/ui'; // Added Label, Input
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../../AuthContext.jsx'
import axios from 'axios';
import { toast } from 'sonner'; // Assuming you use sonner for toasts
import { UploadCloud, Video, Clock, Calendar, ArrowRight, FileVideo, CheckCircle2 } from 'lucide-react';


export default function FileUploadPage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordingDate, setRecordingDate] = useState(''); // New state for recording date
  const [recordingTime, setRecordingTime] = useState(''); // New state for recording time
  const [error, setError] = useState('');
  const [recentUploads, setRecentUploads] = useState([]);
  const [isLoadingUploads, setIsLoadingUploads] = useState(false);
  const navigate = useNavigate();
  const { user, getSession } = useAuth();

  const prevUserIdForEffectRef = useRef(null);
  const hasFetchedInitialUploadsRef = useRef(false);
  const fetchTimeoutRef = useRef(null); // For the delayed refresh after upload

  // Function to fetch recent uploads
  // isInitialUserFetch: true if this is the first fetch for this user session (updates refs)
  //                    false if it's just a refresh (e.g., after upload, only updates data)
  const performFetchRecentUploads = async (isInitialUserFetch = false) => {
    const currentUserId = user?.id;
    // console.log(`performFetchRecentUploads called. User: ${currentUserId}, isInitialUserFetch: ${isInitialUserFetch}, isLoading: ${isLoadingUploads}`);

    if (!currentUserId) {
      setRecentUploads([]);
      setIsLoadingUploads(false);
      if (isInitialUserFetch) { // Only reset these if it was meant to be an initial fetch
        hasFetchedInitialUploadsRef.current = false;
        prevUserIdForEffectRef.current = null;
      }
      return;
    }

    // Prevent concurrent fetches
    if (isLoadingUploads) {
      // console.log("performFetchRecentUploads: Already loading, skipping.");
      return;
    }

    setIsLoadingUploads(true);
    try {
      const session = await getSession();
      if (!session) {
        setIsLoadingUploads(false);
        return;
      }
      const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/user/uploads?limit=5`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      // console.log("Fetched uploads data:", response.data);
      setRecentUploads(response.data || []);

      if (isInitialUserFetch) {
        hasFetchedInitialUploadsRef.current = true;
        prevUserIdForEffectRef.current = currentUserId;
      }
    } catch (err) {
      console.error("Error fetching recent uploads:", err);
      toast.error("Could not load recent uploads.");
    }
    setIsLoadingUploads(false);
  };

  // useEffect for initial load and user changes
  useEffect(() => {
    // console.log("useEffect for initial load/user change running. User ID:", user?.id);
    // Clear any pending post-upload refresh if user changes or component re-initializes
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
      // console.log("useEffect: Cleared pending post-upload refresh timeout.");
    }

    const currentUserId = user?.id;

    if (!currentUserId) {
      setRecentUploads([]);
      setIsLoadingUploads(false);
      hasFetchedInitialUploadsRef.current = false;
      prevUserIdForEffectRef.current = null;
      return;
    }

    const isNewUserSession = currentUserId !== prevUserIdForEffectRef.current;

    if (isNewUserSession) {
      // console.log("useEffect: New user session or first time for this user. Resetting flags.");
      setRecentUploads([]); // Clear data from any previous user
      hasFetchedInitialUploadsRef.current = false; // Mark that we need to fetch for this new user
    }

    // Fetch immediately if it's the initial load for this user session
    if (!hasFetchedInitialUploadsRef.current) {
      // console.log("useEffect: Triggering initial fetch for user:", currentUserId);
      performFetchRecentUploads(true); // Pass true to indicate it's an initial fetch for this user
    }

    // Cleanup for the timeout that might be set by handleUpload
    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
        // console.log("useEffect cleanup: Cleared post-upload refresh timeout.");
      }
    };
  }, [user?.id, getSession]); // Dependencies: only user and getSession

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type !== 'video/mp4') {
      setError('Only .mp4 files are allowed');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setError('');
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type !== 'video/mp4') {
      setError('Only .mp4 files are allowed');
      return;
    }
    setFile(droppedFile);
    setError('');
  };

  const handleUpload = async () => {
    // console.log('Upload initiated. User:', user);
    if (!file) {
      setError('Please select a file to upload');
      return;
    }
    if (!user) {
      setError('Authentication required');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError('');

    try {
      const session = await getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError('Authentication required');
        setUploading(false);
        return;
      }
      
      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      if (recordingDate && recordingTime) {
        formData.append('recording_timestamp', `${recordingDate}T${recordingTime}`);
      }
      
      // Upload file with progress tracking
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/upload`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total || file.size)
            );
            setUploadProgress(percentCompleted);
          }
        }
      );
      
      // console.log(`File '${file.name}' uploaded successfully! Directory: ${response.data.directory}`);
      toast.success(`File '${file.name}' uploaded successfully! Ready to set POV.`);
      setFile(null); 
      setRecordingDate(''); // Reset date/time fields
      setRecordingTime('');
      
      // Explicitly schedule the delayed refresh
      if (user) {
        // Clear any existing refresh timeout before setting a new one
        if (fetchTimeoutRef.current) {
          clearTimeout(fetchTimeoutRef.current);
          // console.log("handleUpload: Cleared existing refresh timeout.");
        }
        toast.info("Refreshing uploads list in 2 seconds...");
        // console.log("handleUpload: Scheduling delayed refresh (2s).");
        fetchTimeoutRef.current = setTimeout(() => {
          // console.log("handleUpload: 5s timeout fired. Calling performFetchRecentUploads(false).");
          performFetchRecentUploads(false); // Pass false, as this is a refresh, not an initial user fetch
        }, 2000); // Changed from 5000 to 2000
      }
      
    } catch (error) {
      console.error('Upload error:', error);
      const errorMsg = error.response?.data?.detail || 'Error uploading file';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setUploading(false);
    }
  };

  // Helper function to determine the display name for an upload
  const getUploadDisplayName = (upload) => {
    if (upload.original_filename && 
        upload.original_filename.trim() !== "" && 
        upload.original_filename.toLowerCase() !== "unknown" &&
        upload.original_filename.toLowerCase() !== "untitled") { // Add any other placeholder names if needed
      return upload.original_filename;
    }
    if (upload.actual_recording_timestamp) { // Prioritize actual recording time for display name
        try {
            return `Recording from ${new Date(upload.actual_recording_timestamp).toLocaleDateString()} ${new Date(upload.actual_recording_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } catch (e) { /* Fall through if parsing fails */ }
    }
    if (upload.upload_timestamp) {
      try {
        return `Upload from ${new Date(upload.upload_timestamp).toLocaleDateString()} ${new Date(upload.upload_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } catch (e) {
        return "Unnamed Upload (Invalid Date)"; // Fallback if timestamp is invalid
      }
    }
    return "Unnamed Upload"; // Ultimate fallback
  };
  return (
    <div className="container mx-auto py-8 px-4 space-y-8 max-w-6xl">
      <Card className="w-full max-w-2xl mx-auto border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2">
            <Video className="h-8 w-8 text-indigo-600" />
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Upload CCTV Footage
            </CardTitle>
          </div>
          <CardDescription className="text-base mt-2">
            Upload your .mp4 CCTV footage to generate a heatmap. Drag and drop or click to select your file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div 
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
              error 
                ? 'border-red-500 bg-red-50' 
                : 'border-gray-300 hover:border-indigo-500 hover:bg-indigo-50'
            }`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept=".mp4"
              onChange={handleFileChange}
            />
            <label 
              htmlFor="file-upload"
              className="cursor-pointer block"
            >
              {file ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center space-x-2">
                    <FileVideo className="h-8 w-8 text-indigo-600" />
                    <p className="text-lg font-medium text-gray-900">{file.name}</p>
                  </div>
                  <p className="text-sm text-gray-500">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <UploadCloud className="h-12 w-12 text-gray-400 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-lg font-medium text-gray-900">Drag and drop your file here</p>
                    <p className="text-sm text-gray-500">or click to browse</p>
                  </div>
                </div>
              )}
            </label>
          </div>
          
          {/* Recording Date and Time Inputs */}
          {file && !uploading && (
            <div className="mt-6 space-y-4 bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600 flex items-center space-x-2">
                <Clock className="h-4 w-4" />
                <span>Optional: Specify actual recording start date and time</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="recordingDate" className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4" />
                    <span>Recording Date</span>
                  </Label>
                  <Input 
                    type="date" 
                    id="recordingDate" 
                    value={recordingDate} 
                    onChange={(e) => setRecordingDate(e.target.value)}
                    className="w-full" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recordingTime" className="flex items-center space-x-2">
                    <Clock className="h-4 w-4" />
                    <span>Recording Time</span>
                  </Label>
                  <Input 
                    type="time" 
                    id="recordingTime" 
                    value={recordingTime} 
                    onChange={(e) => setRecordingTime(e.target.value)}
                    className="w-full" 
                  />
                </div>
              </div>
            </div>
          )}
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center space-x-2">
              <span className="text-red-500">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          
          {uploading && (
            <div className="mt-6 space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all duration-300 ease-out" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="text-sm text-center text-gray-600">
                {uploadProgress}% Uploaded
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition-all duration-200"
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Uploading...</span>
              </div>
            ) : (
              'Upload Video'
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Recent Uploads Section */}
      {user && (
        <Card className="w-full max-w-4xl mx-auto border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
          <CardHeader className="space-y-1">
            <div className="flex items-center space-x-2">
              <FileVideo className="h-8 w-8 text-indigo-600" />
              <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Recent Video Uploads
              </CardTitle>
            </div>
            <CardDescription className="text-base mt-2">
              Manage and proceed with your recent video uploads
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingUploads && recentUploads.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              </div>
            )}
            {!isLoadingUploads && recentUploads.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No recent uploads found
              </div>
            )}
            {recentUploads.length > 0 && (
              <div className="grid gap-4">
                {recentUploads.map((upload) => (
                  <div 
                    key={upload.directory} 
                    className="bg-white rounded-lg border border-gray-200 hover:border-indigo-200 hover:shadow-md transition-all duration-200"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-grow space-y-2">
                          <Link 
                            to={`/floorplan/${upload.directory}`}
                            className="block hover:opacity-80 transition-opacity"
                          >
                            <h3 className="font-medium text-gray-900">
                              {getUploadDisplayName(upload)}
                            </h3>
                            <div className="mt-1 space-y-1">
                              <p className="text-sm text-gray-500">
                                Directory: {upload.directory}
                              </p>
                              <div className="flex items-center space-x-2 text-sm text-gray-500">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  upload.status === 'completed' ? 'bg-green-100 text-green-800' :
                                  upload.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                                  upload.status === 'error' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {upload.status || 'N/A'} ({upload.progress || 0}%)
                                </span>
                                <span>•</span>
                                <span>
                                  {upload.actual_recording_timestamp 
                                    ? `Recorded: ${new Date(upload.actual_recording_timestamp).toLocaleString()}`
                                    : `Uploaded: ${new Date(upload.upload_timestamp).toLocaleString()}`
                                  }
                                </span>
                              </div>
                            </div>
                          </Link>
                        </div>
                        
                        {(
                          (upload.status === 'uploaded' ||
                           upload.status === 'processing_completed_pending_pov' ||
                           (upload.status === 'processing' && upload.progress < 100) ||
                           upload.status === 'not_started' || 
                           upload.status === 'error') && 
                          upload.first_frame_url
                        ) && (
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition-all duration-200"
                            onClick={() => navigate(`/floorplan/${upload.directory}`)}
                          >
                            <span className="flex items-center space-x-2">
                              <span>Set Camera POV</span>
                              <ArrowRight className="h-4 w-4" />
                            </span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
