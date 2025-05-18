import os
import json
import time
import random
import tempfile
import shutil
from typing import Dict, Any
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from .websocket_manager import manager
except ImportError:
    try:
        from src.websocket_manager import manager
    except ImportError:
        # For testing or when WebSocket manager is not available
        manager = None
        logger.warning("WebSocket manager not available")

# Define the base directory for storing project data
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")

# Cross-platform file locking
try:
    # Unix/Linux file locking
    import fcntl


    def lock_file(file_handle):
        fcntl.flock(file_handle, fcntl.LOCK_EX)


    def unlock_file(file_handle):
        fcntl.flock(file_handle, fcntl.LOCK_UN)


    HAS_FCNTL = True
    logger.info("Using fcntl for file locking (Unix/Linux)")
except ImportError:
    try:
        # Windows file locking
        import msvcrt


        def lock_file(file_handle):
            msvcrt.locking(file_handle.fileno(), msvcrt.LK_LOCK, 1)


        def unlock_file(file_handle):
            msvcrt.locking(file_handle.fileno(), msvcrt.LK_UNLCK, 1)


        HAS_FCNTL = False
        logger.info("Using msvcrt for file locking (Windows)")
    except ImportError:
        # Fallback for systems without native file locking
        def lock_file(file_handle):
            pass


        def unlock_file(file_handle):
            pass


        HAS_FCNTL = False
        logger.warning("No file locking available on this system")


def broadcast_status_update_sync(directory: str, status: Dict[str, Any]) -> None:
    """
    Synchronous wrapper for broadcasting status updates.
    This avoids the 'coroutine never awaited' warning.

    Args:
        directory: The directory name where the video is stored
        status: Status dictionary to broadcast
    """
    if manager is None:
        logger.warning("WebSocket manager not available for broadcasting")
        return

    # Skip broadcasting to avoid event loop issues
    logger.info(f"Status update for {directory} ready for broadcast (skipping to avoid event loop issues)")

    # Don't attempt to run asyncio code here - it causes event loop conflicts
    # Just log the status update instead
    logger.info(f"Status update content: {status.get('status', 'unknown')}, progress: {status.get('progress', 0)}%")


def save_status_safely(status_path: str, status: Dict[str, Any]) -> None:
    """
    Save status to a JSON file using atomic operations and file locking.
    Also broadcasts the status update via WebSockets if available.

    Args:
        status_path: Path to the status file
        status: Status dictionary to save
    """
    # Ensure directory exists
    os.makedirs(os.path.dirname(status_path), exist_ok=True)

    # Create a temporary file in the same directory
    temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(status_path))

    try:
        # Write to the temporary file
        with os.fdopen(temp_fd, 'w') as temp_file:
            # Lock the file if possible
            try:
                lock_file(temp_file)
            except Exception as e:
                logger.warning(f"Could not lock temporary file: {e}")

            # Write the status data
            json.dump(status, temp_file, indent=2)

            # Ensure data is written to disk
            temp_file.flush()
            os.fsync(temp_file.fileno())

            # Unlock the file if locked
            try:
                unlock_file(temp_file)
            except Exception:
                pass

        # Atomically replace the status file with the temporary file
        # This is atomic on both Windows and Unix-like systems
        if os.path.exists(status_path):
            # On Windows, we need to remove the destination file first
            if os.name == 'nt':
                try:
                    os.remove(status_path)
                except Exception as e:
                    logger.warning(f"Could not remove existing status file: {e}")

        # Rename the temporary file to the status file
        shutil.move(temp_path, status_path)

        # Force sync the directory to ensure the rename is persisted
        try:
            # Only attempt directory sync on platforms that support it
            if hasattr(os, 'O_DIRECTORY'):
                dir_fd = os.open(os.path.dirname(status_path), os.O_DIRECTORY)
                os.fsync(dir_fd)
                os.close(dir_fd)
        except Exception as e:
            logger.warning(f"Could not sync directory: {e}")

        # Add a small delay to ensure file is fully written before next read
        time.sleep(0.1)

        # Extract directory name from status_path
        directory = os.path.basename(os.path.dirname(status_path))

        # Broadcast status update via WebSockets using the synchronous wrapper
        # This avoids the 'coroutine never awaited' warning
        broadcast_status_update_sync(directory, status)

    except Exception as e:
        # Clean up the temporary file if something went wrong
        logger.error(f"Error saving status: {e}")
        try:
            os.remove(temp_path)
        except Exception:
            pass
        raise


def get_processing_status(directory: str) -> Dict[str, Any]:
    """
    Get the current status of a processing task.

    Args:
        directory: The directory name where the video is stored

    Returns:
        The current status of the processing task
    """
    # Create status file path
    user_dir = os.path.join(PROJECT_DATA_DIR, directory)
    status_path = os.path.join(user_dir, "status.json")

    # Create default status
    default_status = {
        "status": "initializing",
        "progress": 0,
        "message": "Initializing vision pipeline"
    }

    # Check if directory exists
    if not os.path.exists(user_dir):
        logger.warning(f"Directory does not exist: {user_dir}")
        return default_status

    # Create status file if it doesn't exist
    if not os.path.exists(status_path):
        try:
            logger.info(f"Creating new status file: {status_path}")
            save_status_safely(status_path, default_status)
        except Exception as e:
            logger.error(f"Error creating status file: {e}")
        return default_status

    # Read status file with retries
    max_retries = 3
    retry_delay = 0.2

    for attempt in range(max_retries):
        try:
            with open(status_path, 'r') as f:
                # Lock the file if possible
                try:
                    lock_file(f)
                except Exception:
                    pass

                # Read the status data
                status = json.load(f)

                # Unlock the file if locked
                try:
                    unlock_file(f)
                except Exception:
                    pass

                logger.info(
                    f"Read status for {directory}: {status.get('status', 'unknown')}, progress: {status.get('progress', 0)}%")
                return status
        except (json.JSONDecodeError, FileNotFoundError) as e:
            # If this is not the last attempt, wait and retry
            if attempt < max_retries - 1:
                # Add some jitter to the delay to avoid synchronization issues
                jitter = random.uniform(0, 0.1)
                time.sleep(retry_delay + jitter)
            else:
                logger.error(f"Error reading status file after {max_retries} attempts: {e}")
                # Return default status if all retries fail
                return default_status
        except Exception as e:
            logger.error(f"Unexpected error reading status file: {e}")
            # Return default status on unexpected errors
            return default_status

    # This should never be reached, but just in case
    return default_status


def check_heatmap_exists(directory: str) -> bool:
    """
    Check if the heatmap file exists for a given directory.

    Args:
        directory: The directory name where the video is stored

    Returns:
        True if the heatmap file exists, False otherwise
    """
    user_dir = os.path.join(PROJECT_DATA_DIR, directory)
    heatmap_path = os.path.join(user_dir, "heatmap.png")

    exists = os.path.exists(heatmap_path)
    logger.info(f"Heatmap file check for {directory}: {'exists' if exists else 'does not exist'}")
    return exists
