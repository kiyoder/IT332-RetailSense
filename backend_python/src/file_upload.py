import os
import shutil
import uuid
import cv2
import base64
from datetime import datetime
from typing import List
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

# Ensure the project data directory exists
os.makedirs(PROJECT_DATA_DIR, exist_ok=True)

class CornerCoordinate(BaseModel):
    x: int
    y: int

class CornerCoordinates(BaseModel):
    coordinates: List[CornerCoordinate]

@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Upload a video file (.mp4) for processing.
    
    Args:
        file: The video file to upload
        current_user_id: The ID of the authenticated user
        
    Returns:
        JSON response with the status and first frame as base64
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
        
        # Convert the frame to base64 for sending to frontend
        _, buffer = cv2.imencode('.jpg', frame)
        base64_image = base64.b64encode(buffer).decode('utf-8')
        
        return {
            "status": "success",
            "message": "Video uploaded successfully",
            "directory": dir_name,
            "first_frame": f"data:image/jpeg;base64,{base64_image}"
        }
    
    except Exception as e:
        # Clean up in case of error
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir)
        raise HTTPException(status_code=500, detail=f"Error processing video: {str(e)}")

@router.post("/corners/{directory}")
async def save_corner_coordinates(
    directory: str,
    coordinates: CornerCoordinates,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Save the corner coordinates selected by the user.
    
    Args:
        directory: The directory name where the video is stored
        coordinates: The 4 corner coordinates
        current_user_id: The ID of the authenticated user
        
    Returns:
        JSON response with the status
    """
    # Validate directory belongs to the current user
    if not directory.startswith(current_user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Validate we have exactly 4 corners
    if len(coordinates.coordinates) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 corner points are required")
    
    user_dir = os.path.join(PROJECT_DATA_DIR, directory)
    
    # Check if directory exists
    if not os.path.exists(user_dir):
        raise HTTPException(status_code=404, detail="Directory not found")
    
    # Save coordinates to JSON file
    import json
    coords_file = os.path.join(user_dir, "layout_coordinates.json")
    
    with open(coords_file, "w") as f:
        json.dump([{"x": c.x, "y": c.y} for c in coordinates.coordinates], f)
    
    return {
        "status": "success",
        "message": "Corner coordinates saved successfully"
    }

@router.get("/status/{directory}")
async def get_processing_status(
    directory: str,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Get the status of video processing.
    
    Args:
        directory: The directory name where the video is stored
        current_user_id: The ID of the authenticated user
        
    Returns:
        JSON response with the processing status
    """
    # Validate directory belongs to the current user
    if not directory.startswith(current_user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    
    user_dir = os.path.join(PROJECT_DATA_DIR, directory)
    
    # Check if directory exists
    if not os.path.exists(user_dir):
        raise HTTPException(status_code=404, detail="Directory not found")
    
    # Check for status file (will be implemented with the processing pipeline)
    status_file = os.path.join(user_dir, "status.json")
    if os.path.exists(status_file):
        import json
        with open(status_file, "r") as f:
            status = json.load(f)
        return status
    
    # Check for the existence of output files to determine status
    heatmap_file = os.path.join(user_dir, "heatmap.png")
    if os.path.exists(heatmap_file):
        return {
            "status": "completed",
            "progress": 100,
            "message": "Processing completed"
        }
    
    # Check if coordinates file exists
    coords_file = os.path.join(user_dir, "layout_coordinates.json")
    if os.path.exists(coords_file):
        return {
            "status": "waiting",
            "progress": 0,
            "message": "Waiting to start processing"
        }
    
    return {
        "status": "pending",
        "progress": 0,
        "message": "Waiting for corner coordinates"
    }
