import os
import cv2
import json
import numpy as np
import time
import threading
from typing import Dict, List, Tuple, Optional
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
        """Save the current status to a JSON file."""
        with open(self.status_path, "w") as f:
            json.dump(self.status, f)

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
            [coordinates[0]["x"], coordinates[0]["y"]],  # top-left
            [coordinates[1]["x"], coordinates[1]["y"]],  # top-right
            [coordinates[2]["x"], coordinates[2]["y"]],  # bottom-right
            [coordinates[3]["x"], coordinates[3]["y"]]  # bottom-left
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
                x1, y1, x2, y2 = box.xyxy[0]
                confidence = box.conf[0]
                class_id = box.cls[0]
                detections.append([x1, y1, x2, y2, confidence, class_id])

        return detections

    def _track_people(self, frame: np.ndarray, detections: List[List[float]]) -> List[Dict]:
        """
        Track people across frames using DeepSORT.

        Args:
            frame: The video frame
            detections: List of detections from YOLOv8

        Returns:
            List of tracks with track_id, bbox, etc.
        """
        tracks = self.tracker.update_tracks(detections, frame=frame)
        return [track.to_tlbr() for track in tracks if track.is_confirmed()]

    # def _transform_coordinates(self, tracks: List, transform_matrix: np.ndarray) -> List[
    #     Tuple[int, Tuple[float, float]]]:
    #     """
    #     Transform the tracked coordinates to floor coordinates using the perspective transform.
    #
    #     Args:
    #         tracks: List of tracks from DeepSORT
    #         transform_matrix: The perspective transformation matrix
    #
    #     Returns:
    #         List of (track_id, (x, y)) tuples with transformed coordinates
    #     """
    #     transformed_coords = []
    #
    #     for track in tracks:
    #         if hasattr(track, 'track_id'):
    #             track_id = track.track_id
    #             # Get the bottom center point of the bounding box (feet position)
    #             bbox = track.to_tlbr()
    #             x1, y1, x2, y2 = bbox
    #             foot_x = (x1 + x2) / 2.0
    #             foot_y = y2 * 1.0
    #
    #             # Apply perspective transformation
    #             point = np.array([[[foot_x, foot_y]]], dtype=np.float32)
    #             transformed_point = cv2.perspectiveTransform(point, transform_matrix)[0][0]
    #
    #             transformed_coords.append((
    #                 int(track_id),
    #                 (float(transformed_point[0]), float(transformed_point[1]))
    #             ))
    #
    #     return transformed_coords
    #
    # def _generate_heatmap(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]]) -> np.ndarray:
    #     """
    #     Generate a heatmap from the transformed coordinates.
    #
    #     Args:
    #         transformed_coords: List of lists of transformed coordinates for each frame
    #
    #     Returns:
    #         Heatmap as a numpy array
    #     """
    #     import matplotlib.pyplot as plt
    #     from matplotlib.colors import LinearSegmentedColormap
    #
    #     # Create a 500x500 grid for the heatmap (same size as our transformed coordinates)
    #     heatmap = np.zeros((500, 500))
    #
    #     # Accumulate presence in the grid
    #     for frame_coords in transformed_coords:
    #         for _, (x, y) in frame_coords:
    #             if 0 <= x < 500 and 0 <= y < 500:
    #                 # Add a gaussian blob around each point
    #                 x, y = int(x), int(y)
    #                 sigma = 10  # Spread of the gaussian
    #                 for i in range(max(0, x - 3 * sigma), min(500, x + 3 * sigma)):
    #                     for j in range(max(0, y - 3 * sigma), min(500, y + 3 * sigma)):
    #                         heatmap[j, i] += np.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * sigma ** 2))
    #
    #     # Normalize the heatmap
    #     if np.max(heatmap) > 0:
    #         heatmap = heatmap / np.max(heatmap)
    #
    #     # Create a custom colormap (blue to red)
    #     colors = [(0, 0, 1), (0, 1, 1), (0, 1, 0), (1, 1, 0), (1, 0, 0)]
    #     cmap = LinearSegmentedColormap.from_list('custom_cmap', colors, N=256)
    #
    #     # Create the heatmap image
    #     plt.figure(figsize=(10, 10))
    #     plt.imshow(heatmap, cmap=cmap)
    #     plt.colorbar(label='Normalized presence')
    #     plt.title('People Presence Heatmap')
    #     plt.axis('off')
    #     plt.tight_layout()
    #     plt.savefig(self.heatmap_path, dpi=300, bbox_inches='tight')
    #     plt.close()
    #
    #     return heatmap

    def _transform_coordinates(self, tracks: List, transform_matrix: np.ndarray) -> List[
        Tuple[int, Tuple[float, float]]]:
        """Transform tracked coordinates to floor coordinates."""
        transformed_coords = []

        for track in tracks:
            if not hasattr(track, 'to_tlbr'):
                continue

            try:
                bbox = track.to_tlbr()
                if len(bbox) != 4:  # Ensure we have [x1, y1, x2, y2]
                    continue

                # Convert all coordinates to Python floats explicitly
                x1, y1, x2, y2 = map(float, bbox)
                foot_x = (x1 + x2) / 2.0
                foot_y = float(y2)

                # Prepare input for perspectiveTransform
                point = np.array([[[foot_x, foot_y]]], dtype=np.float32)
                transformed = cv2.perspectiveTransform(point, transform_matrix)

                # Extract and convert results
                if transformed.size >= 2:
                    x, y = map(float, transformed[0][0])
                    transformed_coords.append((int(track.track_id), (x, y)))

            except Exception as e:
                print(f"Error transforming track {getattr(track, 'track_id', '?')}: {str(e)}")
                continue

        return transformed_coords

    def _generate_heatmap(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]]) -> np.ndarray:
        """Generate heatmap from transformed coordinates."""
        heatmap = np.zeros((500, 500), dtype=np.float64)

        for frame_coords in transformed_coords:
            for _, (x, y) in frame_coords:
                try:
                    # Ensure coordinates are valid numbers
                    x = float(x)
                    y = float(y)
                    x_idx = int(round(np.clip(x, 0, 499)))
                    y_idx = int(round(np.clip(y, 0, 499)))

                    # Add Gaussian distribution
                    sigma = 10
                    size = 3 * sigma
                    x_min = max(0, x_idx - size)
                    x_max = min(500, x_idx + size + 1)
                    y_min = max(0, y_idx - size)
                    y_max = min(500, y_idx + size + 1)

                    # Vectorized Gaussian calculation
                    xx, yy = np.mgrid[x_min:x_max, y_min:y_max]
                    heatmap[y_min:y_max, x_min:x_max] += np.exp(-((xx - x_idx) ** 2 + (yy - y_idx) ** 2) / (2 * sigma ** 2))

                except (ValueError, TypeError) as e:
                    print(f"Invalid coordinate ({x}, {y}): {str(e)}")
                    continue

    # Normalize if needed
        if np.max(heatmap) > 0:
            heatmap /= np.max(heatmap)

        return heatmap

    def _generate_hourly_counts(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]]) -> None:
        """
        Generate hourly people counts and save as CSV.

        Args:
            transformed_coords: List of lists of transformed coordinates for each frame
        """
        import pandas as pd

        # Get video properties
        cap = cv2.VideoCapture(self.video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        # Calculate video duration in seconds
        duration_seconds = total_frames / fps if fps > 0 else 0

        # For demonstration, we'll create synthetic hourly data
        # In a real implementation, you would use timestamps from the video

        # Create a DataFrame with hourly counts
        hours = int(duration_seconds / 3600) + 1

        # Count unique track IDs per frame and aggregate by hour
        hourly_data = []

        for hour in range(hours):
            start_frame = int(hour * 3600 * fps)
            end_frame = int(min((hour + 1) * 3600 * fps, total_frames))

            # Get frames in this hour
            hour_frames = transformed_coords[start_frame:end_frame]

            # Count unique track IDs in this hour
            unique_ids = set()
            for frame_coords in hour_frames:
                for track_id, _ in frame_coords:
                    unique_ids.add(track_id)

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
            fps = cap.get(cv2.CAP_PROP_FPS)

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
    # Check if the directory exists
    user_dir = os.path.join(PROJECT_DATA_DIR, directory)
    if not os.path.exists(user_dir):
        return {
            "status": "error",
            "progress": 0,
            "message": f"Directory not found: {directory}"
        }

    # Check if status file exists
    status_path = os.path.join(user_dir, "status.json")
    if os.path.exists(status_path):
        with open(status_path, "r") as f:
            return json.load(f)

    # Check if heatmap exists
    heatmap_path = os.path.join(user_dir, "heatmap.png")
    if os.path.exists(heatmap_path):
        return {
            "status": "completed",
            "progress": 100,
            "message": "Processing completed"
        }

    return {
        "status": "unknown",
        "progress": 0,
        "message": "Processing status unknown"
    }
