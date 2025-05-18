from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from typing import Dict

try:
    from .auth import get_current_user_id
    from .vision_pipeline import start_processing, get_processing_status
    from .websocket_manager import manager, get_user_id_from_token
except ImportError:
    from src.auth import get_current_user_id
    from src.vision_pipeline import start_processing, get_processing_status
    from src.websocket_manager import manager, get_user_id_from_token

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

    # Get status
    status = get_processing_status(directory)

    return status


@router.websocket("/ws/process/status/{directory}")
async def websocket_status(websocket: WebSocket, directory: str):
    """
    WebSocket endpoint for real-time status updates.

    Args:
        websocket: The WebSocket connection
        directory: The directory name where the video is stored
    """
    # Get token from query parameters
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Missing authentication token")
        return

    try:
        # Validate token and get user_id
        user_id = await get_user_id_from_token(token)

        # Validate directory belongs to the user
        if not directory.startswith(user_id):
            await websocket.close(code=1008, reason="Access denied")
            return

        # Accept connection and add to connection manager
        await manager.connect(websocket, directory)

        # Send initial status
        status = get_processing_status(directory)
        await websocket.send_text(status)

        try:
            # Keep connection alive and handle messages
            while True:
                # Wait for any message from client (like ping)
                data = await websocket.receive_text()

                # If client requests a status update, send it
                if data == "get_status":
                    status = get_processing_status(directory)
                    await websocket.send_json(status)

        except WebSocketDisconnect:
            # Handle client disconnect
            await manager.disconnect(websocket, directory)

    except HTTPException as e:
        # Handle authentication errors
        await websocket.close(code=1008, reason=e.detail)
    except Exception as e:
        # Handle other errors
        print(f"WebSocket error: {str(e)}")
        await websocket.close(code=1011, reason="Server error")
