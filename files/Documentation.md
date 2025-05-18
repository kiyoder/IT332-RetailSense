# RetailSense Backend Documentation

## Overview

The RetailSense backend is a FastAPI application that processes CCTV footage to generate heatmaps and analytics of human presence in retail spaces. The system handles user authentication, file uploads, video processing, and result delivery through a series of well-organized modules.

## Core Components

### 1. Main Application (`main.py`)

**Purpose**: The entry point of the FastAPI application that orchestrates all components and middleware.

**Key Features**:
- Sets up CORS middleware with extensive configuration for frontend compatibility
- Initializes Supabase client for authentication and profile management
- Includes all API routers from other modules
- Provides test endpoints and global OPTIONS handler
- Manages WebSocket CORS handling

**Relationships**:
- Integrates all other routers (`file_upload`, `processing`, `emergency`, `file_handler`)
- Uses `auth.py` for authentication dependencies
- Configures project data directory shared across modules

**Important Endpoints**:
- `/api/profile/me`: Gets authenticated user's profile
- `/api/test-auth`: Tests authentication module
- WebSocket routes for real-time updates

### 2. File Upload (`file_upload.py`)

**Purpose**: Handles video file uploads and initial processing steps.

**Key Features**:
- Accepts MP4 video uploads
- Creates unique directories for each user upload
- Extracts first frame as a preview image
- Stores corner coordinates for perspective transformation
- Provides status checking endpoint

**Relationships**:
- Creates files in `PROJECT_DATA_DIR` that `vision_pipeline.py` will process
- Works with `file_handler.py` to serve uploaded files
- Uses `auth.py` for authentication

**Important Endpoints**:
- `/api/upload`: Uploads video file
- `/api/corners/{directory}`: Saves corner coordinates
- `/api/status/{directory}`: Checks processing status

### 3. Video Processing (`processing.py`)

**Purpose**: Manages the video processing workflow and WebSocket connections.

**Key Features**:
- Starts video processing in background threads
- Provides status checking via HTTP and WebSocket
- Validates user access to processing tasks
- Integrates with `vision_pipeline.py` for actual processing
- Uses `websocket_manager.py` for real-time updates

**Relationships**:
- Coordinates with `vision_pipeline.py` for processing
- Uses `websocket_manager.py` for real-time status updates
- Depends on `auth.py` for authentication

**Important Endpoints**:
- `/api/process/{directory}`: Starts processing
- `/api/process/status/{directory}`: Checks status via HTTP
- `/api/ws/process/status/{directory}`: WebSocket for real-time status

### 4. Vision Pipeline (`vision_pipeline.py`)

**Purpose**: Core video processing logic to generate heatmaps and analytics.

**Key Features**:
- Uses YOLOv8 for person detection
- Implements DeepSORT for tracking
- Performs perspective transformation using user-provided coordinates
- Generates heatmaps and hourly counts
- Manages processing status updates

**Relationships**:
- Called by `processing.py` for processing tasks
- Uses `status_utils.py` for status updates
- Reads files created by `file_upload.py`
- Creates output files read by `file_handler.py`

**Key Classes**:
- `VisionPipeline`: Main processing class that handles all steps from detection to heatmap generation

### 5. Status Utilities (`status_utils.py`)

**Purpose**: Manages processing status updates and file operations.

**Key Features**:
- Atomic file operations with locking
- Status broadcasting via WebSocket
- Safe status file reading/writing
- Cross-platform file locking support
- Heatmap existence checking

**Relationships**:
- Used by `vision_pipeline.py` to update status
- Integrates with `websocket_manager.py` for broadcasts
- Works with files in `PROJECT_DATA_DIR`

### 6. WebSocket Manager (`websocket_manager.py`)

**Purpose**: Manages WebSocket connections and real-time status updates.

**Key Features**:
- Tracks active connections by directory
- Thread-safe connection management
- JWT token validation
- Status broadcasting to connected clients
- Connection lifecycle management

**Relationships**:
- Used by `processing.py` for WebSocket endpoints
- Called by `status_utils.py` for broadcasts
- Integrates with `auth.py` for JWT validation

**Key Classes**:
- `ConnectionManager`: Manages active connections and broadcasting

### 7. Authentication (`auth.py`)

**Purpose**: Handles JWT authentication and user validation.

**Key Features**:
- Validates JWT tokens from Supabase
- Extracts user IDs from tokens
- Debugging utilities for token inspection
- Error handling for various authentication scenarios

**Relationships**:
- Used as dependency in most endpoints
- Integrates with Supabase authentication
- Provides user ID to other components

### 8. File Handlers (`file_handler.py` and `emergency_file_handler.py`)

**Purpose**: Serve processed files with proper CORS and authentication.

**Key Features**:
- Serve heatmaps and analytics files
- Handle CORS headers properly
- Validate user access to files
- Emergency bypass for debugging
- HEAD and OPTIONS support

**Relationships**:
- Serve files created by `vision_pipeline.py`
- Work with `auth.py` for authentication
- Alternative emergency handler for debugging

## Data Flow

1. **Upload Phase**:
   - User uploads video via `/api/upload`
   - System creates directory with timestamp
   - First frame extracted and returned for coordinate selection

2. **Coordinate Selection**:
   - User selects 4 corners via frontend
   - Coordinates saved via `/api/corners/{directory}`

3. **Processing Phase**:
   - Processing started via `/api/process/{directory}`
   - Vision pipeline runs in background thread
   - Status updates saved and broadcast via WebSocket

4. **Result Delivery**:
   - Heatmap and analytics files created
   - Files served via `/api/files/{directory}/{filename}`
   - Emergency handler provides bypass if needed

## Key Technical Aspects

- **Threading**: Video processing runs in background threads
- **Atomic Operations**: Status updates use atomic file writes
- **Real-time Updates**: WebSocket provides live progress
- **Cross-platform**: File locking works on Windows and Unix
- **Modular Design**: Components are loosely coupled
- **Error Handling**: Comprehensive error handling throughout

## Directory Structure
```
project_data/  
├── {user_id}_{timestamp}/  
│ ├── cctv.mp4 # Uploaded video  
│ ├── layout.jpg # First frame  
│ ├── layout_coordinates.json # Corner points  
│ ├── status.json # Processing status  
│ ├── heatmap.png # Generated heatmap  
│ └── hourly_counts.csv # Analytics data  
```