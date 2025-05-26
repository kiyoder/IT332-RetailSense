import os
import json
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from pydantic import BaseModel # Added this line
import glob

try:
    from .auth import get_current_user_id
    from .status_utils import load_status # Assuming you have this utility
except ImportError:
    from src.auth import get_current_user_id
    # Assuming status_utils.py is in src for local dev
    from src.status_utils import load_status


router = APIRouter()

PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")
ZONE_ACTIVITY_FILENAME = "zone_activity.json"
STATUS_FILENAME = "status.json" # From status_utils or defined here
HOURLY_COUNTS_FILENAME = "hourly_counts.csv" # Added for the new endpoint
UPLOAD_METADATA_FILENAME = "upload_metadata.json"

@router.get("/api/activity/latest_zone_activity/{user_id_param}", response_model=Dict[str, Any])
async def get_latest_zone_activity_for_user(
    user_id_param: str,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Retrieves the zone_activity.json from the most recently completed video
    processing for the given user.
    """
    if user_id_param != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied to this user's activity")

    user_video_dirs_pattern = os.path.join(PROJECT_DATA_DIR, f"{current_user_id}_*")
    potential_dirs = [d for d in glob.glob(user_video_dirs_pattern) if os.path.isdir(d)]

    completed_video_activities = []

    for video_dir_path in potential_dirs:
        status_path = os.path.join(video_dir_path, STATUS_FILENAME)
        activity_path = os.path.join(video_dir_path, ZONE_ACTIVITY_FILENAME)

        if os.path.exists(status_path) and os.path.exists(activity_path):
            try:
                status_data = load_status(video_dir_path) # Use your utility
                if status_data and status_data.get("status") == "completed":
                    # Try to get a timestamp from the directory name (e.g., userid_YYYYMMDD_HHMMSS)
                    dir_name = os.path.basename(video_dir_path)
                    timestamp_str = dir_name.split('_')[-1] # Assuming last part is timestamp
                    # This parsing is basic, adjust if your timestamp format is different
                    try:
                        # Example: YYYYMMDDHHMMSS - adjust format string as needed
                        # If your timestamp includes separators, add them to the format string
                        # For "20230101_123045", you might need to combine parts or adjust split
                        # For simplicity, let's assume a sortable string or use file modification time
                        # A more robust way is to store upload_timestamp in status.json or a metadata file
                        # For now, let's use directory modification time as a proxy for recency
                        dir_mtime = os.path.getmtime(video_dir_path)
                        completed_video_activities.append({"path": activity_path, "mtime": dir_mtime})
                    except ValueError:
                        # Fallback if timestamp parsing fails: use directory modification time
                        dir_mtime = os.path.getmtime(video_dir_path)
                        completed_video_activities.append({"path": activity_path, "mtime": dir_mtime})

            except Exception as e:
                print(f"Error processing directory {video_dir_path}: {e}")
                continue
    
    if not completed_video_activities:
        return {} # No completed video with activity found

    # Sort by modification time (most recent first)
    completed_video_activities.sort(key=lambda x: x["mtime"], reverse=True)
    
    latest_activity_path = completed_video_activities[0]["path"]
    try:
        with open(latest_activity_path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading latest zone activity from {latest_activity_path}: {e}")
        return {} # Return empty if loading fails


# Helper function to check if a timestamp falls within a period
def is_in_period(timestamp_iso: Optional[str], period: str, reference_date: datetime.date) -> bool:
    # If the period is "all", we don't need to check the timestamp.
    # All records (that are 'completed' and have activity data) should be included.
    if period == "all":
        return True

    # For any other period (today, this_week, etc.), a valid timestamp is required.
    if not timestamp_iso:
        return False
    try:
        # Ensure dt_object is offset-aware if comparing with offset-aware reference_date, or both naive.
        # For simplicity, we'll work with date objects which are naive.
        dt_object = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00")) # Handle Z for UTC
        record_date = dt_object.date()
    except ValueError:
        print(f"Warning: Could not parse timestamp_iso '{timestamp_iso}' for period filtering.")
        return False # Invalid timestamp format for specific period filtering

    if period == "today":
        return record_date == reference_date
    if period == "this_week":
        # Monday as start of week (0), Sunday as end (6)
        start_of_week = reference_date - timedelta(days=reference_date.weekday())
        end_of_week = start_of_week + timedelta(days=6)
        return start_of_week <= record_date <= end_of_week
    if period == "this_month":
        return record_date.year == reference_date.year and record_date.month == reference_date.month
    if period == "this_year":
        return record_date.year == reference_date.year
    return False

from datetime import date, timedelta # ensure timedelta is imported

@router.get("/api/activity/aggregated_zone_activity/{user_id_param}", response_model=Dict[str, Dict[str, float]])
async def get_aggregated_zone_activity(
    user_id_param: str,
    period: str = Query("all", enum=["all", "today", "this_week", "this_month", "this_year"]),
    current_user_id: str = Depends(get_current_user_id)
):
    if user_id_param != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied to this user's activity")

    user_video_dirs_pattern = os.path.join(PROJECT_DATA_DIR, f"{current_user_id}_*")
    potential_dirs = [d for d in glob.glob(user_video_dirs_pattern) if os.path.isdir(d)]

    aggregated_activity: Dict[str, float] = {}
    reference_date = date.today() # Use current date for "today", "this_week", etc.

    for video_dir_path in potential_dirs:
        status_path = os.path.join(video_dir_path, STATUS_FILENAME)
        activity_path = os.path.join(video_dir_path, ZONE_ACTIVITY_FILENAME)
        metadata_path = os.path.join(video_dir_path, UPLOAD_METADATA_FILENAME)

        if not (os.path.exists(status_path) and os.path.exists(activity_path) and os.path.exists(metadata_path)):
            continue

        try:
            status_data = load_status(video_dir_path)
            if not (status_data and status_data.get("status") == "completed"):
                continue

            with open(metadata_path, "r") as f_meta:
                upload_meta = json.load(f_meta)
            
            actual_recording_timestamp = upload_meta.get("actual_recording_timestamp")
            
            if not is_in_period(actual_recording_timestamp, period, reference_date):
                continue
            
            # If all checks pass, load and aggregate activity
            with open(activity_path, "r") as f_activity:
                zone_activities_for_video = json.load(f_activity)
                for zone_id, data in zone_activities_for_video.items():
                    score = data.get("activity_score", 0)
                    if isinstance(score, (int, float)): # Ensure score is a number
                        aggregated_activity[zone_id] = aggregated_activity.get(zone_id, 0) + score

        except Exception as e:
            print(f"Error processing activity for directory {video_dir_path} with period {period}: {e}")
            continue
    
    # Format for response: {"zone_id": {"activity_score": VALUE}}
    response_data = {
        zone_id: {"activity_score": score} for zone_id, score in aggregated_activity.items()
    }
    return response_data


class HourlyCountItem(BaseModel): # Pydantic model for the response
    hour: str # ISO timestamp string for the hour
    count: int

@router.get("/api/activity/aggregated_hourly_counts/{user_id_param}", response_model=List[HourlyCountItem])
async def get_aggregated_hourly_counts(
    user_id_param: str,
    period: str = Query("all", enum=["all", "today", "this_week", "this_month", "this_year"]),
    current_user_id: str = Depends(get_current_user_id)
):
    if user_id_param != current_user_id:
        raise HTTPException(status_code=403, detail="Access denied to this user's activity")

    user_video_dirs_pattern = os.path.join(PROJECT_DATA_DIR, f"{current_user_id}_*")
    potential_dirs = [d for d in glob.glob(user_video_dirs_pattern) if os.path.isdir(d)]

    # Dictionary to store aggregated counts: { "YYYY-MM-DDTHH:00:00Z": total_count }
    # We use the full ISO string for the hour as a key to handle data from different days correctly.
    aggregated_hourly_data: Dict[str, int] = {}
    reference_date = date.today()

    for video_dir_path in potential_dirs:
        status_path = os.path.join(video_dir_path, STATUS_FILENAME)
        hourly_counts_path = os.path.join(video_dir_path, HOURLY_COUNTS_FILENAME)
        metadata_path = os.path.join(video_dir_path, UPLOAD_METADATA_FILENAME)

        if not (os.path.exists(status_path) and os.path.exists(hourly_counts_path) and os.path.exists(metadata_path)):
            continue

        try:
            status_data = load_status(video_dir_path)
            if not (status_data and status_data.get("status") == "completed"):
                continue

            with open(metadata_path, "r") as f_meta:
                upload_meta = json.load(f_meta)
            
            actual_recording_timestamp = upload_meta.get("actual_recording_timestamp")
            
            if not is_in_period(actual_recording_timestamp, period, reference_date):
                continue
            
            # If all checks pass, load and aggregate hourly counts from CSV
            with open(hourly_counts_path, "r") as f_hourly:
                # Simple CSV parsing: assumes "Hour,UniquePeopleCount"
                lines = f_hourly.readlines()
                if len(lines) < 2: # Header + data
                    continue 
                
                for line in lines[1:]: # Skip header
                    parts = line.strip().split(',')
                    if len(parts) == 2:
                        hour_iso_str, count_str = parts[0].strip(), parts[1].strip()
                        try:
                            count = int(count_str)
                            # The hour_iso_str from CSV should be like "YYYY-MM-DD HH:00:00"
                            # Ensure it's a full ISO string if needed, or adjust parsing.
                            # For aggregation, we'll use the hour string directly as key.
                            aggregated_hourly_data[hour_iso_str] = aggregated_hourly_data.get(hour_iso_str, 0) + count
                        except ValueError:
                            print(f"Warning: Could not parse count '{count_str}' in {hourly_counts_path}")
        except Exception as e:
            print(f"Error processing hourly counts for directory {video_dir_path} with period {period}: {e}")
            continue
    
    # Convert aggregated data to the response model format
    response_list: List[HourlyCountItem] = [
        HourlyCountItem(hour=hour_key, count=total_count)
        for hour_key, total_count in aggregated_hourly_data.items()
    ]
    # Optionally sort by hour if needed, though frontend might also handle sorting for display
    response_list.sort(key=lambda x: x.hour)

    return response_list
