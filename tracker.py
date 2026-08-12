import cv2
import numpy as np
import time
import json
import threading
import wsgiref.simple_server

from server import sio, app, send_piano_points, push_frame, run_mjpeg_server

# ============================================================
# LEAPVE — 7-KEY PIANO TRACKER + SOCKET.IO + MJPEG STREAM
# ============================================================

# ============================================================
# 1. ARUCO
# ============================================================
dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
parameters = cv2.aruco.DetectorParameters()
detector = cv2.aruco.ArucoDetector(dictionary, parameters)

# ============================================================
# 2. CAMERA
# ============================================================
cap = cv2.VideoCapture(0, cv2.CAP_V4L2)

if not cap.isOpened():
    print("❌ Could not open PC camera")
    exit()

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"✅ PC camera opened at {width}x{height}")

# ============================================================
# 3. CAMERA PARAMETERS
# ============================================================
camera_matrix = np.array([
    [1000, 0, width / 2],
    [0, 1000, height / 2],
    [0, 0, 1]
], dtype=np.float32)
dist_coeffs = np.zeros((5, 1), dtype=np.float32)

# ============================================================
# 4. ARUCO PHYSICAL SIZE
# ============================================================
marker_size = 0.10
object_points = np.array([
    [-marker_size / 2,  marker_size / 2, 0],
    [ marker_size / 2,  marker_size / 2, 0],
    [ marker_size / 2, -marker_size / 2, 0],
    [-marker_size / 2, -marker_size / 2, 0]
], dtype=np.float32)

# ============================================================
# 5. GLOBAL PIANO CONFIGURATION
# ============================================================
MAX_PIANO_POINTS = 4
piano_points = []
piano_features = None
old_gray = None
piano_polygon = None
last_good_polygon = None
tracking_started = False
tracking_valid = False
bad_frames = 0

# ============================================================
# 6. TRACKING STABILITY
# ============================================================
MIN_FEATURES = 12
MIN_INLIERS = 8
MIN_INLIER_RATIO = 0.55
RANSAC_THRESHOLD = 3.0
MAX_CENTER_MOVE = 35.0
MAX_CORNER_MOVE = 50.0
SMOOTHING = 0.25
MAX_BAD_FRAMES = 5

# ============================================================
# 7. EDGE SNAP
# ============================================================
EDGE_SEARCH_RADIUS = 18
CANNY_LOW = 50
CANNY_HIGH = 150
MIN_EDGE_STRENGTH = 80
EDGE_SNAP_ALPHA = 0.50
MAX_EDGE_MOVE = 15.0

# ============================================================
# 8. KEY CONFIGURATION
# ============================================================
NUM_KEYS = 7
POINTS_PER_KEY = 8
TOTAL_KEY_POINTS = NUM_KEYS * POINTS_PER_KEY

# ============================================================
# 9. KEY CALIBRATION DATA
# ============================================================
key_points_normalized = {str(i): [] for i in range(NUM_KEYS)}
key_points_current = {str(i): None for i in range(NUM_KEYS)}

# ============================================================
# 10. KEY EDITING STATE
# ============================================================
current_key = 0
editing_key = False
selected_key_point = None
dragging_key_point = False
EDIT_RADIUS = 18

# ============================================================
# 11. HOMOGRAPHY
# ============================================================
current_homography = None

# ============================================================
# 12. HELPERS
# ============================================================
def smooth_polygon(old_polygon, new_polygon, alpha=0.25):
    if old_polygon is None:
        return new_polygon.copy()
    old_pts = old_polygon.reshape(-1, 2)
    new_pts = new_polygon.reshape(-1, 2)
    smoothed = old_pts * (1.0 - alpha) + new_pts * alpha
    return smoothed.reshape(-1, 1, 2).astype(np.float32)


