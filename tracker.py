import cv2
import numpy as np
import time
import threading
import wsgiref.simple_server

from server import sio, app, send_piano_points


# ============================================================
# LEAPVE
#
# STAGE 1
#
# 4-POINT PIANO TRACKER
#
# OpenCV
#    ↓
# 4 physical piano corners
#    ↓
# optical flow
#    ↓
# RANSAC homography
#    ↓
# edge snapping
#    ↓
# Socket.IO
#    ↓
# Three.js
#
# ============================================================


# ============================================================
# 1. ARUCO
# ============================================================

dictionary = cv2.aruco.getPredefinedDictionary(
    cv2.aruco.DICT_4X4_50
)

parameters = cv2.aruco.DetectorParameters()

detector = cv2.aruco.ArucoDetector(
    dictionary,
    parameters
)


# ============================================================
# 2. CAMERA
# ============================================================

cap = cv2.VideoCapture(
    0,
    cv2.CAP_V4L2
)

if not cap.isOpened():

    print("❌ Could not open PC camera")

    exit()


cap.set(
    cv2.CAP_PROP_FRAME_WIDTH,
    1280
)

cap.set(
    cv2.CAP_PROP_FRAME_HEIGHT,
    720
)


width = int(
    cap.get(cv2.CAP_PROP_FRAME_WIDTH)
)

height = int(
    cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
)

print(
    f"✅ PC camera opened at {width}x{height}"
)


# ============================================================
# 3. CAMERA PARAMETERS
# ============================================================

camera_matrix = np.array([
    [1000, 0, width / 2],
    [0, 1000, height / 2],
    [0, 0, 1]
], dtype=np.float32)


dist_coeffs = np.zeros(
    (5, 1),
    dtype=np.float32
)


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
# 5. FOUR PIANO POINTS
# ============================================================

MAX_POINTS = 4

points = []

key_polygon = None

features = None

old_gray = None

tracking_started = False

tracking_valid = False

last_good_polygon = None

bad_frames = 0


# ============================================================
# 6. POINT ORDER
#
#       P1 -------- P2
#       |            |
#       |   PIANO    |
#       |            |
#       P4 -------- P3
#
# ============================================================

print()
print("==============================================")
print(" LEAPVE 4-POINT CALIBRATION")
print("==============================================")
print()
print("Click points in this order:")
print()
print("P1 = TOP LEFT")
print("P2 = TOP RIGHT")
print("P3 = BOTTOM RIGHT")
print("P4 = BOTTOM LEFT")
print()


# ============================================================
# 7. TRACKING STABILITY
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
# 8. EDGE SNAP
# ============================================================

EDGE_SEARCH_RADIUS = 18

CANNY_LOW = 50

CANNY_HIGH = 150

MIN_EDGE_STRENGTH = 80

EDGE_SNAP_ALPHA = 0.65

MAX_EDGE_MOVE = 15.0


# ============================================================
# 9. MANUAL EDIT
# ============================================================

EDIT_RADIUS = 18

selected_point = None

dragging = False


# ============================================================
# 10. HOMOGRAPHY
# ============================================================

current_homography = None


# ============================================================
# 11. SMOOTH POLYGON
# ============================================================

def smooth_polygon(
    old_polygon,
    new_polygon,
    alpha=0.25
):

    if old_polygon is None:

        return new_polygon.copy()


    old_pts = old_polygon.reshape(
        -1,
        2
    )

    new_pts = new_polygon.reshape(
        -1,
        2
    )


    smoothed = (
        old_pts * (1.0 - alpha)
        +
        new_pts * alpha
    )


    return smoothed.reshape(
        -1,
        1,
        2
    ).astype(
        np.float32
    )


# ============================================================
# 12. FIND NEAREST EDGE
# ============================================================

