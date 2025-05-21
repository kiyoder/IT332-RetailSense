import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.responses import Response, JSONResponse
import logging

try:
    from .auth import get_current_user_id
except ImportError:
    from src.auth import get_current_user_id

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Define the base directory for storing project data
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")


def add_cors_headers(headers, request):
    """Add CORS headers to any response headers dictionary"""
    headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "http://localhost:5173")
    headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
    headers[
        "Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept, Origin, User-Agent, Cache-Control, Pragma"
    headers["Access-Control-Allow-Credentials"] = "true"
    headers["Access-Control-Max-Age"] = "600"  # 10 minutes
    return headers


@router.options("/{directory}/{filename}")
async def options_file(
        directory: str,
        filename: str,
        request: Request
):
    """
    Handle OPTIONS requests for static files with proper CORS headers.
    This endpoint does not require authentication for preflight requests.
    """
    headers = {}
    headers = add_cors_headers(headers, request)

    return Response(status_code=200, headers=headers)


@router.options("/{path:path}")
async def options_any_path(
        path: str,
        request: Request
):
    """
    Catch-all OPTIONS handler for any path under this router.
    This ensures all preflight requests are handled properly.
    """
    headers = {}
    headers = add_cors_headers(headers, request)

    return Response(status_code=200, headers=headers)


@router.get("/{directory}/{filename}")
async def get_file(
        directory: str,
        filename: str,
        request: Request,
        current_user_id: str = Depends(get_current_user_id)
):
    """
    Serve a file from the project data directory with proper CORS headers.
    Only allows access if the directory belongs to the authenticated user.
    """
    try:
        # Log request details for debugging
        logger.info(f"GET file request - Directory: {directory}, Filename: {filename}, User ID: {current_user_id}")

        # Check if directory exists first
        dir_path = os.path.join(PROJECT_DATA_DIR, directory)
        if not os.path.exists(dir_path):
            logger.warning(f"Directory not found: {dir_path}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return JSONResponse(
                status_code=404,
                content={"detail": f"Directory not found: {directory}"},
                headers=headers
            )

        # Proper authorization check - only allow access if directory belongs to user
        # A directory belongs to a user if:
        # 1. It starts with the user's ID (prefixed directories)
        # 2. The user's ID is contained within the directory name (for compatibility)
        is_authorized = (
                directory.startswith(current_user_id) or
                current_user_id in directory
        )

        # Log authorization status
        logger.info(f"Authorization status for GET {directory}/{filename}: {is_authorized}")

        if not is_authorized:
            logger.warning(f"Access denied - Directory: {directory} does not match User ID: {current_user_id}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return JSONResponse(
                status_code=403,
                content={
                    "detail": f"Access denied - User ID {current_user_id} not authorized for directory {directory}"},
                headers=headers
            )

        file_path = os.path.join(PROJECT_DATA_DIR, directory, filename)
        logger.info(f"Attempting to serve file: {file_path}")

        # Check if file exists
        if not os.path.exists(file_path):
            logger.warning(f"File not found: {file_path}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return JSONResponse(
                status_code=404,
                content={"detail": f"File not found: {filename}"},
                headers=headers
            )

        logger.info(f"Serving file: {file_path}")

        # Determine content type and disposition
        content_type = "application/octet-stream"
        if filename.endswith(".png"):
            content_type = "image/png"
        elif filename.endswith(".csv"):
            content_type = "text/csv"

        # Set CORS headers for successful response
        headers = {
            "Content-Type": content_type,
        }

        # Add Content-Disposition header for CSV files to force download
        if filename.endswith(".csv"):
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        headers = add_cors_headers(headers, request)

        return FileResponse(
            path=file_path,
            headers=headers,
            filename=filename,
            media_type=content_type
        )
    except Exception as e:
        # Log the exception
        logger.error(f"Error serving file: {str(e)}")

        # Ensure CORS headers are included even in case of errors
        headers = {}
        headers = add_cors_headers(headers, request)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error serving file: {str(e)}"},
            headers=headers
        )


