import os
import json
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi import File, UploadFile # Added
from pydantic import BaseModel, Field # Added
import shutil # Added

try:
    from .auth import get_current_user_id
except ImportError:
    from src.auth import get_current_user_id

router = APIRouter()

# Define the base directory for storing project data
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")
FLOORPLAN_FILENAME = "floorplan_layout.json"

# --- Pydantic Models for Floorplan Data ---

class Point(BaseModel):
    x: float
    y: float

class Zone(BaseModel):
    id: str = Field(..., description="Unique identifier for the zone")
    name: str = Field(..., description="Name of the zone")
    points: List[Point] = Field(..., description="List of points defining the polygon of the zone")
    color: str = Field(default="#FF0000", description="Hex color code for the zone") # Default to red

class Aisle(BaseModel):
    id: str = Field(..., description="Unique identifier for the aisle")
    name: str = Field(..., description="Name of the aisle")
    points: List[Point] = Field(..., description="List of points defining the polyline of the aisle")
    label_position: Point = Field(None, description="Optional position for the aisle label")

class FloorplanLayout(BaseModel):
    zones: List[Zone] = Field(default_factory=list)
    aisles: List[Aisle] = Field(default_factory=list)

# --- API Endpoints ---

@router.post("/project/base_floorplan")
async def upload_base_floorplan_image(
    file: UploadFile = File(...),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Upload a base floorplan image (PNG or JPG) for the current user's project.
    This will be saved in the user's central assets directory.
    The filename will be base_floorplan.png or base_floorplan.jpg.
    """
    central_assets_dir = os.path.join(PROJECT_DATA_DIR, current_user_id)
    os.makedirs(central_assets_dir, exist_ok=True)

    file_extension = ""
    if file.content_type == "image/jpeg":
        file_extension = ".jpg"
    elif file.content_type == "image/png":
        file_extension = ".png"
    else:
        raise HTTPException(status_code=400, detail="Invalid file type. Only PNG and JPG are allowed.")

    # Remove old base_floorplan files if they exist to avoid conflicts
    for ext in [".png", ".jpg"]:
        old_path = os.path.join(central_assets_dir, f"base_floorplan{ext}")
        if os.path.exists(old_path):
            os.remove(old_path)

    new_filename = f"base_floorplan{file_extension}"
    file_path = os.path.join(central_assets_dir, new_filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"status": "success", "message": f"Base floorplan image '{new_filename}' uploaded successfully.", "filename": new_filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload base floorplan image: {str(e)}")
    finally:
        if hasattr(file, 'file') and file.file: # Ensure file object exists and is not None
            file.file.close()

@router.post("/floorplan/{user_id_as_directory}")
async def save_floorplan_layout(
    user_id_as_directory: str,
    layout_data: FloorplanLayout,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Save the floorplan layout (zones and aisles) for the current user.
    The 'user_id_as_directory' path parameter must match the authenticated user's ID.
    """
    if user_id_as_directory != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied to this directory")

    user_dir = os.path.join(PROJECT_DATA_DIR, current_user_id) # Use current_user_id for path
    os.makedirs(user_dir, exist_ok=True) # Ensure directory exists

    floorplan_file_path = os.path.join(user_dir, FLOORPLAN_FILENAME)

    try:
        with open(floorplan_file_path, "w") as f:
            json.dump(layout_data.model_dump(), f, indent=2)
        return {"status": "success", "message": "Floorplan layout saved successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save floorplan layout: {str(e)}")

@router.get("/floorplan/{user_id_as_directory}", response_model=FloorplanLayout)
async def get_floorplan_layout(
    user_id_as_directory: str,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Retrieve the floorplan layout for the current user.
    The 'user_id_as_directory' path parameter must match the authenticated user's ID.
    """
    if user_id_as_directory != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied to this directory")

    user_dir = os.path.join(PROJECT_DATA_DIR, current_user_id) # Use current_user_id for path
    if not os.path.exists(user_dir):
        # If the directory doesn't exist, it's a 404, but for floorplan,
        # it might also mean no layout has been saved yet.
        # For consistency, we can return an empty layout.
        return FloorplanLayout()

    floorplan_file_path = os.path.join(user_dir, FLOORPLAN_FILENAME)

    if not os.path.exists(floorplan_file_path):
        # No layout file saved yet, return an empty layout
        return FloorplanLayout()

    try:
        with open(floorplan_file_path, "r") as f:
            data = json.load(f)
            return FloorplanLayout(**data)
    except json.JSONDecodeError:
        # If the file is corrupted or not valid JSON, return empty or raise error
        # For robustness, returning an empty layout might be preferable to an error
        # if the frontend can handle it gracefully.
        # Alternatively, raise HTTPException(status_code=500, detail="Invalid floorplan data file.")
        return FloorplanLayout() # Or raise error
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load floorplan layout: {str(e)}")

@router.get("/floorplan/{user_id_as_directory}/exists")
async def check_floorplan_exists(
    user_id_as_directory: str,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Check if a floorplan layout has been saved and has content for the current user.
    The 'user_id_as_directory' path parameter must match the authenticated user's ID.
    """
    if user_id_as_directory != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied to this directory")

    user_dir = os.path.join(PROJECT_DATA_DIR, current_user_id) # Use current_user_id for path
    floorplan_file_path = os.path.join(user_dir, FLOORPLAN_FILENAME)

    exists = os.path.exists(floorplan_file_path)
    has_content = False

    if exists:
        try:
            with open(floorplan_file_path, "r") as f:
                data = json.load(f)
                # Check if it has some actual zones or aisles
                if (data.get("zones") and len(data["zones"]) > 0) or \
                   (data.get("aisles") and len(data["aisles"]) > 0):
                    has_content = True
        except (json.JSONDecodeError, Exception):
            # If file is corrupted or not valid JSON, treat as not having content
            pass # has_content remains False

    return {"exists": exists, "has_content": has_content}
