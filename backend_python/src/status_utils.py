import os
import json
import logging
import tempfile
import time
from typing import Dict, Any, Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cache for status data to reduce file reads/writes
status_cache = {}
# Timestamp of last status write for each directory
last_write_time = {}
# Minimum time between writes (in seconds)
MIN_WRITE_INTERVAL = 0.5  # 500ms throttling


def get_status_file_path(directory: str) -> str:
    """
    Get the path to the status file for a directory.

    Args:
        directory: The directory name

    Returns:
        Path to the status file
    """
    # Get the project data directory
    project_data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")

    # Ensure the directory exists
    directory_path = os.path.join(project_data_dir, directory)
    os.makedirs(directory_path, exist_ok=True)

    # Return the path to the status file
    return os.path.join(directory_path, "status.json")


def save_status(directory: str, status: Dict[str, Any]) -> None:
    """
    Save processing status to a file with caching and throttling.

    Args:
        directory: The directory name
        status: The status data to save
    """
    try:
        # Update cache first
        status_cache[directory] = status.copy()

        # Check if we need to throttle writes
        current_time = time.time()
        if directory in last_write_time:
            time_since_last_write = current_time - last_write_time[directory]
            if time_since_last_write < MIN_WRITE_INTERVAL:
                # Skip this write, too soon after the last one
                logger.debug(f"Throttled status write for {directory} (last write {time_since_last_write:.2f}s ago)")
                return

        status_file = get_status_file_path(directory)

        # Save status to file
        with open(status_file, 'w') as f:
            json.dump(status, f)

        # Update last write time
        last_write_time[directory] = current_time
        logger.info(f"Status saved to file for directory: {directory}")
    except Exception as e:
        logger.error(f"Error saving status to file: {e}")


def save_status_safely(status_path: str, status: Dict[str, Any]) -> None:
    """
    Save status to a file using atomic operations with caching and throttling.

    Args:
        status_path: The path to the status file
        status: The status data to save
    """
    try:
        # Extract directory name from path for caching
        directory = os.path.basename(os.path.dirname(status_path))

        # Update cache first
        status_cache[directory] = status.copy()

        # Check if we need to throttle writes
        current_time = time.time()
        if directory in last_write_time:
            time_since_last_write = current_time - last_write_time[directory]
            if time_since_last_write < MIN_WRITE_INTERVAL:
                # Skip this write, too soon after the last one
                logger.debug(f"Throttled status write for {directory} (last write {time_since_last_write:.2f}s ago)")
                return

        # Create a temporary file in the same directory
        directory_path = os.path.dirname(status_path)
        os.makedirs(directory_path, exist_ok=True)

        # Use a temporary file for atomic write
        with tempfile.NamedTemporaryFile(mode='w', dir=directory_path, delete=False) as temp_file:
            # Write status to temporary file
            json.dump(status, temp_file)
            temp_file_path = temp_file.name

        # Rename temporary file to target file (atomic operation)
        os.replace(temp_file_path, status_path)

        # Update last write time
        last_write_time[directory] = current_time
        logger.info(f"Status saved safely to: {status_path}")
    except Exception as e:
        logger.error(f"Error saving status safely: {e}")


def load_status(directory: str) -> Optional[Dict[str, Any]]:
    """
    Load processing status from cache or file.

    Args:
        directory: The directory name

    Returns:
        The status data, or None if not found
    """
    try:
        # Check cache first
        if directory in status_cache:
            logger.debug(f"Status loaded from cache for directory: {directory}")
            return status_cache[directory]

        status_file = get_status_file_path(directory)

        # Check if status file exists
        if not os.path.exists(status_file):
            logger.info(f"Status file not found for directory: {directory}")
            return None

        # Load status from file
        with open(status_file, 'r') as f:
            status = json.load(f)

        # Update cache
        status_cache[directory] = status.copy()

        logger.info(f"Status loaded from file for directory: {directory}")
        return status
    except Exception as e:
        logger.error(f"Error loading status from file: {e}")
        return None


def update_status(directory: str, status_updates: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update processing status with new values.

    Args:
        directory: The directory name
        status_updates: The status updates to apply

    Returns:
        The updated status data
    """
    try:
        # Load existing status from cache or file
        status = load_status(directory) or {}

        # Update status with new values
        status.update(status_updates)

        # Save updated status with throttling
        save_status(directory, status)

        logger.info(f"Status updated for directory: {directory}")
        return status
    except Exception as e:
        logger.error(f"Error updating status: {e}")
        return status_updates  # Return the updates as fallback


def get_consolidated_status(directory: str) -> Dict[str, Any]:
    """
    Get consolidated status information including active state and current status.

    Args:
        directory: The directory name

    Returns:
        Dictionary with consolidated status information
    """
    from src.vision_pipeline import processing_tasks

    # Check if processing is active in memory
    is_active = directory in processing_tasks

    # Get current status
    status = load_status(directory) or {
        "status": "not_started",
        "progress": 0,
        "message": "Processing not started"
    }

    # Return consolidated information
    return {
        "is_active": is_active,
        "status": status["status"],
        "progress": status["progress"],
        "message": status["message"]
    }
