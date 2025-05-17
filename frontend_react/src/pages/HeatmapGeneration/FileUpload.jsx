import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../../AuthContext.jsx'
import axios from 'axios';


export default function FileUploadPage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user, getSession } = useAuth();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    
    // Validate file type
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
    
    // Validate file type
    if (droppedFile && droppedFile.type !== 'video/mp4') {
      setError('Only .mp4 files are allowed');
      return;
    }
    
    setFile(droppedFile);
    setError('');
  };

  const handleUpload = async () => {

    console.log('Upload initiated');
    console.log('Current user state:', user);

    if (!file) {
      console.log('No file selected');
      setError('Please select a file to upload');
      return;
    }

    if (!user) {
      console.log('No user found - redirecting to login');
      setError('Authentication required');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      // Get session for authentication
      console.log('Getting access token...');
      const session = await getSession();
      const accessToken = session?.access_token;
      // console.log('Access token:', accessToken ? '***' : 'NOT FOUND');
      // console.log('Token type:', typeof accessToken);
      // console.log('Token first 30 chars:', accessToken.substring(0, 30));
      // console.log('Token last 10 chars:', accessToken.substring(accessToken.length - 10));
      if (!accessToken) {
        // console.error('No access token found in user object');
        setError('Authentication required');
        setUploading(false);
        return;
      }
      
      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      
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
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setUploadProgress(percentCompleted);
          }
        }
      );
      
      // Navigate to floor plan page with directory info
      navigate(`/floorplan/${response.data.directory}`, { 
        state: { 
          firstFrame: response.data.first_frame,
          directory: response.data.directory
        } 
      });
      
    } catch (error) {
      console.error('Upload error:', error);
      setError(error.response?.data?.detail || 'Error uploading file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Upload CCTV Footage</CardTitle>
          <CardDescription>
            Upload your .mp4 CCTV footage to generate a heatmap
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div 
            className={`border-2 border-dashed rounded-lg p-8 text-center ${
              error ? 'border-red-500' : 'border-gray-300 hover:border-primary'
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
              className="cursor-pointer text-primary hover:text-primary-dark"
            >
              {file ? (
                <div>
                  <p className="text-lg font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-lg">Drag and drop your file here</p>
                  <p className="text-sm text-gray-500">or click to browse</p>
                </div>
              )}
            </label>
          </div>
          
          {error && (
            <div className="mt-2 text-red-500 text-sm">{error}</div>
          )}
          
          {uploading && (
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-primary h-2.5 rounded-full" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="text-sm text-center mt-1">
                {uploadProgress}% Uploaded
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button 
            className="w-full" 
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
