import os
import cv2
import json
import numpy as np
import time
import threading
import traceback
from typing import Dict, List, Tuple, Optional, Any, Union

try:
    from .status_utils import save_status_safely
except ImportError:
    from src.status_utils import save_status_safely

from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort

# Define the base directory for storing project data
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")

# Global dictionary to store processing tasks and their status
processing_tasks = {}


class VisionPipeline:
    def __init__(self, directory: str):
        """
        Initialize the vision pipeline for a specific video directory.

        Args:
            directory: The directory name where the video is stored
        """
        self.directory = directory
        self.user_dir = os.path.join(PROJECT_DATA_DIR, directory)
        self.video_path = os.path.join(self.user_dir, "cctv.mp4")
        self.coords_path = os.path.join(self.user_dir, "layout_coordinates.json")
        self.status_path = os.path.join(self.user_dir, "status.json")
        self.heatmap_path = os.path.join(self.user_dir, "heatmap.png")
        self.hourly_counts_path = os.path.join(self.user_dir, "hourly_counts.csv")

        # Initialize status
        self.status = {
            "status": "initializing",
            "progress": 0,
            "message": "Initializing vision pipeline"
        }
        self._save_status()

        # Load models
        self.detector = None  # Will be loaded on demand
        self.tracker = DeepSort(max_age=30)

        # Initialize tracking data
        self.tracks = []
        self.frame_count = 0
        self.total_frames = 0

    def _save_status(self):
        """Save the current status to a JSON file using atomic operations."""
        save_status_safely(self.status_path, self.status)

    def _update_status(self, status: str, progress: int, message: str):
        """Update the processing status."""
        self.status = {
            "status": status,
            "progress": progress,
            "message": message
        }
        self._save_status()

    def _load_corner_coordinates(self) -> List[Dict[str, int]]:
        """Load the corner coordinates from the JSON file."""
        if not os.path.exists(self.coords_path):
            raise FileNotFoundError(f"Corner coordinates file not found: {self.coords_path}")

        with open(self.coords_path, "r") as f:
            return json.load(f)

    def _get_perspective_transform(self, coordinates: List[Dict[str, int]]) -> np.ndarray:
        """
        Calculate the perspective transformation matrix from the 4 corner points.

        Args:
            coordinates: List of 4 corner coordinates in order: top-left, top-right, bottom-right, bottom-left

        Returns:
            The perspective transformation matrix
        """
        if len(coordinates) != 4:
            raise ValueError("Exactly 4 corner points are required")

        # Source points (from the image)
        src_points = np.array([
            [int(coordinates[0]["x"]), int(coordinates[0]["y"])],  # top-left
            [int(coordinates[1]["x"]), int(coordinates[1]["y"])],  # top-right
            [int(coordinates[2]["x"]), int(coordinates[2]["y"])],  # bottom-right
            [int(coordinates[3]["x"]), int(coordinates[3]["y"])]  # bottom-left
        ], dtype=np.float32)

        # Define the destination points (rectangle)
        # We'll use a standard size for the floor plan (e.g., 500x500)
        dst_points = np.array([
            [0, 0],  # top-left
            [500, 0],  # top-right
            [500, 500],  # bottom-right
            [0, 500]  # bottom-left
        ], dtype=np.float32)

        # Calculate the perspective transform matrix
        return cv2.getPerspectiveTransform(src_points, dst_points)

    def _initialize_detector(self):
        """Initialize the YOLOv8 detector."""
        if self.detector is None:
            self._update_status("loading", 5, "Loading YOLOv8 model")
            self.detector = YOLO("yolov8n.pt")  # Use the small model for faster processing

    def _detect_people(self, frame: np.ndarray) -> List[List[float]]:
        """
        Detect people in a frame using YOLOv8.

        Args:
            frame: The video frame to process

        Returns:
            List of detections in format [x1, y1, x2, y2, confidence, class_id]
        """
        results = self.detector(frame, classes=0)  # Class 0 is person in COCO dataset

        detections = []
        for result in results:
            boxes = result.boxes.cpu().numpy()
            for box in boxes:
                try:
                    # Explicitly convert numpy values to Python float
                    xyxy = box.xyxy[0]
                    if not isinstance(xyxy, (list, tuple, np.ndarray)) or len(xyxy) != 4:
                        continue

                    x1, y1, x2, y2 = float(xyxy[0]), float(xyxy[1]), float(xyxy[2]), float(xyxy[3])

                    # Handle scalar values
                    if hasattr(box.conf, 'item'):
                        confidence = float(box.conf.item())
                    else:
                        confidence = float(box.conf[0]) if hasattr(box.conf, '__len__') else float(box.conf)

                    if hasattr(box.cls, 'item'):
                        class_id = float(box.cls.item())
                    else:
                        class_id = float(box.cls[0]) if hasattr(box.cls, '__len__') else float(box.cls)

                    detections.append([x1, y1, x2, y2, confidence, class_id])
                except Exception as e:
                    print(f"Error processing detection: {str(e)}")
                    continue

        return detections

    def _track_people(self, frame: np.ndarray, detections: List[List[float]]) -> List[Any]:
        """
        Track people across frames using DeepSORT with correct detection format.

        Args:
            frame: The video frame
            detections: List of detections from YOLOv8 in format [x1, y1, x2, y2, confidence, class_id]

        Returns:
            List of tracks with track_id, bbox, etc.
        """
        try:
            # Debug: Print the type and structure of detections
            print(
                f"Detections type: {type(detections)}, length: {len(detections) if hasattr(detections, '__len__') else 'N/A'}")

            # Ensure detections is a list
            if not isinstance(detections, list):
                print(f"WARNING: Detections is not a list, it's a {type(detections)}")
                return []

            # Validate and reformat detections for DeepSORT
            # DeepSORT expects format: [[x1, y1, x2, y2], confidence, class_id]
            deepsort_detections = []

            for i, det in enumerate(detections):
                try:
                    # Debug: Print the type and structure of each detection
                    print(f"  Detection {i} type: {type(det)}, value: {det}")

                    # Skip if not a list, tuple, or numpy array
                    if not isinstance(det, (list, tuple, np.ndarray)):
                        print(f"  Skipping detection {i}: Not a list/tuple/array, it's a {type(det)}")
                        continue

                    # Convert numpy arrays to lists
                    if isinstance(det, np.ndarray):
                        det = det.tolist()

                    # Ensure we have exactly 6 elements [x1, y1, x2, y2, confidence, class_id]
                    if len(det) != 6:
                        print(f"  Skipping detection {i}: Expected 6 elements, got {len(det)}")
                        continue

                    # Extract and convert values to Python floats
                    try:
                        x1 = float(det[0])
                        y1 = float(det[1])
                        x2 = float(det[2])
                        y2 = float(det[3])
                        confidence = float(det[4])
                        class_id = float(det[5])
                    except (TypeError, ValueError) as e:
                        print(f"  Error converting detection {i} values to float: {e}")
                        continue

                    # Create bbox as a list of 4 floats
                    bbox = [x1, y1, x2, y2]

                    # Format for DeepSORT: [bbox, confidence, class_id]
                    deepsort_detection = [bbox, confidence, class_id]
                    deepsort_detections.append(deepsort_detection)

                except Exception as e:
                    print(f"  Error processing detection {i}: {str(e)}")
                    continue

            # Debug: Print the number of valid detections
            print(f"Valid DeepSORT detections: {len(deepsort_detections)} out of {len(detections)}")

            # Only proceed if we have valid detections
            if not deepsort_detections:
                return []

            # Update tracks with properly formatted detections
            tracks = self.tracker.update_tracks(deepsort_detections, frame=frame)
            return [track for track in tracks if track.is_confirmed()]

        except Exception as e:
            print(f"Error tracking people: {str(e)}")
            traceback.print_exc()  # Print full stack trace for debugging
            return []

    def _transform_coordinates(self, tracks: List[Any], transform_matrix: np.ndarray) -> List[
        Tuple[int, Tuple[float, float]]]:
        """
        Transform tracked coordinates to floor coordinates using the perspective transform.

        Args:
            tracks: List of tracks from DeepSORT
            transform_matrix: The perspective transformation matrix

        Returns:
            List of (track_id, (x, y)) tuples with transformed coordinates
        """
        transformed_coords = []

        for track in tracks:
            try:
                # Ensure track has required attributes
                if not hasattr(track, 'track_id') or not hasattr(track, 'to_tlbr'):
                    continue

                # Get track ID as integer
                track_id = int(track.track_id)

                # Get bounding box coordinates
                bbox = track.to_tlbr()

                # Ensure bbox is valid and has 4 elements
                if not isinstance(bbox, (list, tuple, np.ndarray)):
                    continue

                # Convert bbox to list if it's a numpy array
                if isinstance(bbox, np.ndarray):
                    bbox = bbox.tolist()

                # Ensure we have exactly 4 elements
                if len(bbox) != 4:
                    continue

                # Convert all coordinates to Python floats explicitly
                x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])

                # Calculate foot position (bottom center of bounding box)
                foot_x = (x1 + x2) / 2.0
                foot_y = y2

                # Prepare point for perspective transform
                point = np.array([[[foot_x, foot_y]]], dtype=np.float32)

                # Apply perspective transformation
                transformed = cv2.perspectiveTransform(point, transform_matrix)

                # Extract transformed coordinates as Python floats
                tx = float(transformed[0][0][0])
                ty = float(transformed[0][0][1])

                # Create a proper tuple for the coordinates
                coord_tuple = (float(tx), float(ty))

                # Add to transformed coordinates list
                transformed_coords.append((int(track_id), coord_tuple))

            except Exception as e:
                print(f"Error transforming track {getattr(track, 'track_id', '?')}: {str(e)}")
                continue

        return transformed_coords

    def _generate_heatmap(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]]) -> np.ndarray:
        """
        Generate a heatmap from the transformed coordinates.

        Args:
            transformed_coords: List of lists of transformed coordinates for each frame

        Returns:
            Heatmap as a numpy array
        """
        import matplotlib
        # Use Agg backend to avoid GUI thread issues
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from matplotlib.colors import LinearSegmentedColormap

        # Create a 500x500 grid for the heatmap (same size as our transformed coordinates)
        heatmap = np.zeros((500, 500), dtype=np.float64)

        # Validate transformed_coords is a list
        if not isinstance(transformed_coords, list):
            print(f"Error: transformed_coords is not a list: {type(transformed_coords)}")
            return heatmap

        # Accumulate presence in the grid
        for frame_idx, frame_coords in enumerate(transformed_coords):
            # Validate frame_coords is a list
            if not isinstance(frame_coords, list):
                print(f"Error: frame_coords at index {frame_idx} is not a list: {type(frame_coords)}")
                continue

            for coord_idx, coord_pair in enumerate(frame_coords):
                try:
                    # Validate coord_pair structure
                    if not isinstance(coord_pair, tuple) or len(coord_pair) != 2:
                        print(f"Error: Invalid coord_pair at frame {frame_idx}, index {coord_idx}: {coord_pair}")
                        continue

                    # Unpack track_id and coordinates
                    track_id, coords = coord_pair

                    # Validate coords is a tuple of two values
                    if not isinstance(coords, tuple) or len(coords) != 2:
                        print(f"Error: Invalid coords format at frame {frame_idx}, track {track_id}: {coords}")
                        continue

                    # Extract and convert coordinates to float
                    x, y = float(coords[0]), float(coords[1])

                    # Clip coordinates to valid range
                    x_idx = int(round(np.clip(x, 0, 499)))
                    y_idx = int(round(np.clip(y, 0, 499)))

                    # Add Gaussian distribution around each point
                    sigma = 10  # Spread of the gaussian
                    size = 3 * sigma

                    # Calculate bounds with clipping
                    x_min = max(0, x_idx - size)
                    x_max = min(500, x_idx + size + 1)
                    y_min = max(0, y_idx - size)
                    y_max = min(500, y_idx + size + 1)

                    # Use vectorized operations for Gaussian calculation
                    y_grid, x_grid = np.mgrid[y_min:y_max, x_min:x_max]
                    gaussian = np.exp(-((x_grid - x_idx) ** 2 + (y_grid - y_idx) ** 2) / (2 * sigma ** 2))
                    heatmap[y_min:y_max, x_min:x_max] += gaussian

                except (ValueError, TypeError, IndexError) as e:
                    print(f"Error processing coordinate at frame {frame_idx}, index {coord_idx}: {str(e)}")
                    continue

        # Normalize the heatmap
        max_value = np.max(heatmap)
        if max_value > 0:
            heatmap = heatmap / max_value

        # Create a custom colormap (blue to red)
        colors = [(0, 0, 1), (0, 1, 1), (0, 1, 0), (1, 1, 0), (1, 0, 0)]
        cmap = LinearSegmentedColormap.from_list('custom_cmap', colors, N=256)

        # Create the heatmap image
        plt.figure(figsize=(10, 10))
        plt.imshow(heatmap, cmap=cmap)
        plt.colorbar(label='Normalized presence')
        plt.title('People Presence Heatmap')
        plt.axis('off')
        plt.tight_layout()
        plt.savefig(self.heatmap_path, dpi=300, bbox_inches='tight')
        plt.close()

        return heatmap

    def _generate_hourly_counts(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]]) -> None:
        """
        Generate hourly people counts and save as CSV.

        Args:
            transformed_coords: List of lists of transformed coordinates for each frame
        """
        import pandas as pd

        # Validate transformed_coords
        if not isinstance(transformed_coords, list):
            print("Error: transformed_coords is not a list")
            return

        # Get video properties
        cap = cv2.VideoCapture(self.video_path)
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        # Calculate video duration in seconds
        duration_seconds = total_frames / fps if fps > 0 else 0

        # Create a DataFrame with hourly counts
        hours = max(1, int(duration_seconds / 3600) + 1)

        # Count unique track IDs per frame and aggregate by hour
        hourly_data = []

        for hour in range(hours):
            start_frame = int(hour * 3600 * fps)
            end_frame = int(min((hour + 1) * 3600 * fps, total_frames))

            # Get frames in this hour, with bounds checking
            start_frame = max(0, min(start_frame, len(transformed_coords) - 1))
            end_frame = max(0, min(end_frame, len(transformed_coords)))

            hour_frames = transformed_coords[start_frame:end_frame]

            # Count unique track IDs in this hour
            unique_ids = set()
            for frame_coords in hour_frames:
                if not isinstance(frame_coords, list):
                    continue

                for coord_pair in frame_coords:
                    try:
                        if not isinstance(coord_pair, tuple) or len(coord_pair) != 2:
                            continue
                        track_id, _ = coord_pair
                        unique_ids.add(int(track_id))
                    except Exception:
                        continue

            count = len(unique_ids)
            hourly_data.append({
                'Hour': hour + 1,
                'People_Count': count
            })

        # Create DataFrame and save to CSV
        df = pd.DataFrame(hourly_data)
        df.to_csv(self.hourly_counts_path, index=False)

    def process_video(self):
        """
        Process the video to generate heatmap and analytics.
        This method is designed to be run in a separate thread.
        """
        try:
            # Check if video file exists
            if not os.path.exists(self.video_path):
                self._update_status("error", 0, f"Video file not found: {self.video_path}")
                return

            # Check if corner coordinates exist
            if not os.path.exists(self.coords_path):
                self._update_status("error", 0, f"Corner coordinates not found: {self.coords_path}")
                return

            # Load corner coordinates
            self._update_status("processing", 10, "Loading corner coordinates")
            coordinates = self._load_corner_coordinates()

            # Calculate perspective transform
            self._update_status("processing", 15, "Calculating perspective transform")
            transform_matrix = self._get_perspective_transform(coordinates)

            # Initialize detector
            self._update_status("processing", 20, "Initializing detector")
            self._initialize_detector()

            # Open the video
            self._update_status("processing", 25, "Opening video file")
            cap = cv2.VideoCapture(self.video_path)

            if not cap.isOpened():
                self._update_status("error", 0, "Could not open video file")
                return

            # Get video properties
            self.total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = float(cap.get(cv2.CAP_PROP_FPS))

            # Store transformed coordinates for each frame
            all_transformed_coords = []

            # Process the video
            self._update_status("processing", 30, "Processing video frames")

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Update progress
                self.frame_count += 1
                progress = min(90, 30 + int(60 * self.frame_count / self.total_frames))
                if self.frame_count % 10 == 0:  # Update status every 10 frames
                    self._update_status(
                        "processing",
                        progress,
                        f"Processing frame {self.frame_count}/{self.total_frames}"
                    )

                # Detect people
                detections = self._detect_people(frame)

                # Track people
                tracks = self._track_people(frame, detections)

                # Transform coordinates
                transformed_coords = self._transform_coordinates(tracks, transform_matrix)

                # Validate transformed_coords before adding to all_transformed_coords
                if not isinstance(transformed_coords, list):
                    transformed_coords = []

                all_transformed_coords.append(transformed_coords)

            # Release the video
            cap.release()

            # Generate heatmap
            self._update_status("processing", 95, "Generating heatmap")
            self._generate_heatmap(all_transformed_coords)

            # Generate hourly counts
            self._update_status("processing", 98, "Generating analytics")
            self._generate_hourly_counts(all_transformed_coords)

            # Complete
            self._update_status("completed", 100, "Processing completed")

        except Exception as e:
            self._update_status("error", 0, f"Error processing video: {str(e)}")
            import traceback
            traceback.print_exc()
            raise


