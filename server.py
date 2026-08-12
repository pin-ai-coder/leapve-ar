# import cv2
# import time
# import threading

# from flask import Flask, Response
# from flask_cors import CORS
# from flask_socketio import SocketIO

# # ============================================================
# # LEAPVE CAMERA SERVER
# # ============================================================

# app = Flask(__name__)
# CORS(app)

# socketio = SocketIO(
#     app,
#     cors_allowed_origins="*",
#     async_mode="threading"
# )

# # ============================================================
# # CAMERA
# # ============================================================

# CAMERA_INDEX = 0

# cap = cv2.VideoCapture(
#     CAMERA_INDEX,
#     cv2.CAP_V4L2
# )

# cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
# cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

# if not cap.isOpened():
#     raise RuntimeError("Could not open /dev/video0")

# width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
# height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

# print(f"✅ Camera opened: /dev/video{CAMERA_INDEX}")
# print(f"✅ Resolution: {width}x{height}")

# # ============================================================
# # SHARED FRAME
# # ============================================================

# latest_frame = None
# frame_lock = threading.Lock()

# running = True


# def camera_loop():

#     global latest_frame

#     while running:

#         ret, frame = cap.read()

#         if not ret:
#             print("⚠ Camera frame failed")
#             time.sleep(0.01)
#             continue

#         # JPEG encode for browser
#         success, encoded = cv2.imencode(
#             ".jpg",
#             frame,
#             [
#                 cv2.IMWRITE_JPEG_QUALITY,
#                 80
#             ]
#         )

#         if success:

#             with frame_lock:
#                 latest_frame = encoded.tobytes()

#         time.sleep(0.001)


# # ============================================================
# # MJPEG STREAM
# # ============================================================

# def generate_video():

#     global latest_frame

#     while True:

#         with frame_lock:
#             frame = latest_frame

#         if frame is None:
#             time.sleep(0.01)
#             continue

#         yield (
#             b"--frame\r\n"
#             b"Content-Type: image/jpeg\r\n\r\n"
#             + frame
#             + b"\r\n"
#         )


# @app.route("/")
# def index():

#     return {
#         "name": "LeapVE Camera Server",
#         "camera": "/dev/video0",
#         "video": "/video"
#     }


# @app.route("/video")
# def video():

#     return Response(
#         generate_video(),
#         mimetype="multipart/x-mixed-replace; boundary=frame"
#     )


# # ============================================================
# # POINT UPDATE
# # ============================================================

# @socketio.on("piano_points")
# def piano_points(data):

#     print("📍 Piano points:", data)

#     socketio.emit(
#         "piano_points",
#         data
#     )


# # ============================================================
# # MAIN
# # ============================================================

# if __name__ == "__main__":

#     camera_thread = threading.Thread(
#         target=camera_loop,
#         daemon=True
#     )

#     camera_thread.start()

#     print("")
#     print("======================================")
#     print("        LEAPVE CAMERA SERVER")
#     print("======================================")
#     print("")
#     print("Camera : /dev/video0")
#     print("Video  : http://localhost:5000/video")
#     print("Server : http://localhost:5000")
#     print("")

#     socketio.run(
#         app,
#         host="0.0.0.0",
#         port=5000,
#         debug=False,
#         allow_unsafe_werkzeug=True
#     )