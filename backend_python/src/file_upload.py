import os
import shutil
import uuid
import cv2
import base64
from datetime import datetime
from typing import List, Optional # Added Optional
import json # Added for saving metadata
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    from .auth import get_current_user_id
except ImportError:
    from src.auth import get_current_user_id

router = APIRouter()

# Define the base directory for storing project data
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")
UPLOAD_METADATA_FILENAME = "upload_metadata.json" # Consistent with user_uploads.py

# Ensure the project data directory exists
os.makedirs(PROJECT_DATA_DIR, exist_ok=True)

class CornerCoordinate(BaseModel):
    x: int
    y: int

class CornerCoordinates(BaseModel):
    coordinates: List[CornerCoordinate]

@router.post("/upload")
async def upload_video(
    current_user_id: str = Depends(get_current_user_id),
    file: UploadFile = File(...),
    base64_frame: bool = Form(False), # Optional: if frontend wants the first frame as base64
    recording_timestamp: Optional[str] = Form(None) # New: actual recording timestamp
):
    """
    Uploads a video file, saves it, extracts the first frame, and returns the directory name.
    Optionally accepts an actual recording timestamp.
    """
    # Validate file type
    if not file.filename.lower().endswith('.mp4'):
        raise HTTPException(status_code=400, detail="Only .mp4 files are allowed")

    # Create a unique directory for this upload
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dir_name = f"{current_user_id}_{timestamp}"
    user_dir = os.path.join(PROJECT_DATA_DIR, dir_name)
    os.makedirs(user_dir, exist_ok=True)

    # Save the uploaded file
    file_path = os.path.join(user_dir, "cctv.mp4")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Extract the first frame
    try:
        cap = cv2.VideoCapture(file_path)
        ret, frame = cap.read()
        cap.release()

        if not ret:
            raise HTTPException(status_code=400, detail="Could not extract frame from video")

        # Save the frame as an image
        layout_path = os.path.join(user_dir, "layout.jpg")
        cv2.imwrite(layout_path, frame)

        # Convert the frame to base64 for sending to frontend if requested
        base64_image_data = None
        if base64_frame:
            _, buffer_img = cv2.imencode('.jpg', frame)
            base64_image_data = base64.b64encode(buffer_img).decode('utf-8')
            base64_image_data = f"data:image/jpeg;base64,{base64_image_data}"


        # Determine the original filename to save
        actual_original_filename = None
        if file.filename and file.filename.strip():
            # Add more placeholder checks if needed
            placeholders = ["unknown", "untitled", "none"]
            if file.filename.strip().lower() not in placeholders:
                actual_original_filename = file.filename.strip()

        # Save upload metadata
        upload_time_obj = datetime.now()
        actual_recording_time_iso = None
        if recording_timestamp:
            try:
                actual_recording_time_iso = datetime.fromisoformat(recording_timestamp).isoformat()
            except ValueError:
                print(f"Warning: Invalid recording_timestamp format: {recording_timestamp}. Ignoring.")

        metadata = {
            "original_filename": actual_original_filename, # Will be null if no valid name
            "upload_timestamp": upload_time_obj.isoformat(), # Always store the server's upload time
            "actual_recording_timestamp": actual_recording_time_iso, # Store user-provided time if valid
            # You can add other initial metadata here if needed
        }
        metadata_path = os.path.join(user_dir, UPLOAD_METADATA_FILENAME)
        with open(metadata_path, "w") as f_meta:
            json.dump(metadata, f_meta, indent=2)

        response_content = {
            "status": "success",
            "message": "Video uploaded successfully",
            "directory": dir_name,
        }
        if base64_image_data:
            response_content["first_frame"] = base64_image_data
        
        return response_content

    except Exception as e:
        # Clean up in case of error
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir)
        raise HTTPException(status_code=500, detail=f"Error processing video: {str(e)}")

@router.post("/corners/{user_id_for_central_assets}") # Changed 'directory' to 'user_id_for_central_assets'
async def save_corner_coordinates_for_user( # Renamed function for clarity
    user_id_for_central_assets: str, # This is the user's ID, not the video directory
    coordinates: CornerCoordinates,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Save the corner coordinates selected by the user for their central floorplan.
    These coordinates define the perspective transformation for all videos of this user.
    The coordinates are saved in the user's central assets directory.

    Args:
        user_id_for_central_assets: The ID of the user for whom to save the coordinates.
                                   Must match the authenticated user's ID.
        coordinates: The 4 corner coordinates.
        current_user_id: The ID of the authenticated user.

    Returns:
        JSON response with the status.
    """
    # Validate directory belongs to the current user
    if user_id_for_central_assets != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied. Cannot save coordinates for another user.")

    # Validate we have exactly 4 corners
    if len(coordinates.coordinates) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 corner points are required")

    # The coordinates are saved in the user's central assets directory, not a video-specific one.
    central_assets_dir = os.path.join(PROJECT_DATA_DIR, current_user_id)
    os.makedirs(central_assets_dir, exist_ok=True) # Ensure the directory exists

    # Save coordinates to JSON file in the central assets directory
    coords_file = os.path.join(central_assets_dir, "layout_coordinates.json")

    with open(coords_file, "w") as f:
        json.dump([{"x": c.x, "y": c.y} for c in coordinates.coordinates], f, indent=2)

    return {
        "status": "success",
        "message": "Corner coordinates saved successfully for user."
    }

# GET /status/{directory} endpoint was removed as it's now handled by processing.py
# The status logic is more complex and tied to the VisionPipeline.
