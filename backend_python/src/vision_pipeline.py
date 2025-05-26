import os
import cv2
import json
import numpy as np
import time
import threading
import traceback
from typing import Dict, List, Tuple, Optional, Any, Union

try:
    from .status_utils import save_status_safely, load_status
except ImportError:
    from src.status_utils import save_status_safely, load_status

from ultralytics import YOLO
import matplotlib.cm
from deep_sort_realtime.deepsort_tracker import DeepSort

# Define the base directory for storing project data
PROJECT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_data")

# Thread-safe lock for accessing shared resources
processing_lock = threading.RLock()

# Global dictionary to store processing tasks and their status
processing_tasks = {}

# Global dictionary to track the highest progress for each directory
# This prevents progress from resetting to 0% after completion
highest_progress = {}


class VisionPipeline:
    def __init__(self, directory: str):
        """
        Initialize the vision pipeline for a specific video directory.

        Args:
            directory: The directory name for this specific video processing instance (e.g., user-id_timestamp)
        """
        self.directory = directory
        self.user_dir = os.path.join(PROJECT_DATA_DIR, directory) # Video-specific outputs go here

        # Derive user_id to locate centralized assets
        # Assuming directory format is "user_id_..."
        self.user_id_for_central_assets = directory.split('_')[0]
        self.central_assets_dir = os.path.join(PROJECT_DATA_DIR, self.user_id_for_central_assets)
        os.makedirs(self.central_assets_dir, exist_ok=True) # Ensure central user asset directory exists

        self.video_path = os.path.join(self.user_dir, "cctv.mp4")
        self.status_path = os.path.join(self.user_dir, "status.json")
        self.heatmap_path = os.path.join(self.user_dir, "heatmap.png")
        self.layout_image_path = os.path.join(self.user_dir, "layout.jpg") # First frame of THIS video (for thumbnail)
        
        # Centralized input assets (shared per user_id_for_central_assets)
        self.coords_path = os.path.join(self.central_assets_dir, "layout_coordinates.json")
        self.base_floorplan_image_path_png = os.path.join(self.central_assets_dir, "base_floorplan.png")
        self.base_floorplan_image_path_jpg = os.path.join(self.central_assets_dir, "base_floorplan.jpg")
        self.heatmap_video_path = os.path.join(self.user_dir, "cctv_heatmap_overlay.mp4") # Path for the output video with heatmap
        self.hourly_counts_path = os.path.join(self.user_dir, "hourly_counts.csv")
        self.aisle_activity_path = os.path.join(self.user_dir, "aisle_activity.json") # New output for aisle analytics
        self.zone_activity_path = os.path.join(self.user_dir, "zone_activity.json") # New output for zone analytics

        # Heatmap visual properties
        self.HEATMAP_OPACITY = 0.6 # 0.0 (fully transparent) to 1.0 (fully opaque) # MODIFIED
        self.HEATMAP_DECAY_FACTOR = 0.90 # For dynamic heatmap video trails. Higher = longer trails. (0.0 to 1.0)
        self.HEATMAP_SIGMA = 10 # Spread of the Gaussian for heatmap points
        self.AISLE_PROXIMITY_THRESHOLD = 25 # Max distance (in transformed pixels) for a point to be considered "in" an aisle

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
        # Update the global highest progress tracker if this progress is higher
        global highest_progress
        current_progress = self.status.get("progress", 0)

        with processing_lock:
            highest_known = highest_progress.get(self.directory, 0)
            if current_progress > highest_known:
                highest_progress[self.directory] = current_progress

        save_status_safely(self.status_path, self.status)

    def _update_status(self, status: str, progress: int, message: str):
        """Update the processing status."""
        # Get the highest progress value we've seen for this directory
        global highest_progress

        with processing_lock:
            highest_known = highest_progress.get(self.directory, 0)

            # Only allow progress to increase or stay the same, never decrease
            # This prevents progress from resetting to 0% after completion
            if progress < highest_known and status != "error":
                progress = highest_known

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
            # print(
            #     f"Detections type: {type(detections)}, length: {len(detections) if hasattr(detections, '__len__') else 'N/A'}")

            # Ensure detections is a list
            if not isinstance(detections, list):
                # print(f"WARNING: Detections is not a list, it's a {type(detections)}")
                return []

            # Validate and reformat detections for DeepSORT
            # DeepSORT expects format: [[x1, y1, x2, y2], confidence, class_id]
            deepsort_detections = []

            for i, det in enumerate(detections):
                try:
                    # Debug: Print the type and structure of each detection
                    # print(f"  Detection {i} type: {type(det)}, value: {det}")

                    # Skip if not a list, tuple, or numpy array
                    if not isinstance(det, (list, tuple, np.ndarray)):
                        # print(f"  Skipping detection {i}: Not a list/tuple/array, it's a {type(det)}")
                        continue

                    # Convert numpy arrays to lists
                    if isinstance(det, np.ndarray):
                        det = det.tolist()

                    # Ensure we have exactly 6 elements [x1, y1, x2, y2, confidence, class_id]
                    if len(det) != 6:
                        # print(f"  Skipping detection {i}: Expected 6 elements, got {len(det)}")
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
                        # print(f"  Error converting detection {i} values to float: {e}")
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
            # print(f"Valid DeepSORT detections: {len(deepsort_detections)} out of {len(detections)}")

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

    def _add_points_to_heatmap(self, heatmap_array: np.ndarray, points: List[Tuple[float, float]]):
        """
        Adds Gaussian spots for a list of (x, y) points to an existing heatmap array.
        The heatmap_array is modified in-place.

        Args:
            heatmap_array: The numpy array representing the heatmap.
            points: A list of (x, y) tuples representing the coordinates to add heat to.
        """
        sigma = self.HEATMAP_SIGMA
        size = 3 * sigma # Effective radius for Gaussian calculation

        for x, y in points:
            # Clip coordinates to be within heatmap dimensions
            x_idx = int(round(np.clip(x, 0, heatmap_array.shape[1] - 1)))
            y_idx = int(round(np.clip(y, 0, heatmap_array.shape[0] - 1)))

            # Define the subgrid for applying the Gaussian
            x_min = max(0, x_idx - size)
            x_max = min(heatmap_array.shape[1], x_idx + size + 1)
            y_min = max(0, y_idx - size)
            y_max = min(heatmap_array.shape[0], y_idx + size + 1)

            if x_min >= x_max or y_min >= y_max: # Ensure grid is valid
                continue

            y_grid, x_grid = np.mgrid[y_min:y_max, x_min:x_max]
            gaussian = np.exp(-((x_grid - x_idx) ** 2 + (y_grid - y_idx) ** 2) / (2 * sigma ** 2))
            heatmap_array[y_min:y_max, x_min:x_max] += gaussian

    def _generate_heatmap(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]]) -> np.ndarray:
        """
        Generate a heatmap from the transformed coordinates.

        Args:
            transformed_coords: List of lists of transformed coordinates for each frame

        Returns:
            Heatmap as a numpy array
        """
        # Raw heatmap data generation, no plotting here

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
                # coord_pair is (track_id, (x,y))
                if isinstance(coord_pair, tuple) and len(coord_pair) == 2:
                    track_id, coords = coord_pair
                    if isinstance(coords, tuple) and len(coords) == 2:
                        # Add just the (x,y) point to the helper
                        self._add_points_to_heatmap(heatmap, [coords])


        # Normalize heatmap
        if np.max(heatmap) > 0:
            heatmap = heatmap / np.max(heatmap)

        return heatmap

    def _create_heatmap_overlay_layers(self, heatmap_data: np.ndarray, target_width: int, target_height: int, M_inv: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Creates the BGR heatmap layer and its alpha mask, warped to target dimensions.

        Args:
            heatmap_data: The raw heatmap data (500x500, normalized float from 0 to 1).
            target_width: Width of the target image to warp to.
            target_height: Height of the target image to warp to.
            M_inv: Inverse perspective transformation matrix.

        Returns:
            A tuple containing (warped_heatmap_bgr, warped_alpha_mask).
        """
        cmap = matplotlib.cm.get_cmap('hot')
        colored_heatmap_rgba = cmap(heatmap_data)
        colored_heatmap_rgba[:, :, 3] *= self.HEATMAP_OPACITY # Apply opacity

        heatmap_bgr_layer = cv2.cvtColor((colored_heatmap_rgba[:, :, :3] * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        heatmap_alpha_layer = (colored_heatmap_rgba[:, :, 3] * 255).astype(np.uint8)

        warped_heatmap_bgr = cv2.warpPerspective(heatmap_bgr_layer, M_inv, (target_width, target_height))
        warped_alpha_mask = cv2.warpPerspective(heatmap_alpha_layer, M_inv, (target_width, target_height))
        
        return warped_heatmap_bgr, warped_alpha_mask

    def _blend_image_with_overlay(self, base_image: np.ndarray, overlay_bgr: np.ndarray, alpha_mask: np.ndarray) -> np.ndarray:
        """Blends an overlay onto a base image using an alpha mask."""
        alpha_normalized = alpha_mask.astype(float) / 255.0
        alpha_expanded = np.expand_dims(alpha_normalized, axis=2)
        base_image_float = base_image.astype(float)
        overlay_bgr_float = overlay_bgr.astype(float)
        blended_float = overlay_bgr_float * alpha_expanded + base_image_float * (1.0 - alpha_expanded)
        return np.clip(blended_float, 0, 255).astype(np.uint8)

    def _save_heatmap_image(self, heatmap_data: np.ndarray) -> str:
        """
        Save the heatmap overlaid on the layout.jpg image.

        Args:
            heatmap_data: The raw heatmap data (500x500, normalized float from 0 to 1)

        Returns:
            Path to the saved heatmap image
        """
        try:
            # Prioritize user-uploaded base_floorplan image
            actual_base_image_path = None
            if os.path.exists(self.base_floorplan_image_path_png):
                actual_base_image_path = self.base_floorplan_image_path_png
            elif os.path.exists(self.base_floorplan_image_path_jpg):
                actual_base_image_path = self.base_floorplan_image_path_jpg
            elif os.path.exists(self.layout_image_path): # Fallback to layout.jpg (first video frame)
                print(f"Warning: User base floorplan image not found. Falling back to layout.jpg for static heatmap.")
                actual_base_image_path = self.layout_image_path
            else:
                raise FileNotFoundError(f"No base image found for heatmap (checked base_floorplan.png/jpg and layout.jpg) in {self.user_dir}")

            base_image = cv2.imread(actual_base_image_path)
            if base_image is None:
                raise ValueError(f"Could not read base image for heatmap: {actual_base_image_path}")
            orig_h, orig_w = base_image.shape[:2]

            coordinates = self._load_corner_coordinates()
            src_points_for_inverse = np.array([
                [int(c["x"]), int(c["y"])] for c in coordinates
            ], dtype=np.float32)
            dst_points_for_inverse = np.array([
                [0, 0], [500, 0], [500, 500], [0, 500] # TL, TR, BR, BL
            ], dtype=np.float32)
            M_inv = cv2.getPerspectiveTransform(dst_points_for_inverse, src_points_for_inverse)

            warped_overlay_bgr, warped_overlay_alpha = self._create_heatmap_overlay_layers(heatmap_data, orig_w, orig_h, M_inv)
            blended_image = self._blend_image_with_overlay(base_image, warped_overlay_bgr, warped_overlay_alpha)
            cv2.imwrite(self.heatmap_path, blended_image)

        except FileNotFoundError as e:
            print(f"Error in _save_heatmap_image (FileNotFound): {str(e)}")
            self._update_status("error", self.status.get("progress", 0), f"Error generating heatmap: {str(e)}")
            raise
        except Exception as e:
            print(f"Error saving heatmap image: {str(e)}")
            traceback.print_exc()
            self._update_status("error", self.status.get("progress", 0), f"Error generating heatmap: {str(e)}")
            raise

        return self.heatmap_path

    def _load_floorplan_layout(self) -> Optional[Dict[str, Any]]:
        """Loads the floorplan_layout.json file."""
        floorplan_file = os.path.join(self.central_assets_dir, "floorplan_layout.json") # Load from central assets dir
        if not os.path.exists(floorplan_file):
            print(f"Warning: Floorplan layout file not found at {floorplan_file}")
            return None
        try:
            with open(floorplan_file, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading floorplan layout: {e}")
            return None

    def _is_point_near_polyline(self, point: Tuple[float, float], polyline_points: List[Tuple[float, float]], threshold: float) -> bool:
        """
        Checks if a point is within a threshold distance of any segment in a polyline.
        Args:
            point: (px, py)
            polyline_points: List of (x,y) tuples defining the polyline.
            threshold: Maximum distance.
        Returns:
            True if the point is near the polyline, False otherwise.
        """
        if len(polyline_points) < 2:
            return False # Not a polyline

        px, py = point
        threshold_squared = threshold * threshold # Compare squared distances to avoid sqrt

        for i in range(len(polyline_points) - 1):
            p1 = polyline_points[i]
            p2 = polyline_points[i+1]
            x1, y1 = p1['x'], p1['y'] # Assuming points are dicts from floorplan_layout.json
            x2, y2 = p2['x'], p2['y']

            # Vector P1P2
            dx, dy = x2 - x1, y2 - y1

            if dx == 0 and dy == 0: # Segment is a point
                dist_sq = (px - x1)**2 + (py - y1)**2
            else:
                # Parameter t for projection of point P onto line P1P2
                # t = ((px - x1) * dx + (py - y1) * dy) / (dx*dx + dy*dy)
                dot_product = (px - x1) * dx + (py - y1) * dy
                len_sq = dx*dx + dy*dy
                t = dot_product / len_sq

                if t < 0: # Closest to p1
                    dist_sq = (px - x1)**2 + (py - y1)**2
                elif t > 1: # Closest to p2
                    dist_sq = (px - x2)**2 + (py - y2)**2
                else: # Projection falls on segment
                    closest_x = x1 + t * dx
                    closest_y = y1 + t * dy
                    dist_sq = (px - closest_x)**2 + (py - closest_y)**2
            
            if dist_sq <= threshold_squared:
                return True
        return False

    def _generate_hourly_counts(self, transformed_coords: List[List[Tuple[int, Tuple[float, float]]]],
                                fps: float, start_time: float) -> str:
        """
        Generate hourly counts of people in the video.

        Args:
            transformed_coords: List of lists of transformed coordinates for each frame
            fps: Frames per second of the video
            start_time: Start time of the video in seconds since epoch

        Returns:
            Path to the saved hourly counts CSV file
        """
        import csv
        from collections import defaultdict
        from datetime import datetime, timedelta

        # Initialize hourly counts
        # Store unique track IDs for each hour to count distinct individuals
        hourly_tracked_ids_per_hour = defaultdict(set)

        # Calculate the number of unique people in each hour
        for frame_idx, frame_coords in enumerate(transformed_coords):
            # Calculate the timestamp for this frame
            frame_time = start_time + frame_idx / fps
            frame_datetime = datetime.fromtimestamp(frame_time)
            hour_key = frame_datetime.strftime('%Y-%m-%d %H:00:00')

            # Add track_ids from this frame to the set for the current hour
            # The set will automatically handle uniqueness of track_ids within the hour
            for coord_pair in frame_coords:
                if isinstance(coord_pair, tuple) and len(coord_pair) == 2:
                    track_id, _ = coord_pair
                    hourly_tracked_ids_per_hour[hour_key].add(track_id)

        # Save to CSV
        with open(self.hourly_counts_path, 'w', newline='') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(['Hour', 'UniquePeopleCount']) # Updated header
            for hour, unique_ids_this_hour in sorted(hourly_tracked_ids_per_hour.items()):
                writer.writerow([hour, len(unique_ids_this_hour)]) # Write the count of unique IDs

        return self.hourly_counts_path

    def _save_aisle_activity(self, aisle_activity_data: Dict[str, Dict[str, Any]]):
        """Saves the aggregated aisle activity data to a JSON file."""
        try:
            # Sort by activity score descending for better readability in the JSON
            sorted_aisle_activity = dict(
                sorted(aisle_activity_data.items(), key=lambda item: item[1].get('activity_score', 0), reverse=True)
            )
            with open(self.aisle_activity_path, "w") as f:
                json.dump(sorted_aisle_activity, f, indent=2)
            print(f"Aisle activity data saved to {self.aisle_activity_path}")
        except Exception as e:
            print(f"Error saving aisle activity data: {e}")
            self._update_status(
                "error",
                self.status.get("progress", 99), # Assume this happens late in processing
                f"Error saving aisle activity: {str(e)}"
            )

    def _save_zone_activity(self, zone_activity_data: Dict[str, Dict[str, Any]]):
        """Saves the aggregated zone activity data to a JSON file."""
        try:
            # Sort by activity score descending for better readability in the JSON
            sorted_zone_activity = dict(
                sorted(zone_activity_data.items(), key=lambda item: item[1].get('activity_score', 0), reverse=True)
            )
            with open(self.zone_activity_path, "w") as f:
                json.dump(sorted_zone_activity, f, indent=2)
            print(f"Zone activity data saved to {self.zone_activity_path}")
        except Exception as e:
            print(f"Error saving zone activity data: {e}")
            self._update_status(
                "error",
                self.status.get("progress", 99), # Assume this happens late in processing
                f"Error saving zone activity: {str(e)}"
            )




    def process_video(self):
        """Process the video to generate heatmap and analytics."""
        try:
            # --- NEW: Check for floorplan layout first ---
            floorplan_layout_path = os.path.join(self.central_assets_dir, "floorplan_layout.json") # Use central_assets_dir
            if not os.path.exists(floorplan_layout_path):
                self._update_status("error", 0, "Floorplan not set. Please define the floorplan layout before processing.")
                return
            try:
                with open(floorplan_layout_path, "r") as f:
                    layout_data = json.load(f)
                    if not layout_data.get("zones") and not layout_data.get("aisles"): # Check if both are missing or empty
                        self._update_status("error", 0, "Floorplan is empty. Please define zones or aisles before processing.")
                        return
            except (json.JSONDecodeError, Exception) as e:
                self._update_status("error", 0, f"Floorplan file is corrupted or invalid: {str(e)}. Please re-save the floorplan.")
                return
            # --- END NEW ---

            # Check if video file exists
            if not os.path.exists(self.video_path):
                self._update_status("error", 0, f"Video file not found: {self.video_path}")
                return

            # Load corner coordinates
            self._update_status("processing", 10, "Loading corner coordinates")
            try:
                coordinates = self._load_corner_coordinates()
                transform_matrix = self._get_perspective_transform(coordinates)
            except Exception as e:
                self._update_status("error", 0, f"Error loading corner coordinates: {str(e)}")
                return

            # Load floorplan layout for aisle analysis
            self._update_status("processing", 12, "Loading floorplan layout for aisle analysis")
            floorplan_layout = self._load_floorplan_layout()
            # --- AISLE TRANSFORMATION AND ACTIVITY INITIALIZATION ---
            aisles_data_transformed = [] # Store transformed aisle data
            if floorplan_layout and "aisles" in floorplan_layout:
                raw_aisles_data = floorplan_layout["aisles"]
                if transform_matrix is not None: # Ensure we have the perspective transform matrix
                    for aisle_def in raw_aisles_data:
                        original_points_dicts = aisle_def.get("points", [])
                        if original_points_dicts and len(original_points_dicts) >= 2:
                            # Convert list of dicts to numpy array for cv2.perspectiveTransform
                            # Ensure points are in [x, y] order
                            np_points_original = np.array([[[p['x'], p['y']] for p in original_points_dicts]], dtype=np.float32)
                            
                            transformed_points_np = cv2.perspectiveTransform(np_points_original, transform_matrix)
                            
                            if transformed_points_np is not None:
                                # Convert back to list of dicts {'x': val, 'y': val} for consistency with _is_point_near_polyline
                                transformed_points_list = [{'x': float(tp[0]), 'y': float(tp[1])} for tp in transformed_points_np[0]]
                                aisles_data_transformed.append({
                                    'id': aisle_def['id'],
                                    'name': aisle_def.get('name', aisle_def['id']),
                                    'points': transformed_points_list # These are now in 0-500 space
                                })
            
            aisle_activity_counts = {aisle['id']: {"name": aisle.get("name", aisle['id']), "activity_score": 0} for aisle in aisles_data_transformed}

            # --- ZONE TRANSFORMATION AND ACTIVITY INITIALIZATION ---
            zones_data_transformed = [] # Store transformed zone data
            if floorplan_layout and "zones" in floorplan_layout:
                raw_zones_data = floorplan_layout["zones"]
                if transform_matrix is not None:
                    for zone_def in raw_zones_data:
                        original_points_dicts = zone_def.get("points", [])
                        if original_points_dicts and len(original_points_dicts) >= 3: # Zones need at least 3 points
                            np_points_original = np.array([[[p['x'], p['y']] for p in original_points_dicts]], dtype=np.float32)
                            transformed_points_np = cv2.perspectiveTransform(np_points_original, transform_matrix)
                            if transformed_points_np is not None:
                                transformed_points_list = [{'x': float(tp[0]), 'y': float(tp[1])} for tp in transformed_points_np[0]]
                                zones_data_transformed.append({
                                    'id': zone_def['id'],
                                    'name': zone_def.get('name', zone_def['id']),
                                    'points': transformed_points_list, # These are now in 0-500 space
                                    'color': zone_def.get('color', '#CCCCCC') # Keep original color for reference
                                })
            
            zone_activity_counts = {zone['id']: {"name": zone.get("name", zone['id']), 
                                                 "activity_score": 0, 
                                                 "color": zone.get('color', '#CCCCCC')} for zone in zones_data_transformed}

            # Initialize detector
            self._update_status("processing", 15, "Initializing object detector")
            self._initialize_detector()

            # Open video
            self._update_status("processing", 20, "Opening video file")
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                self._update_status("error", 0, "Error opening video file")
                return

            # Get video properties
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            self.total_frames = total_frames

            # Initialize tracking data
            transformed_coords = []

            # Determine start_time for hourly counts
            # Prioritize actual_recording_timestamp if available and valid
            start_time_for_hourly_counts = time.time() # Default to current time (upload time)
            metadata_path = os.path.join(self.user_dir, "upload_metadata.json")
            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, "r") as f_meta:
                        upload_meta = json.load(f_meta)
                        if upload_meta.get("actual_recording_timestamp"):
                            start_time_for_hourly_counts = datetime.fromisoformat(upload_meta["actual_recording_timestamp"]).timestamp()
                except Exception as e_meta:
                    print(f"Warning: Could not read actual_recording_timestamp from metadata: {e_meta}")

            # Process video frames
            self._update_status("processing", 25, "Processing video frames")
            frame_count = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Update progress
                frame_count += 1
                self.frame_count = frame_count
                progress = min(25 + int(70 * frame_count / total_frames), 95)
                if frame_count % 10 == 0:  # Update status every 10 frames
                    self._update_status("processing", progress, f"Processing frame {frame_count}/{total_frames}")

                # Detect people
                detections = self._detect_people(frame)

                # Track people
                tracks = self._track_people(frame, detections)

                # Transform coordinates
                frame_transformed_coords = self._transform_coordinates(tracks, transform_matrix)
                transformed_coords.append(frame_transformed_coords)

                # Aggregate aisle activity for this frame
                if aisles_data_transformed: # Use the transformed aisle data
                    for _track_id, (tx, ty) in frame_transformed_coords:
                        for aisle in aisles_data_transformed: # Iterate over transformed aisles
                            if self._is_point_near_polyline((tx, ty), aisle.get('points', []), self.AISLE_PROXIMITY_THRESHOLD):
                                aisle_activity_counts[aisle['id']]['activity_score'] += 1
                                break 
                
                # Aggregate zone activity for this frame
                if zones_data_transformed:
                    for _track_id, (tx, ty) in frame_transformed_coords:
                        for zone in zones_data_transformed: # Iterate over transformed zones
                            # Convert zone points to numpy array for cv2.pointPolygonTest
                            zone_contour_np = np.array([[p['x'], p['y']] for p in zone.get('points', [])], dtype=np.float32)
                            if cv2.pointPolygonTest(zone_contour_np, (tx, ty), False) >= 0: # Point is inside or on the edge
                                zone_activity_counts[zone['id']]['activity_score'] += 1
                                break # Count person for only one aisle per frame, if overlapping

            # Release video
            cap.release()

            # Generate heatmap
            self._update_status("processing", 95, "Generating static heatmap image")
            heatmap_data = self._generate_heatmap(transformed_coords) # This is the CUMULATIVE heatmap for the static image
            self._save_heatmap_image(heatmap_data)

            # --- Generate video with heatmap overlay (Second Pass) ---
            self._update_status("processing", 96, "Generating heatmap video overlay")
            
            cap_for_output = cv2.VideoCapture(self.video_path)
            if not cap_for_output.isOpened():
                print(f"Warning: Could not re-open video {self.video_path} for heatmap overlay generation.")
                self._update_status("processing", 97, "Skipped heatmap video generation (cannot open video)")
            else:
                orig_fps = cap_for_output.get(cv2.CAP_PROP_FPS)
                orig_w = int(cap_for_output.get(cv2.CAP_PROP_FRAME_WIDTH))
                orig_h = int(cap_for_output.get(cv2.CAP_PROP_FRAME_HEIGHT))

                fourcc = cv2.VideoWriter_fourcc(*'mp4v') # Codec for .mp4
                heatmap_video_writer = cv2.VideoWriter(self.heatmap_video_path, fourcc, orig_fps, (orig_w, orig_h))

                if not heatmap_video_writer.isOpened():
                    print(f"Warning: Could not open VideoWriter for {self.heatmap_video_path}")
                    self._update_status("processing", 97, f"Skipped heatmap video generation (cannot create video writer)")
                else:
                    try:
                        # Recalculate M_inv (or reuse if stored, but recalculating is safer and quick)
                        coordinates_inv = self._load_corner_coordinates()
                        src_points_inv = np.array([[int(c["x"]), int(c["y"])] for c in coordinates_inv], dtype=np.float32)
                        dst_points_inv = np.array([[0, 0], [500, 0], [500, 500], [0, 500]], dtype=np.float32)
                        M_inv = cv2.getPerspectiveTransform(dst_points_inv, src_points_inv)

                        dynamic_heatmap_array = np.zeros((500, 500), dtype=np.float64)
                        
                        processed_frames_pass2 = 0
                        total_frames_pass2 = int(cap_for_output.get(cv2.CAP_PROP_FRAME_COUNT))
                        frame_idx_for_coords = 0 # To iterate through transformed_coords

                        while True:
                            ret_pass2, frame_pass2 = cap_for_output.read()
                            if not ret_pass2:
                                break
                            
                            # 1. Decay existing heatmap
                            dynamic_heatmap_array *= self.HEATMAP_DECAY_FACTOR

                            # 2. Add heat from current frame's tracked points
                            if frame_idx_for_coords < len(transformed_coords):
                                current_frame_points = []
                                for _track_id, (tx, ty) in transformed_coords[frame_idx_for_coords]:
                                    current_frame_points.append((tx, ty))
                                if current_frame_points:
                                    self._add_points_to_heatmap(dynamic_heatmap_array, current_frame_points)
                            
                            # 3. Normalize the dynamic heatmap for this frame
                            current_max_heat = np.max(dynamic_heatmap_array)
                            if current_max_heat > 1e-6: # Avoid division by zero or tiny numbers
                                frame_heatmap_normalized = dynamic_heatmap_array / current_max_heat
                            else:
                                frame_heatmap_normalized = np.zeros_like(dynamic_heatmap_array)

                            # 4. Create overlay layers for this frame's heatmap
                            warped_bgr, warped_alpha = self._create_heatmap_overlay_layers(
                                frame_heatmap_normalized, orig_w, orig_h, M_inv
                            )
                            
                            blended_frame = self._blend_image_with_overlay(frame_pass2, warped_bgr, warped_alpha)
                            heatmap_video_writer.write(blended_frame)

                            processed_frames_pass2 +=1
                            frame_idx_for_coords +=1
                            if processed_frames_pass2 % 30 == 0: # Update status less frequently for 2nd pass
                                progress_pass2 = 96 + int(2 * processed_frames_pass2 / total_frames_pass2) # Use 2% of progress for this
                                self._update_status("processing", min(progress_pass2, 97), f"Overlaying heatmap: {processed_frames_pass2}/{total_frames_pass2}")

                    except Exception as e_vid_overlay:
                        print(f"Error during heatmap video overlay generation: {e_vid_overlay}")
                        self._update_status("error", self.status.get("progress", 96), f"Error in heatmap video overlay: {e_vid_overlay}")
                    finally:
                        heatmap_video_writer.release()
                cap_for_output.release()
            
            # Save Aisle Activity
            if aisles_data_transformed: # Check if we have transformed data to save
                self._update_status("processing", 97, "Saving aisle activity data")
                self._save_aisle_activity(aisle_activity_counts)

            # Save Zone Activity
            if zones_data_transformed:
                self._update_status("processing", 98, "Saving zone activity data") # Adjusted progress
                self._save_zone_activity(zone_activity_counts)

            # Generate hourly counts
            self._update_status("processing", 99, "Generating hourly counts") # Adjusted progress
            self._generate_hourly_counts(transformed_coords, fps, start_time_for_hourly_counts)
            self._update_status("completed", 100, "Processing completed")

        except Exception as e:
            print(f"Error processing video: {str(e)}")
            traceback.print_exc()
            self._update_status("error", 0, f"Error processing video: {str(e)}")


def start_processing(directory: str) -> Dict[str, Any]:
    """
    Start processing a video to generate heatmap and analytics.

    Args:
        directory: The directory name where the video is stored

    Returns:
        The initial processing status
    """
    import logging
    logger = logging.getLogger(__name__)

    # Use thread-safe locking to check and update processing_tasks
    with processing_lock:
        # Check if already processing
        if directory in processing_tasks:
            logger.info(f"Already processing video in directory: {directory} (in memory)")
            return {"status": "processing", "progress": 0, "message": "Processing already in progress"}

        # Create pipeline
        pipeline = VisionPipeline(directory)

        # Add to processing tasks
        processing_tasks[directory] = pipeline

    # Start processing in a separate thread
    def process_thread():
        try:
            pipeline.process_video()
        finally:
            # Clean up when processing is done
            with processing_lock:
                if directory in processing_tasks:
                    del processing_tasks[directory]

    thread = threading.Thread(target=process_thread)
    thread.daemon = True  # Allow the thread to be terminated when the main program exits
    thread.start()

    logger.info(f"Started new processing for {directory}")
    return {"status": "processing", "progress": 0, "message": "Processing started"}


def get_processing_status(directory: str) -> Dict[str, Any]:
    """
    Get the status of video processing.

    Args:
        directory: The directory name where the video is stored

    Returns:
        The current processing status
    """
    # Check if processing is active in memory
    with processing_lock:
        if directory in processing_tasks:
            pipeline = processing_tasks[directory]
            return pipeline.status

    # If not in memory, try to load from file
    status_file = os.path.join(PROJECT_DATA_DIR, directory, "status.json")
    if os.path.exists(status_file):
        try:
            with open(status_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading status from file: {str(e)}")

    # Default status if not found
    return {"status": "not_started", "progress": 0, "message": "Processing not started"}


def is_processing_active(directory: str) -> Dict[str, Any]:
    """
    Check if processing is currently active for a directory.

    Args:
        directory: The directory name to check

    Returns:
        Dictionary with active status and current status information
    """
    with processing_lock:
        is_active = directory in processing_tasks

    status = get_processing_status(directory)

    return {
        "is_active": is_active,
        "status": status["status"],
        "progress": status["progress"],
        "message": status["message"]
    }
