import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { ListChecks, Eye, Calendar, Clock, FolderOpen } from 'lucide-react';

export default function CompletedHeatmapsPage() {
  const [completedUploads, setCompletedUploads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user, getSession } = useAuth();

  const prevUserIdRef = useRef(null);

  const getUploadDisplayName = (upload) => {
    if (upload.original_filename && 
        upload.original_filename.trim() !== "" && 
        upload.original_filename.toLowerCase() !== "unknown" &&
        upload.original_filename.toLowerCase() !== "untitled") {
      return upload.original_filename;
    }
    if (upload.actual_recording_timestamp) {
        try {
            return `Recording from ${new Date(upload.actual_recording_timestamp).toLocaleDateString()} ${new Date(upload.actual_recording_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } catch (e) { /* Fall through */ }
    }
    if (upload.upload_timestamp) {
      try {
        return `Upload from ${new Date(upload.upload_timestamp).toLocaleDateString()} ${new Date(upload.upload_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } catch (e) {
        return "Unnamed Upload (Invalid Date)";
      }
    }
    return "Unnamed Upload";
  };

  useEffect(() => {
    const currentUserId = user?.id;

    if (!currentUserId) {
      setCompletedUploads([]);
      setIsLoading(false);
      setError('Please log in to view completed sessions.');
      prevUserIdRef.current = null;
      return;
    }

    if (currentUserId !== prevUserIdRef.current || completedUploads.length === 0) {
      setIsLoading(true);
      setError('');
      prevUserIdRef.current = currentUserId;

      const fetchCompletedUploads = async () => {
        try {
          const session = await getSession();
          if (!session) {
            throw new Error("Authentication session not found.");
          }
          const response = await axios.get(`${import.meta.env.VITE_API_URL}/api/user/completed_uploads`, {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
            params: { limit: 50 }
          });
          setCompletedUploads(response.data || []);
        } catch (err) {
          console.error("Error fetching completed uploads:", err);
          setError('Failed to load completed heatmap sessions.');
          toast.error('Failed to load completed sessions.');
          setCompletedUploads([]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchCompletedUploads();
    } else {
      setIsLoading(false);
    }
  }, [user?.id, getSession]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="text-gray-600">Loading your heatmap sessions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-6xl">
      <Card className="border-none shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="space-y-1">
          <div className="flex items-center space-x-2">
            <ListChecks className="h-8 w-8 text-indigo-600" />
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Completed Heatmap Sessions
            </CardTitle>
          </div>
          <CardDescription className="text-base">
            Browse and analyze your successfully processed video sessions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-600">{error}</p>
            </div>
          )}
          
          {completedUploads.length === 0 && !error && (
            <div className="text-center py-12">
              <FolderOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No completed heatmap sessions found</p>
            </div>
          )}

          {completedUploads.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {completedUploads.map((upload) => (
                <div
                  key={upload.directory}
                  className="group relative bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden border border-gray-100"
                >
                  <div className="p-6 space-y-4">
                    <h3 className="font-semibold text-lg text-gray-900 group-hover:text-indigo-600 transition-colors">
                      {getUploadDisplayName(upload)}
                    </h3>
                    
                    <div className="space-y-2">
                      <div className="flex items-center text-sm text-gray-500">
                        <Calendar className="h-4 w-4 mr-2" />
                        <span>
                          {new Date(upload.actual_recording_timestamp || upload.upload_timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center text-sm text-gray-500">
                        <Clock className="h-4 w-4 mr-2" />
                        <span>
                          {new Date(upload.actual_recording_timestamp || upload.upload_timestamp).toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </span>
                      </div>
                      <div className="flex items-center text-sm text-gray-500">
                        <FolderOpen className="h-4 w-4 mr-2" />
                        <span className="truncate">{upload.directory}</span>
                      </div>
                    </div>

                    <div className="pt-4">
                      <Button
                        onClick={() => navigate(`/heatmap/${upload.directory}`)}
                        className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition-all duration-200"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View Heatmap
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}