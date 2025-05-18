import os
from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import BaseModel
from datetime import datetime

# Import authentication functions from auth.py
try:
    from .auth import get_current_user_id  # When imported as a module
    from .file_upload import router as file_upload_router
    from .processing import router as processing_router
    from .file_handler import router as file_handler_router
    from .emergency_file_handler import router as emergency_router
except ImportError:
    from src.auth import get_current_user_id
    from src.file_upload import router as file_upload_router
    from src.processing import router as processing_router
    from src.file_handler import router as file_handler_router
    from src.emergency_file_handler import router as emergency_router

# Load environment variables from .env file
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # For admin tasks or direct db access
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")  # For client-side, or if backend uses user's JWT for RLS

app = FastAPI()


# Custom exception handler to ensure CORS headers are included in error responses
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    headers = {
        "Access-Control-Allow-Origin": request.headers.get("Origin", "http://localhost:5173"),
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Origin, User-Agent, Cache-Control, Pragma",
        "Access-Control-Allow-Credentials": "true",
    }
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=headers,
    )


# Add CORS middleware with expanded configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Type"],
    max_age=600,
)

app.include_router(file_upload_router, prefix="/api")
app.include_router(processing_router, prefix="/api")
app.include_router(emergency_router)

# Initialize Supabase client (using service role key for backend operations)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class ProfileResponse(BaseModel):
    username: str | None
    first_name: str | None
    last_name: str | None
    role: str | None
    is_profile_complete: bool | None


@app.get("/api/profile/me", response_model=ProfileResponse)
async def read_users_me(current_user_id: str = Depends(get_current_user_id)):
    try:
        response = supabase.table("profiles").select("username, first_name, last_name, role, is_profile_complete").eq(
            "id", current_user_id).single().execute()

        if response.data:
            return response.data
        else:
            # This case should ideally not happen if the trigger creates a profile for every auth.users entry
            # However, if it does, or if there's a delay, this handles it.
            raise HTTPException(status_code=404, detail="Profile not found for user")

    except Exception as e:
        # Log the exception e
        print(f"Error fetching profile from Supabase: {e}")
        # Check if it's a PostgREST error, e.g., from RLS or missing data
        # The supabase-py library might wrap these errors differently
        raise HTTPException(status_code=500, detail=f"Could not fetch profile: {str(e)}")


# Create project_data directory but use custom router instead of StaticFiles
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")
os.makedirs(PROJECT_DATA_DIR, exist_ok=True)

# Include the file handler router for CORS-compatible file serving
app.include_router(file_handler_router, prefix="/api/files")


@app.get("/api/test-auth")
async def test_auth():
    """Test endpoint to verify auth module is loaded"""
    return {"status": "Auth module loaded", "timestamp": str(datetime.now())}


# Global OPTIONS handler for any path to ensure preflight requests are handled
@app.options("/{path:path}")
async def options_route(request: Request, path: str):
    headers = {
        "Access-Control-Allow-Origin": request.headers.get("Origin", "http://localhost:5173"),
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Origin, User-Agent, Cache-Control, Pragma",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "600",
    }
    return JSONResponse(content={}, status_code=200, headers=headers)


# WebSocket CORS handler
@app.websocket_route("/api/ws/{path:path}")
async def websocket_route(websocket: WebSocket, path: str):
    # Extract the origin from the headers
    origin = websocket.headers.get("origin", "")

    # Check if the origin is allowed
    allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
    if origin and origin not in allowed_origins:
        await websocket.close(code=1008, reason="Not allowed by CORS")
        return

    # Accept the connection
    await websocket.accept()

    # Close immediately - this is just a CORS handler
    # The actual WebSocket endpoint is in processing.py
    await websocket.close(code=1000, reason="WebSocket CORS check passed")
