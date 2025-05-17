import os
import jwt
import base64
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.status import HTTP_401_UNAUTHORIZED

# Load environment variables from .env file
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

# Print environment variables (masked for security)
print(f"SUPABASE_URL: {SUPABASE_URL}")
print(f"SUPABASE_JWT_SECRET exists: {'Yes' if SUPABASE_JWT_SECRET else 'No'}")
if SUPABASE_JWT_SECRET:
    print(f"SUPABASE_JWT_SECRET length: {len(SUPABASE_JWT_SECRET)}")
    print(f"SUPABASE_JWT_SECRET first 5 chars: {SUPABASE_JWT_SECRET[:5]}...")

# Initialize security
security = HTTPBearer()


def decode_jwt_payload(token):
    """Decode and print JWT payload without verification for debugging"""
    try:
        # Split the token into parts
        parts = token.split('.')
        if len(parts) != 3:
            print(f"Invalid token format: expected 3 parts, got {len(parts)}")
            return None

        # Decode the payload (middle part)
        payload_b64 = parts[1]
        # Add padding if needed
        payload_b64 += '=' * (4 - len(payload_b64) % 4) if len(payload_b64) % 4 != 0 else ''

        try:
            payload_bytes = base64.b64decode(payload_b64)
            payload_str = payload_bytes.decode('utf-8')
            import json
            payload = json.loads(payload_str)
            # print(f"Decoded JWT payload: {json.dumps(payload, indent=2)}")
            return payload
        except Exception as e:
            print(f"Error decoding payload: {e}")
            return None
    except Exception as e:
        print(f"Error in decode_jwt_payload: {e}")
        return None


async def get_current_user_id(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    print("DEBUG: get_current_user_id function called")
    token = credentials.credentials

    # print(f"\n==== AUTHENTICATION ATTEMPT ====")
    # print(f"Received token for validation (first 10 chars): {token[:10]}...")
    # print(f"Token length: {len(token)}")

    # Decode and print JWT payload for debugging (without verification)
    # print("\n==== TOKEN PAYLOAD (NOT VERIFIED) ====")
    payload_debug = decode_jwt_payload(token)

    try:
        # Parse token header
        try:
            unverified_header = jwt.get_unverified_header(token)
            # print(f"\n==== TOKEN HEADER ====")
            # print(f"Algorithm: {unverified_header.get('alg', 'NOT FOUND')}")
            # print(f"Key ID (kid): {unverified_header.get('kid', 'NOT FOUND')}")
            # print(f"Type: {unverified_header.get('typ', 'NOT FOUND')}")
            # print(f"Full header: {unverified_header}")
        except jwt.InvalidTokenError as e:
            print(f"Invalid token header: {str(e)}")
            raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail=f"Invalid token header: {str(e)}")

        # Simplified authentication: only use JWT secret with HS256
        # print("\n==== SIMPLIFIED JWT VALIDATION ====")
        if not SUPABASE_JWT_SECRET:
            print("No JWT secret available")
            raise HTTPException(
                status_code=HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials (JWT secret not configured)"
            )

        # print(f"JWT secret is available (length: {len(SUPABASE_JWT_SECRET)})")

        try:
            # Use HS256 for validation regardless of token alg
            # print("Attempting JWT validation with HS256")
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_aud": False,  # Skip audience verification
                    "verify_iss": False  # Skip issuer verification
                }
            )
            user_id = payload.get("sub")
            if user_id is None:
                print("User ID not found in token payload")
                raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="User ID not found in token")

            # print(f"Successfully validated token using JWT secret with HS256")
            return user_id

        except jwt.ExpiredSignatureError:
            print("Token has expired")
            raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Token has expired")
        except jwt.PyJWTError as e:
            print(f"JWT Error: {e}")
            raise HTTPException(
                status_code=HTTP_401_UNAUTHORIZED,
                detail=f"Could not validate credentials: {str(e)}"
            )

    except Exception as e:
        print(f"Unexpected error during authentication: {str(e)}")
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Authentication error")
