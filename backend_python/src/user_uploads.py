import os
import json
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from pydantic import BaseModel # Added import for BaseModel
import glob # For finding directories

# Assuming these are in the same directory or accessible via src.
try:
    from .auth import get_current_user_id
    # If you have a status_utils.py for loading status.json consistently
    from .status_utils import load_status
except ImportError:
    from src.auth import get_current_user_id
    from src.status_utils import load_status


router = APIRouter()

PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")
# Metadata filename you might save during upload
UPLOAD_METADATA_FILENAME = "upload_metadata.json"

class UploadDetails(BaseModel): # You'd need to import BaseModel from pydantic
    directory: str
    original_filename: Optional[str] = None
    upload_timestamp: str # ISO format string
    actual_recording_timestamp: Optional[str] = None # New field
    status: str
    progress: int
    first_frame_url: Optional[str] = None

@router.get("/api/user/uploads", response_model=List[UploadDetails])
async def get_user_uploads(
    limit: int = Query(5, ge=1, le=20), # Add query parameter for limit
    current_user_id: str = Depends(get_current_user_id)
):
    user_uploads = []
    user_project_dir_pattern = os.path.join(PROJECT_DATA_DIR, f"{current_user_id}_*")

    # Find all directories matching the pattern for the current user
    # This assumes your video directories are named like "userid_timestamp"
    video_directories = [d for d in glob.glob(user_project_dir_pattern) if os.path.isdir(d)]

    for video_dir_path in video_directories:
        directory_name = os.path.basename(video_dir_path)
        
        # 1. Load upload metadata (you'll need to save this during the POST /api/upload)
        original_filename = "Unknown Filename"
        upload_timestamp_iso = datetime.now().isoformat() # Default if not found
        actual_recording_timestamp_iso = None

        metadata_path = os.path.join(video_dir_path, UPLOAD_METADATA_FILENAME)
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    metadata = json.load(f)
                    original_filename = metadata.get("original_filename", original_filename)
                    # Ensure timestamp is in ISO format if stored differently
                    stored_ts = metadata.get("upload_timestamp")
                    if isinstance(stored_ts, (int, float)): # if it's a unix timestamp
                        upload_timestamp_iso = datetime.fromtimestamp(stored_ts).isoformat()
                    elif isinstance(stored_ts, str): # if it's already an ISO string
                         upload_timestamp_iso = stored_ts
                    actual_recording_timestamp_iso = metadata.get("actual_recording_timestamp") # Get the new field
            except Exception as e:
                print(f"Error reading metadata for {directory_name}: {e}")

        # 2. Load processing status from status.json
        status_data = load_status(video_dir_path) # Use your load_status utility
        if status_data:
            status = status_data.get("status", "unknown")
            progress = status_data.get("progress", 0)
        else:
            status = "not_started" # Or "unknown", or a specific status for missing file
            progress = 0

        # 3. Construct first_frame_url (layout.jpg)
        first_frame_path = os.path.join(video_dir_path, "layout.jpg")
        first_frame_url = None
        if os.path.exists(first_frame_path):
            # The URL should match how your frontend accesses files via the /files/ endpoint
            first_frame_url = f"/files/{directory_name}/layout.jpg" 
            # Or if your VITE_API_URL is needed:
            # first_frame_url = f"{os.environ.get('VITE_API_URL', '')}/files/{directory_name}/layout.jpg"


        user_uploads.append(UploadDetails(
            directory=directory_name,
            original_filename=original_filename,
            upload_timestamp=upload_timestamp_iso,
            actual_recording_timestamp=actual_recording_timestamp_iso,
            status=status,
            progress=progress,
            first_frame_url=first_frame_url
        ))

    # Filter out completed uploads
    user_uploads = [upload for upload in user_uploads if upload.status != "completed"]

    # Sort the filtered list by upload timestamp descending and then apply limit
    user_uploads.sort(key=lambda x: x.upload_timestamp, reverse=True)
    # Consider if sorting should be by actual_recording_timestamp if available
    return user_uploads[:limit]

@router.get("/api/user/completed_uploads", response_model=List[UploadDetails])
async def get_user_completed_uploads(
    limit: int = Query(20, ge=1, le=50), # Allow more for a dedicated "completed" page
    current_user_id: str = Depends(get_current_user_id)
):
    completed_uploads = []
    user_project_dir_pattern = os.path.join(PROJECT_DATA_DIR, f"{current_user_id}_*")
    video_directories = [d for d in glob.glob(user_project_dir_pattern) if os.path.isdir(d)]

    for video_dir_path in video_directories:
        directory_name = os.path.basename(video_dir_path)
        
        original_filename = "Unknown Filename"
        upload_timestamp_iso = datetime.now().isoformat()
        actual_recording_timestamp_iso = None

        metadata_path = os.path.join(video_dir_path, UPLOAD_METADATA_FILENAME)
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    metadata = json.load(f)
                    original_filename = metadata.get("original_filename", original_filename)
                    stored_ts = metadata.get("upload_timestamp")
                    if isinstance(stored_ts, (int, float)):
                        upload_timestamp_iso = datetime.fromtimestamp(stored_ts).isoformat()
                    elif isinstance(stored_ts, str):
                         upload_timestamp_iso = stored_ts
                    actual_recording_timestamp_iso = metadata.get("actual_recording_timestamp")
            except Exception as e:
                print(f"Error reading metadata for {directory_name}: {e}")

        status_data = load_status(video_dir_path)
        status = "unknown"
        progress = 0
        if status_data:
            status = status_data.get("status", "unknown")
            progress = status_data.get("progress", 0)

        if status == "completed": # Only include completed uploads
            first_frame_path = os.path.join(video_dir_path, "layout.jpg")
            first_frame_url = f"/files/{directory_name}/layout.jpg" if os.path.exists(first_frame_path) else None

            completed_uploads.append(UploadDetails(
                directory=directory_name,
                original_filename=original_filename,
                upload_timestamp=upload_timestamp_iso,
                actual_recording_timestamp=actual_recording_timestamp_iso,
                status=status,
                progress=progress,
                first_frame_url=first_frame_url
            ))

    completed_uploads.sort(key=lambda x: x.upload_timestamp, reverse=True)
    return completed_uploads[:limit]
