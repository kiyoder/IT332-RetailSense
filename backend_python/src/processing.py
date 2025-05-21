from fastapi import APIRouter, Depends, HTTPException
import logging

try:
    from .auth import get_current_user_id
    from .vision_pipeline import start_processing
    from .status_utils import get_consolidated_status
except ImportError:
    from src.auth import get_current_user_id
    from src.vision_pipeline import start_processing
    from src.status_utils import get_consolidated_status

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/process/{directory}")
async def process_video(
        directory: str,
        current_user_id: str = Depends(get_current_user_id)
):
    """
    Start processing a video to generate heatmap and analytics.

    Args:
        directory: The directory name where the video is stored
        current_user_id: The ID of the authenticated user

    Returns:
        JSON response with the initial processing status
    """
    # Validate directory belongs to the current user
    if not directory.startswith(current_user_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Start processing
    status = start_processing(directory)

    return status


@router.get("/process/status/{directory}")
async def get_process_status(
        directory: str,
        current_user_id: str = Depends(get_current_user_id)
):
    """
    Get consolidated status information including active state and current status.

    This endpoint replaces the separate /status and /active endpoints.

    Args:
        directory: The directory name where the video is stored
        current_user_id: The ID of the authenticated user

    Returns:
        JSON response with consolidated status information
    """
    # Validate directory belongs to the current user
    if not directory.startswith(current_user_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get consolidated status
    status = get_consolidated_status(directory)

    return status