def find_nearest_edge_point(
    gray,
    point,
    radius=EDGE_SEARCH_RADIUS
):

    x = int(round(point[0]))

    y = int(round(point[1]))


    h, w = gray.shape


    x1 = max(
        0,
        x - radius
    )

    x2 = min(
        w,
        x + radius + 1
    )

    y1 = max(
        0,
        y - radius
    )

    y2 = min(
        h,
        y + radius + 1
    )


    if x2 <= x1 or y2 <= y1:

        return (
            np.array(
                point,
                dtype=np.float32
            ),
            0
        )


    roi = gray[
        y1:y2,
        x1:x2
    ]


    if roi.size == 0:

        return (
            np.array(
                point,
                dtype=np.float32
            ),
            0
        )


    blurred = cv2.GaussianBlur(
        roi,
        (5, 5),
        0
    )


    edges = cv2.Canny(
        blurred,
        CANNY_LOW,
        CANNY_HIGH
    )


    ys, xs = np.where(
        edges > 0
    )


    if len(xs) == 0:

        return (
            np.array(
                point,
                dtype=np.float32
            ),
            0
        )


    candidates = np.column_stack([
        xs + x1,
        ys + y1
    ]).astype(
        np.float32
    )


    predicted = np.array(
        [x, y],
        dtype=np.float32
    )


    distances = np.linalg.norm(
        candidates - predicted,
        axis=1
    )


    nearest_index = int(
        np.argmin(distances)
    )


    nearest_distance = distances[
        nearest_index
    ]


    if nearest_distance > radius:

        return (
            np.array(
                point,
                dtype=np.float32
            ),
            0
        )


    snapped = candidates[
        nearest_index
    ]


    gx = cv2.Sobel(
        blurred,
        cv2.CV_32F,
        1,
        0,
        ksize=3
    )


    gy = cv2.Sobel(
        blurred,
        cv2.CV_32F,
        0,
        1,
        ksize=3
    )


    magnitude = cv2.magnitude(
        gx,
        gy
    )


    sx = int(
        np.clip(
            snapped[0] - x1,
            0,
            magnitude.shape[1] - 1
        )
    )


    sy = int(
        np.clip(
            snapped[1] - y1,
            0,
            magnitude.shape[0] - 1
        )
    )


    strength = float(
        magnitude[sy, sx]
    )


    return snapped, strength


# ============================================================
# 13. SNAP FOUR CORNERS TO EDGES
# ============================================================

def snap_polygon_to_edges(
    gray,
    polygon
):

    pts = polygon.reshape(
        -1,
        2
    ).copy()


    corrected = pts.copy()


    for i, point in enumerate(pts):

        snapped, strength = (
            find_nearest_edge_point(
                gray,
                point
            )
        )


        movement = np.linalg.norm(
            snapped - point
        )


        if strength < MIN_EDGE_STRENGTH:

            continue


        if movement > MAX_EDGE_MOVE:

            continue


        corrected[i] = (
            point * (1.0 - EDGE_SNAP_ALPHA)
            +
            snapped * EDGE_SNAP_ALPHA
        )


    return corrected.reshape(
        -1,
        1,
        2
    ).astype(
        np.float32
    )


# ============================================================
# 14. NORMALIZE FOUR POINTS
#
# Canonical piano space:
#
# P1 = 0,0
# P2 = 1,0
# P3 = 1,1
# P4 = 0,1
#
# ============================================================

def normalize_piano_points(
    polygon
):

    if polygon is None:

        return None


    src = polygon.reshape(
        4,
        2
    ).astype(
        np.float32
    )


    dst = np.array([
        [0.0, 0.0],
        [1.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0]
    ], dtype=np.float32)


    H = cv2.getPerspectiveTransform(
        src,
        dst
    )


    points_for_transform = (
        src.reshape(
            -1,
            1,
            2
        )
    )


    normalized = cv2.perspectiveTransform(
        points_for_transform,
        H
    )


    return normalized.reshape(
        4,
        2
    )


# ============================================================
# 15. MOUSE CALLBACK
# ============================================================

