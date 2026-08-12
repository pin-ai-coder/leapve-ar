import socketio
import threading
import time
import cv2
from http.server import BaseHTTPRequestHandler, HTTPServer

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


def send_piano_points(points):
    """
    points = [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    """
    if points is None or len(points) != 4:
        return

    data = {
        "points": [
            [float(p[0]), float(p[1])] for p in points
        ]
    }
    sio.emit("piano_points", data)


# ============================================================
# MJPEG STREAM SERVER  (NEW)
# ============================================================

class MJPEGHandler(BaseHTTPRequestHandler):
    current_frame = None
    lock = threading.Lock()

    def log_message(self, format, *args):
        pass  # suppress HTTP request spam

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        while True:
            with MJPEGHandler.lock:
                frame = MJPEGHandler.current_frame
            if frame is not None:
                ok, jpeg = cv2.imencode('.jpg', frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), 35])
                if ok:
                    try:
                        self.wfile.write(b'--frame\r\n')
                        self.wfile.write(b'Content-Type: image/jpeg\r\n\r\n')
                        self.wfile.write(jpeg.tobytes())
                        self.wfile.write(b'\r\n')
                    except (BrokenPipeError, ConnectionResetError):
                        break
            time.sleep(1.0 / 20)  # 20 fps stream


def push_frame(frame):
    with MJPEGHandler.lock:
        MJPEGHandler.current_frame = frame


def run_mjpeg_server():
    server = HTTPServer(("0.0.0.0", 5001), MJPEGHandler)
    print("📹 MJPEG stream running on http://0.0.0.0:5001")
    server.serve_forever()
