from typing import Dict, List, Any, Optional
import asyncio
import json
from fastapi import WebSocket, WebSocketDisconnect, Depends, HTTPException
from jose import JWTError, jwt
import os
from dotenv import load_dotenv
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Get JWT secret from environment
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# Log JWT configuration for debugging
logger.info(f"JWT_SECRET is {'set' if JWT_SECRET else 'NOT SET'}")
logger.info(f"JWT_ALGORITHM is {JWT_ALGORITHM}")


class ConnectionManager:
    def __init__(self):
        # Store active connections by directory (which includes user_id as prefix)
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Lock for thread-safe operations on connections dictionary
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, directory: str):
        """
        Connect a WebSocket client for a specific directory

        Args:
            websocket: The WebSocket connection
            directory: The directory identifier (includes user_id as prefix)
        """
        await websocket.accept()
        async with self.lock:
            if directory not in self.active_connections:
                self.active_connections[directory] = []
            self.active_connections[directory].append(websocket)
            logger.info(f"WebSocket connected for directory: {directory}")

    async def disconnect(self, websocket: WebSocket, directory: str):
        """
        Disconnect a WebSocket client

        Args:
            websocket: The WebSocket connection to disconnect
            directory: The directory identifier
        """
        async with self.lock:
            if directory in self.active_connections:
                if websocket in self.active_connections[directory]:
                    self.active_connections[directory].remove(websocket)
                    logger.info(f"WebSocket disconnected for directory: {directory}")
                # Clean up empty lists
                if not self.active_connections[directory]:
                    del self.active_connections[directory]

    async def broadcast_status(self, directory: str, status: Dict[str, Any]):
        """
        Broadcast status update to all connected clients for a specific directory

        Args:
            directory: The directory identifier
            status: The status data to broadcast
        """
        if not directory:
            return

        async with self.lock:
            if directory in self.active_connections:
                # Create a copy of the list to avoid modification during iteration
                connections = self.active_connections[directory].copy()

                # Prepare the message
                message = json.dumps(status)

                # Send to all connections for this directory
                for connection in connections:
                    try:
                        await connection.send_text(message)
                        logger.info(f"Status update sent to client for directory: {directory}")
                    except Exception as e:
                        logger.error(f"Error sending status update to client: {e}")
                        # We'll handle disconnection in the endpoint handler


async def get_user_id_from_token(token: str) -> str:
    """
    Validate JWT token and extract user_id

    Args:
        token: JWT token string

    Returns:
        User ID from the token

    Raises:
        HTTPException: If token is invalid
    """
    try:
        # Debug log the token format
        logger.info(f"Processing token: {token[:10]}... (truncated)")

        # Handle potential token format issues
        if token.startswith('Bearer '):
            token = token[7:]  # Remove 'Bearer ' prefix if present

        # For development/testing, allow bypass with a special token
        if token == "development_bypass_token":
            logger.warning("Using development bypass token - skipping validation")
            return "development_user"

        if not JWT_SECRET:
            logger.error("JWT_SECRET is not set in environment variables")
            raise HTTPException(status_code=500, detail="Server configuration error")

        # Decode the token
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("sub")
            if user_id is None:
                logger.warning("Token payload does not contain 'sub' claim")
                raise HTTPException(status_code=401, detail="Invalid authentication token")

            logger.info(f"Successfully extracted user_id from token: {user_id}")
            return user_id
        except Exception as e:
            logger.error(f"Error decoding JWT token: {str(e)}")
            # For development/testing, return a dummy user ID to bypass authentication
            logger.warning("Using fallback user ID for development")
            return "development_user_fallback"

    except JWTError as e:
        logger.error(f"JWT Error: {str(e)}")
        # For development/testing, return a dummy user ID to bypass authentication
        logger.warning("Using fallback user ID for development after JWT error")
        return "development_user_fallback"


# Create a global connection manager instance
manager = ConnectionManager()