def mouse_callback(
    event,
    x,
    y,
    flags,
    param
):

    global points

    global key_polygon

    global selected_point

    global dragging

    global features

    global old_gray

    global tracking_started

    global last_good_polygon


    # --------------------------------------------------------
    # CALIBRATION
    # --------------------------------------------------------

    if not tracking_started:

        if (
            event == cv2.EVENT_LBUTTONDOWN
            and len(points) < MAX_POINTS
        ):

            points.append([
                x,
                y
            ])


            print(
                f"P{len(points)} = ({x}, {y})"
            )


        return


    # --------------------------------------------------------
    # MANUAL CORRECTION
    # --------------------------------------------------------

    if key_polygon is None:

        return


    current_points = (
        key_polygon
        .reshape(4, 2)
        .copy()
    )


    distances = np.linalg.norm(
        current_points
        -
        np.array(
            [x, y],
            dtype=np.float32
        ),
        axis=1
    )


    nearest = int(
        np.argmin(distances)
    )


    # --------------------------------------------------------
    # CLICK
    # --------------------------------------------------------

    if event == cv2.EVENT_LBUTTONDOWN:

        if distances[nearest] <= EDIT_RADIUS:

            selected_point = nearest

            dragging = True

            print(
                f"Dragging P{nearest + 1}"
            )


    # --------------------------------------------------------
    # DRAG
    # --------------------------------------------------------

    elif (
        event == cv2.EVENT_MOUSEMOVE
        and dragging
        and selected_point is not None
    ):

        key_polygon[
            selected_point,
            0,
            0
        ] = x


        key_polygon[
            selected_point,
            0,
            1
        ] = y


        if selected_point < len(points):

            points[
                selected_point
            ] = [
                x,
                y
            ]


    # --------------------------------------------------------
    # RELEASE
    # --------------------------------------------------------

    elif (
        event == cv2.EVENT_LBUTTONUP
    ):

        if dragging:

            print(
                f"P{selected_point + 1} manually corrected"
            )


            features = None

            old_gray = None


            last_good_polygon = (
                key_polygon.copy()
            )


        dragging = False

        selected_point = None


# ============================================================
# 16. WINDOWS
# ============================================================

window_name = (
    "LeapVE - 4 Point Piano Tracker"
)

raw_window = "Raw Canny"

masked_window = (
    "Masked Canny - Piano"
)


cv2.namedWindow(
    window_name,
    cv2.WINDOW_NORMAL
)

cv2.namedWindow(
    raw_window,
    cv2.WINDOW_NORMAL
)

cv2.namedWindow(
    masked_window,
    cv2.WINDOW_NORMAL
)


cv2.resizeWindow(
    window_name,
    width,
    height
)

cv2.resizeWindow(
    raw_window,
    640,
    360
)

cv2.resizeWindow(
    masked_window,
    640,
    360
)


# IMPORTANT:
# Give Qt time to create the window

cv2.waitKey(100)


cv2.setMouseCallback(
    window_name,
    mouse_callback
)


print(
    "✅ OpenCV windows created"
)


# ============================================================
# 17. SOCKET.IO SERVER
# ============================================================

def run_socket_server():

    server = (
        wsgiref.simple_server.make_server(
            "0.0.0.0",
            5000,
            app
        )
    )


    print(
        "🚀 Socket.IO server:"
        " http://localhost:5000"
    )


    server.serve_forever()


socket_thread = threading.Thread(
    target=run_socket_server,
    daemon=True
)

socket_thread.start()


# ============================================================
# 18. MAIN LOOP
# ============================================================

previous_time = time.time()


