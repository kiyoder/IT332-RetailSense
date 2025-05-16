import os
import jwt
import requests
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import BaseModel
from starlette.status import HTTP_403_FORBIDDEN, HTTP_401_UNAUTHORIZED

# Load environment variables from .env file
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") # For admin tasks or direct db access
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") # For client-side, or if backend uses user's JWT for RLS
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET") # If using Supabase JWT secret directly (less common for external validation)

# It's generally better to use JWKS for JWT verification
# Construct the JWKS URL from your Supabase URL
# Example: https://<your-project-ref>.supabase.co/auth/v1/.well-known/jwks.json
# Ensure your SUPABASE_URL is set correctly, e.g., https://<project-ref>.supabase.co
if not SUPABASE_URL or not SUPABASE_URL.startswith("https://"):
    print("Warning: SUPABASE_URL is not set correctly or is missing. JWT verification might fail.")
    JWKS_URL = None
else:
    # Derive project_ref from SUPABASE_URL (e.g., https://xyz.supabase.co -> xyz)
    try:
        project_ref_part = SUPABASE_URL.split(".")[0].split("//")[1]
        JWKS_URL = f"https://{project_ref_part}.supabase.co/auth/v1/.well-known/jwks.json"
    except IndexError:
        print("Warning: Could not derive JWKS_URL from SUPABASE_URL. JWT verification might fail.")
        JWKS_URL = None

app = FastAPI()

# Initialize Supabase client (using service role key for backend operations)
# This allows the backend to fetch data even with RLS, acting as an admin.
# If you want the backend to act strictly on behalf of the user using their JWT for RLS, 
# you would initialize the client with anon_key and pass the user's JWT.
# For fetching a user's own profile, using service key is fine after validating user's JWT.
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

security = HTTPBearer()

# Cache for JWKS
jwks_cache = None

def get_jwks():
    global jwks_cache
    if jwks_cache:
        return jwks_cache
    if not JWKS_URL:
        raise HTTPException(status_code=500, detail="JWKS URL not configured")
    try:
        response = requests.get(JWKS_URL)
        response.raise_for_status() # Raise an exception for HTTP errors
        jwks_cache = response.json()
        return jwks_cache
    except requests.exceptions.RequestException as e:
        # Log the error appropriately in a real application
        print(f"Error fetching JWKS: {e}")
        raise HTTPException(status_code=500, detail="Could not fetch JWKS")

async def get_current_user_id(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    token = credentials.credentials
    jwks = get_jwks()
    
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid token header")

    rsa_key = {}
    for key in jwks["keys"]:
        if key["kid"] == unverified_header["kid"]:
            rsa_key = {
                "kty": key["kty"],
                "kid": key["kid"],
                "use": key["use"],
                "n": key["n"],
                "e": key["e"]
            }
            break
    
    if rsa_key:
        try:
            payload = jwt.decode(
                token,
                rsa_key,
                algorithms=["RS256"], # Supabase uses RS256
                audience="authenticated", # Default Supabase audience
                # issuer=f"{SUPABASE_URL}/auth/v1" # Check your Supabase issuer if needed
            )
            user_id = payload.get("sub")
            if user_id is None:
                raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="User ID not found in token")
            return user_id
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Token has expired")
        except jwt.InvalidAudienceError:
            raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid token audience")
        except jwt.PyJWTError as e:
            # Catch other JWT errors
            print(f"JWT Error: {e}")
            raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    
    raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Could not validate credentials (RSA key not found)")

class ProfileResponse(BaseModel):
    username: str | None
    first_name: str | None
    last_name: str | None
    role: str | None
    is_profile_complete: bool | None

@app.get("/api/profile/me", response_model=ProfileResponse)
async def read_users_me(current_user_id: str = Depends(get_current_user_id)):
    try:
        response = supabase.table("profiles").select("username, first_name, last_name, role, is_profile_complete").eq("id", current_user_id).single().execute()
        
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

# To run this app (save as main.py in src directory):
# cd project/backend_python
# python3.11 -m venv venv
# source venv/bin/activate
# pip3 install -r requirements.txt
# uvicorn src.main:app --reload --port 8000

