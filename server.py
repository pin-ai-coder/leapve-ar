import socketio

# ============================================================
# LEAPVE SOCKET.IO SERVER
# ============================================================

sio = socketio.Server(cors_allowed_origins="*")
app = socketio.WSGIApp(sio)


@sio.event
def connect(sid, environ):
    print("✅ Three.js connected:", sid)
    sio.emit("status", {"connected": True}, to=sid)


@sio.event
def disconnect(sid):
    print("❌ Three.js disconnected:", sid)


# ============================================================
# SEND LIVE 4-POINT PIANO DATA
# ============================================================

def send_piano_points(points, frame_width, frame_height):
    """
    points:
        [
            [x1, y1],
            [x2, y2],
            [x3, y3],
            [x4, y4]
        ]

    Point order:

        P1 -------- P2
        |            |
        |   PIANO    |
        |            |
        P4 -------- P3
    """

    if points is None or len(points) != 4:
        return

    # --------------------------------------------------------
    # Normalize OpenCV pixel coordinates to 0.0 - 1.0
    # --------------------------------------------------------

    normalized_points = []

    for x, y in points:

        nx = float(x) / float(frame_width)
        ny = float(y) / float(frame_height)

        normalized_points.append([
            nx,
            ny
        ])

    # --------------------------------------------------------
    # Send everything
    # --------------------------------------------------------

    data = {
        "points": [
            [
                float(p[0]),
                float(p[1])
            ]
            for p in points
        ],

        "normalized": normalized_points,

        "frame": {
            "width": int(frame_width),
            "height": int(frame_height)
        }
    }

    sio.emit(
        "piano_points",
        data
    )