def start_processing(directory: str) -> Dict:
    """
    Start processing a video in a separate thread.

    Args:
        directory: The directory name where the video is stored

    Returns:
        The initial status of the processing task
    """
    # Check if the directory exists
    user_dir = os.path.join(PROJECT_DATA_DIR, directory)
    if not os.path.exists(user_dir):
        return {
            "status": "error",
            "progress": 0,
            "message": f"Directory not found: {directory}"
        }

    # Check if already processing
    if directory in processing_tasks:
        return {
            "status": "already_processing",
            "progress": 0,
            "message": f"Already processing video in directory: {directory}"
        }

    # Create pipeline
    pipeline = VisionPipeline(directory)

    # Start processing in a separate thread
    thread = threading.Thread(target=pipeline.process_video)
    thread.daemon = True
    thread.start()

    # Store the thread and pipeline
    processing_tasks[directory] = {
        "thread": thread,
        "pipeline": pipeline
    }

    return pipeline.status


def get_processing_status(directory: str) -> Dict:
    """
    Get the current status of a processing task.

    Args:
        directory: The directory name where the video is stored

    Returns:
        The current status of the processing task
    """
    try:
        from .status_utils import get_processing_status as get_status
    except ImportError:
        from src.status_utils import get_processing_status as get_status

    return get_status(directory)