while True:

    ret, frame = cap.read()


    if not ret:

        print(
            "❌ Failed to read camera frame"
        )

        break


    gray = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY
    )


    # ========================================================
    # CANNY
    # ========================================================

    blurred = cv2.GaussianBlur(
        gray,
        (5, 5),
        0
    )


    raw_canny = cv2.Canny(
        blurred,
        CANNY_LOW,
        CANNY_HIGH
    )


    # ========================================================
    # ARUCO
    # ========================================================

    corners, ids, rejected = (
        detector.detectMarkers(gray)
    )


    aruco_detected = False


    if ids is not None:

        cv2.aruco.drawDetectedMarkers(
            frame,
            corners,
            ids
        )


        for marker_corners, marker_id in zip(
            corners,
            ids
        ):

            image_points = (
                marker_corners
                .reshape(4, 2)
                .astype(np.float32)
            )


            success, rvec, tvec = (
                cv2.solvePnP(
                    object_points,
                    image_points,
                    camera_matrix,
                    dist_coeffs,
                    flags=cv2.SOLVEPNP_IPPE_SQUARE
                )
            )


            if success:

                aruco_detected = True


                cv2.drawFrameAxes(
                    frame,
                    camera_matrix,
                    dist_coeffs,
                    rvec,
                    tvec,
                    0.08,
                    3
                )


    # ========================================================
    # START 4-POINT TRACKING
    # ========================================================

    if (
        len(points) == MAX_POINTS
        and features is None
    ):

        mask = np.zeros_like(
            gray
        )


        polygon = np.array(
            points,
            dtype=np.int32
        )


        cv2.polylines(
            mask,
            [polygon],
            True,
            255,
            thickness=35
        )


        features = cv2.goodFeaturesToTrack(
            gray,
            maxCorners=150,
            qualityLevel=0.02,
            minDistance=8,
            mask=mask
        )


        key_polygon = (
            np.float32(points)
            .reshape(-1, 1, 2)
        )


        last_good_polygon = (
            key_polygon.copy()
        )


        old_gray = gray.copy()


        tracking_started = True

        tracking_valid = True

        bad_frames = 0


        print()
        print(
            "✅ 4-POINT PIANO TRACKING STARTED"
        )
        print()


    # ========================================================
    # OPTICAL FLOW + RANSAC
    # ========================================================

    if (
        features is not None
        and old_gray is not None
    ):

        new_features, status, error = (
            cv2.calcOpticalFlowPyrLK(
                old_gray,
                gray,
                features,
                None,
                winSize=(21, 21),
                maxLevel=3,
                criteria=(
                    cv2.TERM_CRITERIA_EPS
                    |
                    cv2.TERM_CRITERIA_COUNT,
                    30,
                    0.01
                )
            )
        )


        if new_features is not None:

            status = status.flatten()


            good_old = (
                features[
                    status == 1
                ]
            )


            good_new = (
                new_features[
                    status == 1
                ]
            )


            if len(good_new) >= MIN_FEATURES:

                H, mask_h = (
                    cv2.findHomography(
                        good_old,
                        good_new,
                        cv2.RANSAC,
                        RANSAC_THRESHOLD
                    )
                )


                if (
                    H is not None
                    and mask_h is not None
                ):

                    inliers = (
                        mask_h
                        .flatten()
                        .astype(bool)
                    )


                    inlier_count = (
                        np.sum(inliers)
                    )


                    inlier_ratio = (
                        inlier_count
                        /
                        max(
                            len(good_new),
                            1
                        )
                    )


                    homography_good = True


                    if (
                        inlier_count
                        <
                        MIN_INLIERS
                    ):

                        homography_good = False


                    if (
                        inlier_ratio
                        <
                        MIN_INLIER_RATIO
                    ):

                        homography_good = False


                    if (
                        homography_good
                        and
                        key_polygon is not None
                    ):

                        proposed = (
                            cv2.perspectiveTransform(
                                key_polygon,
                                H
                            )
                        )


                        old_pts = (
                            key_polygon
                            .reshape(4, 2)
                        )


                        new_pts = (
                            proposed
                            .reshape(4, 2)
                        )


                        # Corner movement

                        corner_movement = (
                            np.linalg.norm(
                                new_pts
                                -
                                old_pts,
                                axis=1
                            )
                        )


                        if (
                            np.max(
                                corner_movement
                            )
                            >
                            MAX_CORNER_MOVE
                        ):

                            homography_good = False


                        # Center movement

                        old_center = (
                            np.mean(
                                old_pts,
                                axis=0
                            )
                        )


                        new_center = (
                            np.mean(
                                new_pts,
                                axis=0
                            )
                        )


                        if (
                            np.linalg.norm(
                                new_center
                                -
                                old_center
                            )
                            >
                            MAX_CENTER_MOVE
                        ):

                            homography_good = False


                        # Area

                        old_area = abs(
                            cv2.contourArea(
                                old_pts.astype(
                                    np.float32
                                )
                            )
                        )


                        new_area = abs(
                            cv2.contourArea(
                                new_pts.astype(
                                    np.float32
                                )
                            )
                        )


                        if old_area > 0:

                            area_ratio = (
                                new_area
                                /
                                old_area
                            )


                            if (
                                area_ratio < 0.70
                                or
                                area_ratio > 1.30
                            ):

                                homography_good = False


                        # ------------------------------------
                        # ACCEPT TRACK
                        # ------------------------------------

                        if homography_good:

                            predicted = (
                                proposed.copy()
                            )


                            # EDGE LOCK

                            edge_locked = (
                                snap_polygon_to_edges(
                                    gray,
                                    predicted
                                )
                            )


                            # SMOOTH

                            key_polygon = (
                                smooth_polygon(
                                    key_polygon,
                                    edge_locked,
                                    SMOOTHING
                                )
                            )


                            last_good_polygon = (
                                key_polygon.copy()
                            )


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


            if len(good_new) >= MIN_FEATURES:

                features = (
                    good_new
                    .reshape(-1, 1, 2)
                )

            else:

                features = None


        else:

            features = None


        old_gray = gray.copy()


    # ========================================================
    # REINITIALIZE FEATURES
    # ========================================================

    if bad_frames >= MAX_BAD_FRAMES:

        print(
            "⚠ Tracking lost - "
            "reinitializing features"
        )


        features = None

        old_gray = None

        bad_frames = 0


    # ========================================================
    # NORMALIZED COORDINATES
    # ========================================================

    normalized_points = None


    if key_polygon is not None:

        normalized_points = (
            normalize_piano_points(
                key_polygon
            )
        )


    # ========================================================
    # SEND TO THREE.JS
    # ========================================================

    if key_polygon is not None:

        live_points = (
            key_polygon
            .reshape(4, 2)
            .tolist()
        )


        send_piano_points(
            live_points,
            width,
            height
        )


    # ========================================================
    # MASKED CANNY
    # ========================================================

    masked_canny = np.zeros_like(
        raw_canny
    )


    if key_polygon is not None:

        poly_mask = np.zeros_like(
            gray
        )


        pts_int = (
            key_polygon
            .reshape(-1, 1, 2)
            .astype(np.int32)
        )


        cv2.fillPoly(
            poly_mask,
            [pts_int],
            255
        )


        masked_canny = (
            cv2.bitwise_and(
                raw_canny,
                raw_canny,
                mask=poly_mask
            )
        )


    # ========================================================
    # DRAW 4 POINTS
    # ========================================================

    if not tracking_started:

        for i, p in enumerate(points):

            cv2.circle(
                frame,
                tuple(p),
                8,
                (0, 255, 0),
                -1
            )


            cv2.putText(
                frame,
                f"P{i + 1}",
                (
                    p[0] + 10,
                    p[1] - 10
                ),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                2
            )


        if len(points) > 1:

            for i in range(
                len(points) - 1
            ):

                cv2.line(
                    frame,
                    tuple(points[i]),
                    tuple(points[i + 1]),
                    (255, 0, 0),
                    2
                )


        # Close polygon when all four exist

        if len(points) == 4:

            cv2.line(
                frame,
                tuple(points[3]),
                tuple(points[0]),
                (255, 0, 0),
                2
            )


    # ========================================================
    # DRAW TRACKED PIANO
    # ========================================================

    if key_polygon is not None:

        pts = (
            key_polygon
            .astype(np.int32)
        )


        # Yellow piano boundary

        cv2.polylines(
            frame,
            [pts],
            True,
            (0, 255, 255),
            3
        )


        # Four corners

        for i, point in enumerate(
            pts.reshape(4, 2)
        ):

            px = int(point[0])

            py = int(point[1])


            if (
                dragging
                and
                selected_point == i
            ):

                color = (
                    0,
                    0,
                    255
                )

                radius = 10

            else:

                color = (
                    0,
                    255,
                    0
                )

                radius = 7


            cv2.circle(
                frame,
                (px, py),
                radius,
                color,
                -1
            )


            cv2.putText(
                frame,
                f"P{i + 1}",
                (
                    px + 10,
                    py - 10
                ),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                2
            )


    # ========================================================
    # OPTICAL FLOW FEATURES
    # ========================================================

    if features is not None:

        for feature in features:

            fx, fy = feature.ravel()


            cv2.circle(
                frame,
                (
                    int(fx),
                    int(fy)
                ),
                2,
                (255, 0, 255),
                -1
            )


    # ========================================================
    # STATUS
    # ========================================================

    if aruco_detected:

        cv2.putText(
            frame,
            "ARUCO: LOCKED",
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 255, 0),
            2
        )

    else:

        cv2.putText(
            frame,
            "ARUCO: SEARCHING",
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 0, 255),
            2
        )


    if not tracking_started:

        status_text = (
            f"PIANO: SELECT "
            f"{len(points)}/4 POINTS"
        )

        status_color = (
            255,
            255,
            255
        )

    else:

        if tracking_valid:

            status_text = (
                "PIANO: 4-POINT "
                "EDGE-LOCKED"
            )

            status_color = (
                0,
                255,
                0
            )

        else:

            status_text = (
                "PIANO: HOLDING "
                "LAST GOOD"
            )

            status_color = (
                0,
                165,
                255
            )


    cv2.putText(
        frame,
        status_text,
        (20, 65),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        status_color,
        2
    )


    # ========================================================
    # NORMALIZED DISPLAY
    # ========================================================

    if normalized_points is not None:

        cv2.putText(
            frame,
            "THREE.JS: 4 POINTS SENT",
            (20, 95),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 0),
            2
        )


    # ========================================================
    # FPS
    # ========================================================

    now = time.time()


    fps = (
        1.0
        /
        max(
            now - previous_time,
            0.0001
        )
    )


    previous_time = now


    cv2.putText(
        frame,
        f"FPS: {fps:.1f}",
        (20, 125),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (255, 255, 255),
        2
    )


    # ========================================================
    # INSTRUCTIONS
    # ========================================================

    if not tracking_started:

        instruction = (
            "CLICK: P1 TOP-LEFT -> "
            "P2 TOP-RIGHT -> "
            "P3 BOTTOM-RIGHT -> "
            "P4 BOTTOM-LEFT"
        )

    else:

        instruction = (
            "DRAG corners | "
            "R = reset | "
            "Q = quit"
        )


    cv2.putText(
        frame,
        instruction,
        (
            20,
            frame.shape[0] - 20
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (255, 255, 255),
        1
    )


    # ========================================================
    # SHOW
    # ========================================================

    cv2.imshow(
        window_name,
        frame
    )

    cv2.imshow(
        raw_window,
        raw_canny
    )

    cv2.imshow(
        masked_window,
        masked_canny
    )


    # ========================================================
    # KEYBOARD
    # ========================================================

    key = (
        cv2.waitKey(1)
        &
        0xFF
    )


    if key == ord("q") or key == 27:

        break


    if key == ord("r"):

        points = []

        features = None

        old_gray = None

        key_polygon = None

        last_good_polygon = None

        tracking_started = False

        tracking_valid = False

        bad_frames = 0

        current_homography = None

        selected_point = None

        dragging = False


        print()
        print(
            "🔄 4-POINT CALIBRATION RESET"
        )


# ============================================================
# CLEANUP
# ============================================================

cap.release()

cv2.destroyAllWindows()

print(
    "LeapVE 4-point tracker stopped."
)