def find_nearest_edge_point(gray, point, radius=EDGE_SEARCH_RADIUS):
    x, y = int(round(point[0])), int(round(point[1]))
    h, w = gray.shape
    x1, x2 = max(0, x - radius), min(w, x + radius + 1)
    y1, y2 = max(0, y - radius), min(h, y + radius + 1)

    if x2 <= x1 or y2 <= y1:
        return np.array(point, dtype=np.float32), 0

    roi = gray[y1:y2, x1:x2]
    if roi.size == 0:
        return np.array(point, dtype=np.float32), 0

    blurred = cv2.GaussianBlur(roi, (5, 5), 0)
    edges = cv2.Canny(blurred, CANNY_LOW, CANNY_HIGH)
    ys, xs = np.where(edges > 0)

    if len(xs) == 0:
        return np.array(point, dtype=np.float32), 0

    candidates = np.column_stack([xs + x1, ys + y1]).astype(np.float32)
    predicted = np.array([x, y], dtype=np.float32)
    distances = np.linalg.norm(candidates - predicted, axis=1)
    nearest_index = int(np.argmin(distances))

    if distances[nearest_index] > radius:
        return np.array(point, dtype=np.float32), 0

    snapped = candidates[nearest_index]
    gx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gx, gy)
    sx = int(np.clip(snapped[0] - x1, 0, magnitude.shape[1] - 1))
    sy = int(np.clip(snapped[1] - y1, 0, magnitude.shape[0] - 1))
    strength = float(magnitude[sy, sx])
    return snapped, strength


def snap_polygon_to_edges(gray, polygon):
    pts = polygon.reshape(-1, 2).copy()
    corrected = pts.copy()
    for i, point in enumerate(pts):
        snapped, strength = find_nearest_edge_point(gray, point)
        movement = np.linalg.norm(snapped - point)
        if strength < MIN_EDGE_STRENGTH or movement > MAX_EDGE_MOVE:
            continue
        corrected[i] = point * (1.0 - EDGE_SNAP_ALPHA) + snapped * EDGE_SNAP_ALPHA
    return corrected.reshape(-1, 1, 2).astype(np.float32)


def normalize_point_to_piano(point, piano_quad):
    point = np.array(point, dtype=np.float32).reshape(1, 1, 2)
    quad = np.array(piano_quad, dtype=np.float32).reshape(4, 2)
    src = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(quad, src)
    normalized = cv2.perspectiveTransform(point, H)
    return normalized.reshape(2)


def normalized_to_camera(normalized_points, piano_quad):
    if len(normalized_points) == 0:
        return np.empty((0, 2), dtype=np.float32)
    src = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    dst = np.array(piano_quad, dtype=np.float32).reshape(4, 2)
    H = cv2.getPerspectiveTransform(src, dst)
    pts = np.array(normalized_points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, H).reshape(-1, 2)


def save_key_data():
    if piano_polygon is None:
        print("❌ Cannot save: piano not calibrated")
        return
    data = {
        "project": "LeapVE",
        "version": "1.0",
        "num_keys": NUM_KEYS,
        "points_per_key": POINTS_PER_KEY,
        "piano_reference": {"width": width, "height": height},
        "keys": {}
    }
    for i in range(NUM_KEYS):
        points = key_points_normalized[str(i)]
        data["keys"][str(i + 1)] = {
            "key_index": i,
            "points": [[round(float(p[0]), 6), round(float(p[1]), 6)] for p in points]
        }
    with open("piano_keys.json", "w") as f:
        json.dump(data, f, indent=4)
    print(f"\n✅ Saved piano_keys.json ({NUM_KEYS} keys)")


