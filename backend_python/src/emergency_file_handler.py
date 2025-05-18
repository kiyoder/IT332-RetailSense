import os
import logging
from fastapi import APIRouter, Request, Depends
from fastapi.responses import FileResponse, Response, JSONResponse
from starlette.responses import PlainTextResponse

# Set up logging with maximum verbosity
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("emergency_file_handler")
logger.setLevel(logging.DEBUG)

# Create a router with a different prefix to avoid conflicts
router = APIRouter(prefix="/emergency")

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


@router.options("/{path:path}")
async def options_any_path(path: str, request: Request):
    """Handle OPTIONS requests with proper CORS headers."""
    headers = {}
    headers = add_cors_headers(headers, request)
    return Response(status_code=200, headers=headers)


@router.get("/test")
async def test_endpoint(request: Request):
    """Simple test endpoint to verify the router is working."""
    headers = {}
    headers = add_cors_headers(headers, request)
    return PlainTextResponse("Emergency file handler is working!", headers=headers)


@router.head("/files/{directory}/{filename}")
async def emergency_head_file(directory: str, filename: str, request: Request):
    """
    Emergency HEAD endpoint for checking if files exist.
    """
    try:
        # Log extensive debugging information
        logger.debug(f"EMERGENCY HEAD file request - Directory: {directory}, Filename: {filename}")

        # Construct the file path
        file_path = os.path.join(PROJECT_DATA_DIR, directory, filename)
        logger.debug(f"Checking file existence: {file_path}")

        # Check if file exists
        if not os.path.exists(file_path):
            logger.warning(f"File not found: {file_path}")
            headers = {}
            headers = add_cors_headers(headers, request)
            return Response(status_code=404, headers=headers)

        # Log file details
        file_size = os.path.getsize(file_path)
        logger.debug(f"File exists: {file_path}, Size: {file_size} bytes")

        # Set CORS headers and content info
        headers = {
            "Content-Length": str(file_size),
            "Content-Type": "image/png" if filename.endswith(".png") else "text/csv" if filename.endswith(
                ".csv") else "application/octet-stream"
        }
        headers = add_cors_headers(headers, request)

        logger.debug(f"Returning HEAD response with headers: {headers}")
        return Response(status_code=200, headers=headers)

    except Exception as e:
        # Log the exception with full details
        logger.error(f"Emergency HEAD handler error: {str(e)}", exc_info=True)

        # Ensure CORS headers are included even in case of errors
        headers = {}
        headers = add_cors_headers(headers, request)
        return Response(status_code=500, headers=headers)


@router.get("/files/{directory}/{filename}")
async def emergency_get_file(directory: str, filename: str, request: Request):
    """
    Emergency file serving endpoint that bypasses all authorization.
    """
    try:
        # Log extensive debugging information
        logger.debug(f"EMERGENCY GET file request - Directory: {directory}, Filename: {filename}")
        logger.debug(f"Request headers: {request.headers}")

        # Construct the file path
        file_path = os.path.join(PROJECT_DATA_DIR, directory, filename)
        logger.debug(f"Attempting to serve file: {file_path}")

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

        # Log file details
        file_size = os.path.getsize(file_path)
        logger.debug(f"File exists: {file_path}, Size: {file_size} bytes")

        # Set CORS headers
        headers = {}
        headers = add_cors_headers(headers, request)

        # Determine content type
        content_type = "image/png" if filename.endswith(".png") else "text/csv" if filename.endswith(
            ".csv") else "application/octet-stream"
        logger.debug(f"Content type: {content_type}")

        # Return the file with CORS headers
        logger.debug(f"Serving file via emergency handler: {file_path}")

        # Create a FileResponse with explicit headers
        response = FileResponse(
            path=file_path,
            filename=filename,
            media_type=content_type
        )

        # Add CORS headers to the response
        for key, value in headers.items():
            response.headers[key] = value

        logger.debug(f"Response headers: {response.headers}")
        return response

    except Exception as e:
        # Log the exception with full details
        logger.error(f"Emergency handler error: {str(e)}", exc_info=True)

        # Ensure CORS headers are included even in case of errors
        headers = {}
        headers = add_cors_headers(headers, request)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Emergency handler error: {str(e)}"},
            headers=headers
        )


# Instructions for adding this router to main.py:
"""
To use this emergency file handler, add the following to your main.py:

# Import the emergency file handler
try:
    from .emergency_file_handler import router as emergency_router
except ImportError:
    from src.emergency_file_handler import router as emergency_router

# Include the emergency router
app.include_router(emergency_router)

Then restart your FastAPI server and access files using:
http://localhost:8000/emergency/files/{directory}/{filename}

For example:
http://localhost:8000/emergency/files/a312352e-5fc0-4013-ad37-19ecda9ecb6d_20250518_135221/heatmap.png
"""