@router.head("/{directory}/{filename}")
async def head_file(
        directory: str,
        filename: str,
        request: Request,
        current_user_id: str = Depends(get_current_user_id)
):
    """
    Handle HEAD requests for files with proper CORS headers.
    Only allows access if the directory belongs to the authenticated user.
    """
    try:
        # Log request details for debugging
        logger.info(f"HEAD file request - Directory: {directory}, Filename: {filename}, User ID: {current_user_id}")

        # Check if directory exists first
        dir_path = os.path.join(PROJECT_DATA_DIR, directory)
        if not os.path.exists(dir_path):
            logger.warning(f"Directory not found: {dir_path}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return Response(status_code=404, headers=headers)

        # Proper authorization check - only allow access if directory belongs to user
        # A directory belongs to a user if:
        # 1. It starts with the user's ID (prefixed directories)
        # 2. The user's ID is contained within the directory name (for compatibility)
        is_authorized = (
                directory.startswith(current_user_id) or
                current_user_id in directory
        )

        # Log authorization status
        logger.info(f"Authorization status for HEAD {directory}/{filename}: {is_authorized}")

        if not is_authorized:
            logger.warning(f"Access denied - Directory: {directory} does not match User ID: {current_user_id}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return Response(status_code=403, headers=headers)

        file_path = os.path.join(PROJECT_DATA_DIR, directory, filename)

        # Check if file exists
        if not os.path.exists(file_path):
            logger.warning(f"File not found: {file_path}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return Response(status_code=404, headers=headers)

        logger.info(f"File exists: {file_path}")

        # Determine content type
        content_type = "application/octet-stream"
        if filename.endswith(".png"):
            content_type = "image/png"
        elif filename.endswith(".csv"):
            content_type = "text/csv"

        # Set CORS headers and content info
        headers = {
            "Content-Length": str(os.path.getsize(file_path)),
            "Content-Type": content_type
        }

        # Add Content-Disposition header for CSV files to force download
        if filename.endswith(".csv"):
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'

        headers = add_cors_headers(headers, request)

        return Response(status_code=200, headers=headers)
    except Exception as e:
        # Log the exception
        logger.error(f"Error checking file: {str(e)}")

        # Ensure CORS headers are included even in case of errors
        headers = {}
        headers = add_cors_headers(headers, request)
        return Response(status_code=500, headers=headers)


# Add a new endpoint to notify when a file is ready
@router.post("/notify/{directory}/{filename}")
async def notify_file_ready(
        directory: str,
        filename: str,
        request: Request,
        current_user_id: str = Depends(get_current_user_id)
):
    """
    Notify that a file is ready for access.
    This endpoint can be called by the processing system when a file is generated.
    """
    try:
        # Log notification
        logger.info(
            f"File ready notification - Directory: {directory}, Filename: {filename}, User ID: {current_user_id}")

        # Check if the user is authorized to notify for this directory
        is_authorized = (
                directory.startswith(current_user_id) or
                current_user_id in directory
        )

        if not is_authorized:
            logger.warning(f"Unauthorized notification attempt - Directory: {directory}, User ID: {current_user_id}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return JSONResponse(
                status_code=403,
                content={"detail": "Not authorized to notify for this directory"},
                headers=headers
            )

        # Check if file actually exists
        file_path = os.path.join(PROJECT_DATA_DIR, directory, filename)
        if not os.path.exists(file_path):
            logger.warning(f"Notification for non-existent file: {file_path}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return JSONResponse(
                status_code=404,
                content={"detail": f"File not found: {filename}"},
                headers=headers
            )

        # File exists and user is authorized - send success response
        headers = {}
        headers = add_cors_headers(headers, request)
        return JSONResponse(
            status_code=200,
            content={"detail": f"File {filename} is ready in directory {directory}"},
            headers=headers
        )

    except Exception as e:
        # Log the exception
        logger.error(f"Error in file notification: {str(e)}")

        # Ensure CORS headers are included even in case of errors
        headers = {}
        headers = add_cors_headers(headers, request)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Error in file notification: {str(e)}"},
            headers=headers
        )