# ============================================================
# 13. MOUSE CALLBACK
# ============================================================
def mouse_callback(event, x, y, flags, param):
    global piano_points, piano_polygon
    global selected_key_point, dragging_key_point
    global key_points_normalized, key_points_current, current_key

    if not tracking_started:
        if event == cv2.EVENT_LBUTTONDOWN and len(piano_points) < MAX_PIANO_POINTS:
            piano_points.append([x, y])
            print(f"Piano P{len(piano_points)}: ({x}, {y})")
        return

    if editing_key:
        key_id = str(current_key)
        current_points = key_points_current[key_id]
        if current_points is None:
            current_points = []
        current_points = np.array(current_points, dtype=np.float32)

        if event == cv2.EVENT_LBUTTONDOWN:
            if len(current_points) < POINTS_PER_KEY:
                normalized = normalize_point_to_piano([x, y], piano_polygon.reshape(4, 2))
                key_points_normalized[key_id].append(normalized)
                key_points_current[key_id] = normalized_to_camera(
                    key_points_normalized[key_id], piano_polygon.reshape(4, 2)
                )
                print(f"KEY {current_key + 1} P{len(current_points) + 1} added")
                return

            distances = np.linalg.norm(current_points - np.array([x, y], dtype=np.float32), axis=1)
            nearest = int(np.argmin(distances))
            if distances[nearest] <= EDIT_RADIUS:
                selected_key_point = nearest
                dragging_key_point = True
                print(f"Dragging Key {current_key + 1} P{nearest + 1}")

        elif event == cv2.EVENT_MOUSEMOVE and dragging_key_point and selected_key_point is not None:
            normalized = normalize_point_to_piano([x, y], piano_polygon.reshape(4, 2))
            key_points_normalized[key_id][selected_key_point] = normalized
            key_points_current[key_id] = normalized_to_camera(
                key_points_normalized[key_id], piano_polygon.reshape(4, 2)
            )

        elif event == cv2.EVENT_LBUTTONUP and dragging_key_point:
            print(f"Key {current_key + 1} P{selected_key_point + 1} corrected")
            dragging_key_point = False
            selected_key_point = None


# ============================================================
# 14. WINDOWS (plain ASCII + correct order)
# ============================================================
window_name = "LeapVE Piano + 7 Key Calibration"

cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
cv2.resizeWindow(window_name, width, height)
cv2.setMouseCallback(window_name, mouse_callback)

