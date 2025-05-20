import os
import json
import logging
import tempfile
from typing import Dict, Any, Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
    Save processing status to a file.

    Args:
        directory: The directory name
        status: The status data to save
    """
    try:
        status_file = get_status_file_path(directory)

        # Save status to file
        with open(status_file, 'w') as f:
            json.dump(status, f)

        logger.info(f"Status saved to file for directory: {directory}")
    except Exception as e:
        logger.error(f"Error saving status to file: {e}")


def save_status_safely(status_path: str, status: Dict[str, Any]) -> None:
    """
    Save status to a file using atomic operations to prevent corruption.

    Args:
        status_path: The path to the status file
        status: The status data to save
    """
    try:
        # Create a temporary file in the same directory
        directory = os.path.dirname(status_path)
        os.makedirs(directory, exist_ok=True)

        # Use a temporary file for atomic write
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, delete=False) as temp_file:
            # Write status to temporary file
            json.dump(status, temp_file)
            temp_file_path = temp_file.name

        # Rename temporary file to target file (atomic operation)
        os.replace(temp_file_path, status_path)

        logger.info(f"Status saved safely to: {status_path}")
    except Exception as e:
        logger.error(f"Error saving status safely: {e}")


def load_status(directory: str) -> Optional[Dict[str, Any]]:
    """
    Load processing status from a file.

    Args:
        directory: The directory name

    Returns:
        The status data, or None if not found
    """
    try:
        status_file = get_status_file_path(directory)

        # Check if status file exists
        if not os.path.exists(status_file):
            logger.info(f"Status file not found for directory: {directory}")
            return None

        # Load status from file
        with open(status_file, 'r') as f:
            status = json.load(f)

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
        # Load existing status
        status = load_status(directory) or {}

        # Update status with new values
        status.update(status_updates)

        # Save updated status
        save_status(directory, status)

        logger.info(f"Status updated for directory: {directory}")
        return status
    except Exception as e:
        logger.error(f"Error updating status: {e}")
        return status_updates  # Return the updates as fallback

# def get_processing_status(directory: str) -> Dict[str, Any]:
#     """
#     Get the current processing status for a directory.
#
#     Args:
#         directory: The directory name where processing is happening
#
#     Returns:
#         The current processing status
#     """
#     try:
#         status = load_status(directory)
#         if status is None:
#             status = {
#                 "status": "not_started",
#                 "progress": 0,
#                 "message": "Processing not started"
#             }
#         return status
#     except Exception as e:
#         logger.error(f"Error getting processing status: {e}")
#         return {
#             "status": "error",
#             "progress": 0,
#             "message": f"Error getting status: {str(e)}"
#         }
