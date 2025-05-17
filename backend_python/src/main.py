import os
from datetime import datetime

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import BaseModel

# Import authentication functions from auth.py
try:
   from .auth import get_current_user_id  # When imported as a module
   from .file_upload import router as file_upload_router
   from .processing import router as processing_router
except ImportError:
   from src.auth import get_current_user_id
   from src.file_upload import router as file_upload_router
   from src.processing import router as processing_router

# Load environment variables from .env file
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # For admin tasks or direct db access
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")  # For client-side, or if backend uses user's JWT for RLS

app = FastAPI()


# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(file_upload_router, prefix="/api")
app.include_router(processing_router, prefix="/api")
# Initialize Supabase client (using service role key for backend operations)
# This allows the backend to fetch data even with RLS, acting as an admin.
# If you want the backend to act strictly on behalf of the user using their JWT for RLS,
# you would initialize the client with anon_key and pass the user's JWT.
# For fetching a user's own profile, using service key is fine after validating user's JWT.
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


# Mount the project_data directory to serve generated files
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")
os.makedirs(PROJECT_DATA_DIR, exist_ok=True)
app.mount("/api/files", StaticFiles(directory=PROJECT_DATA_DIR), name="project_files")

@app.get("/api/test-auth")
async def test_auth():
    """Test endpoint to verify auth module is loaded"""
    return {"status": "Auth module loaded", "timestamp": str(datetime.now())}

# To run this app (save as main.py in src directory):
# cd project/backend_python
# python3.11 -m venv venv
# source venv/bin/activate
# pip3 install -r requirements.txt
# uvicorn src.main:app --reload --port 8000