cv2.namedWindow("Raw Canny", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Raw Canny", 640, 360)

cv2.namedWindow("Masked Canny (Piano)", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Masked Canny (Piano)", 640, 360)

print("✅ Windows created")

# ============================================================
# 15. START SERVERS
# ============================================================
def run_socket_server():
    server = wsgiref.simple_server.make_server("0.0.0.0", 5000, app)
    print("🚀 LeapVE Socket.IO server running on http://0.0.0.0:5000")
    server.serve_forever()

socket_thread = threading.Thread(target=run_socket_server, daemon=True)
socket_thread.start()

# Start MJPEG stream server  (NEW)
mjpeg_thread = threading.Thread(target=run_mjpeg_server, daemon=True)
mjpeg_thread.start()

# ============================================================
# 16. MAIN LOOP
# ============================================================
previous_time = time.time()

# Socket.IO throttle
last_socket_time = 0
SOCKET_INTERVAL = 1.0 / 30   # cap at 30 fps

while True:
    ret, frame = cap.read()
    if not ret:
        print("❌ Failed to read camera frame")
        break

    # Push frame to MJPEG streamer  (NEW)
    push_frame(frame)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    raw_canny = cv2.Canny(blurred, CANNY_LOW, CANNY_HIGH)

    # ARUCO
    corners, ids, _ = detector.detectMarkers(gray)
    aruco_detected = False
    if ids is not None:
        cv2.aruco.drawDetectedMarkers(frame, corners, ids)
        for mc, mid in zip(corners, ids):
            ok, rvec, tvec = cv2.solvePnP(
                object_points, mc.reshape(4, 2).astype(np.float32),
                camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_IPPE_SQUARE
            )
            if ok:
                aruco_detected = True
                cv2.drawFrameAxes(frame, camera_matrix, dist_coeffs, rvec, tvec, 0.08, 3)

    # START TRACKING
    if len(piano_points) == MAX_PIANO_POINTS and piano_features is None:
        mask = np.zeros_like(gray)
        cv2.polylines(mask, [np.array(piano_points, np.int32)], True, 255, 35)
        piano_features = cv2.goodFeaturesToTrack(gray, 150, 0.02, 8, mask=mask)
        piano_polygon = np.float32(piano_points).reshape(-1, 1, 2)
        last_good_polygon = piano_polygon.copy()
        old_gray = gray.copy()
        tracking_started = True
        tracking_valid = True
        bad_frames = 0
        print("\n✅ Piano tracking started")

    # OPTICAL FLOW + HOMOGRAPHY
    if piano_features is not None and old_gray is not None:
        new_feats, status, _ = cv2.calcOpticalFlowPyrLK(
            old_gray, gray, piano_features, None,
            winSize=(21, 21), maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)
        )
        if new_feats is not None:
            status = status.flatten()
            good_old = piano_features[status == 1]
            good_new = new_feats[status == 1]

            if len(good_new) >= MIN_FEATURES:
                H, mask_h = cv2.findHomography(good_old, good_new, cv2.RANSAC, RANSAC_THRESHOLD)
                if H is not None and mask_h is not None:
                    inliers = mask_h.flatten().astype(bool)
                    if (np.sum(inliers) >= MIN_INLIERS and
                        np.sum(inliers) / max(len(good_new), 1) >= MIN_INLIER_RATIO and
                        piano_polygon is not None):

                        proposed = cv2.perspectiveTransform(piano_polygon, H)
                        old_pts = piano_polygon.reshape(-1, 2)
                        new_pts = proposed.reshape(-1, 2)

                        ok = True
                        if np.max(np.linalg.norm(new_pts - old_pts, axis=1)) > MAX_CORNER_MOVE:
                            ok = False
                        if np.linalg.norm(np.mean(new_pts, 0) - np.mean(old_pts, 0)) > MAX_CENTER_MOVE:
                            ok = False
                        oa = abs(cv2.contourArea(old_pts.astype(np.float32)))
                        na = abs(cv2.contourArea(new_pts.astype(np.float32)))
                        if oa > 0 and not (0.70 < na / oa < 1.30):
                            ok = False

                        if ok:
                            piano_polygon = smooth_polygon(piano_polygon, proposed, SMOOTHING)
                            last_good_polygon = piano_polygon.copy()
                            current_homography = H
                            tracking_valid = True
                            bad_frames = 0
                        else:
                            bad_frames += 1
                            tracking_valid = False
                    else:
                        bad_frames += 1
                        tracking_valid = False
                else:
                    bad_frames += 1
                    tracking_valid = False
            else:
                bad_frames += 1
                tracking_valid = False

            piano_features = good_new.reshape(-1, 1, 2) if len(good_new) >= MIN_FEATURES else None
        else:
            piano_features = None
        old_gray = gray.copy()

    if bad_frames >= MAX_BAD_FRAMES:
        print("⚠ Piano tracking temporarily lost")
        piano_features = None
        old_gray = None
        bad_frames = 0

    # TRANSFORM KEY POINTS
    if piano_polygon is not None:
        current_quad = piano_polygon.reshape(4, 2)
        for i in range(NUM_KEYS):
            key_id = str(i)
            pts = key_points_normalized[key_id]
            if len(pts) == 0:
                key_points_current[key_id] = None
            else:
                key_points_current[key_id] = normalized_to_camera(pts, current_quad)

    # ========================================================
    # SEND 4 LIVE PIANO POINTS TO THREE.JS  (throttled)
    # ========================================================
    now = time.time()
    if piano_polygon is not None:
        if now - last_socket_time >= SOCKET_INTERVAL:
            live_points = piano_polygon.reshape(4, 2).tolist()
            send_piano_points(live_points)
            last_socket_time = now

    # MASKED CANNY
    masked_canny = np.zeros_like(raw_canny)
    if piano_polygon is not None:
        poly_mask = np.zeros_like(gray)
        cv2.fillPoly(poly_mask, [piano_polygon.reshape(-1, 1, 2).astype(np.int32)], 255)
        masked_canny = cv2.bitwise_and(raw_canny, raw_canny, mask=poly_mask)

    # DRAW
    if not tracking_started:
        for i, p in enumerate(piano_points):
            cv2.circle(frame, tuple(p), 8, (0, 255, 0), -1)
            cv2.putText(frame, f"P{i+1}", (p[0]+10, p[1]-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
        if len(piano_points) > 1:
            for i in range(len(piano_points)-1):
                cv2.line(frame, tuple(piano_points[i]), tuple(piano_points[i+1]), (255, 0, 0), 2)

    if piano_polygon is not None:
        pts = piano_polygon.astype(np.int32)
        cv2.polylines(frame, [pts], True, (0, 255, 255), 3)
        for i, point in enumerate(pts.reshape(-1, 2)):
            cv2.circle(frame, (int(point[0]), int(point[1])), 6, (0, 255, 0), -1)
            cv2.putText(frame, f"P{i+1}", (int(point[0])+7, int(point[1])-7),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

    for i in range(NUM_KEYS):
        key_pts = key_points_current[str(i)]
        if key_pts is None or len(key_pts) == 0:
            continue
        pts = np.array(key_pts, dtype=np.int32)
        color = (0, 0, 255) if (editing_key and i == current_key) else (255, 180, 0)
        if len(pts) >= 2:
            cv2.polylines(frame, [pts], len(pts) >= POINTS_PER_KEY, color, 2)
        center = np.mean(pts, axis=0).astype(int)
        cv2.putText(frame, f"K{i+1}", tuple(center), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        for j, p in enumerate(pts):
            r = 9 if (editing_key and i == current_key and selected_key_point == j) else 5
            c = (0, 0, 255) if r == 9 else (0, 255, 0)
            cv2.circle(frame, (int(p[0]), int(p[1])), r, c, -1)

    # STATUS
    status = "ARUCO: LOCKED" if aruco_detected else "ARUCO: SEARCHING"
    cv2.putText(frame, status, (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                (0, 255, 0) if aruco_detected else (0, 0, 255), 2)

    if not tracking_started:
        txt, col = f"PIANO: SELECT {len(piano_points)}/4 POINTS", (255, 255, 255)
    else:
        txt = "PIANO: TRACKING" if tracking_valid else "PIANO: HOLDING"
        col = (0, 255, 0) if tracking_valid else (0, 165, 255)
    cv2.putText(frame, txt, (20, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 2)

    if tracking_started:
        cnt = len(key_points_normalized[str(current_key)])
        txt = f"KEY {current_key+1}/7 | POINTS {cnt}/8"
        if editing_key:
            txt += " | EDIT MODE"
        cv2.putText(frame, txt, (20, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)

    calibrated = sum(len(key_points_normalized[str(i)]) for i in range(NUM_KEYS))
    cv2.putText(frame, f"KEY CALIBRATION: {calibrated}/56", (20, 125),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

    now = time.time()
    fps = 1.0 / (now - previous_time) if now > previous_time else 0
    previous_time = now
    cv2.putText(frame, f"FPS: {fps:.1f}", (20, 155), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

    if not tracking_started:
        instr = "Click 4 piano corners"
    elif not editing_key:
        instr = "1-7 = select key | S = save | R = reset | Q = quit"
    else:
        instr = f"KEY {current_key+1}: Click 8 points | N = next | S = save | E = exit edit"
    cv2.putText(frame, instr, (20, frame.shape[0]-20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

    # SHOW
    cv2.imshow(window_name, frame)
    cv2.imshow("Raw Canny", raw_canny)
    cv2.imshow("Masked Canny (Piano)", masked_canny)

    # KEYBOARD
    key = cv2.waitKey(1) & 0xFF
    if key == ord("q") or key == 27:
        break
    if key == ord("r"):
        piano_points = []
        piano_features = None
        old_gray = None
        piano_polygon = None
        last_good_polygon = None
        tracking_started = False
        tracking_valid = False
        bad_frames = 0
        current_homography = None
        editing_key = False
        current_key = 0
        selected_key_point = None
        dragging_key_point = False
        for i in range(NUM_KEYS):
            key_points_normalized[str(i)] = []
            key_points_current[str(i)] = None
        print("\n🔄 COMPLETE CALIBRATION RESET")
    if key == ord("s"):
        save_key_data()
    if tracking_started and key in [ord(str(i)) for i in range(1, 8)]:
        current_key = key - ord("1")
        editing_key = True
        selected_key_point = None
        dragging_key_point = False
        print(f"\n🎹 Editing KEY {current_key + 1}")
    if key == ord("n") and tracking_started:
        if current_key < NUM_KEYS - 1:
            current_key += 1
            editing_key = True
            print(f"\n🎹 Editing KEY {current_key + 1}")
        else:
            print("\n✅ All 7 keys reached")
    if key == ord("e"):
        editing_key = False
        selected_key_point = None
        dragging_key_point = False
        print("\nExited key edit mode")

cap.release()
cv2.destroyAllWindows()
print("LeapVE stopped.")
