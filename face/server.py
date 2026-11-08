"""GeoMark face service: finds the face in a selfie and returns its 128-number fingerprint.

Models (OpenCV, official): YuNet face detector (MIT) + SFace face recogniser (Apache-2.0).
The API sends the JPEG bytes and compares fingerprints itself; this service stores nothing.

  POST /embed   body: JPEG bytes   header: x-face-secret
  -> {"faces": 1, "score": 0.93, "box": [x, y, w, h], "embedding": [128 floats]}
     faces = 0 or >1 means "retake" (no embedding).
  GET /health -> ok

Run: FACE_SECRET=... .venv/bin/python server.py   (PORT defaults to 8790)
"""

import hmac
import json
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DETECTOR = os.path.join(HERE, "models", "face_detection_yunet_2023mar.onnx")
RECOGNISER = os.path.join(HERE, "models", "face_recognition_sface_2021dec.onnx")
SECRET = os.environ.get("FACE_SECRET", "")
MAX_BYTES = 3_000_000
MIN_FACE_SCORE = 0.8   # YuNet confidence to count something as a face
MIN_FACE_SIDE = 60     # pixels; smaller = too far away / too blurry to trust
SECOND_FACE_RATIO = 0.5  # a 2nd face at least half the size of the biggest = ambiguous → retake

if not SECRET:
    raise SystemExit("FACE_SECRET is required (shared with the API).")

_detector = cv2.FaceDetectorYN.create(DETECTOR, "", (320, 320), MIN_FACE_SCORE, 0.3, 5000)
_recogniser = cv2.FaceRecognizerSF.create(RECOGNISER, "")
_lock = threading.Lock()  # OpenCV model objects aren't thread-safe


def embed(jpeg: bytes) -> dict:
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "not_an_image"}
    h, w = img.shape[:2]
    scale = 640 / max(h, w)  # detection is faster and as accurate on a smaller copy
    small = cv2.resize(img, (round(w * scale), round(h * scale))) if scale < 1 else img
    with _lock:
        _detector.setInputSize((small.shape[1], small.shape[0]))
        _, faces = _detector.detect(small)
        faces = [] if faces is None else [f for f in faces if f[2] / min(scale, 1) >= MIN_FACE_SIDE and f[3] / min(scale, 1) >= MIN_FACE_SIDE]
        # The person holding the phone is the biggest face. Small faces in the background are ignored;
        # a second face of similar size (someone leaning in) makes it ambiguous → ask for a retake.
        faces.sort(key=lambda f: f[2] * f[3], reverse=True)
        if not faces:
            return {"faces": 0}
        if len(faces) > 1 and faces[1][2] * faces[1][3] >= SECOND_FACE_RATIO * faces[0][2] * faces[0][3]:
            return {"faces": len(faces)}
        background = len(faces) - 1
        face = faces[0].copy()
        if scale < 1:
            face[:14] /= scale  # box + 5 landmarks back to full-size coordinates
        aligned = _recogniser.alignCrop(img, face)  # rotate/crop to the eyes, 112x112
        feature = _recogniser.feature(aligned).flatten()
    return {
        "faces": 1,
        "background_faces": background,
        "score": round(float(face[14]), 3),
        "box": [round(float(v)) for v in face[:4]],
        "embedding": [round(float(v), 6) for v in feature],
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict | str):
        data = (json.dumps(body) if isinstance(body, dict) else body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json" if isinstance(body, dict) else "text/plain")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, "ok") if self.path == "/health" else self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/embed":
            return self._send(404, {"error": "not_found"})
        if not hmac.compare_digest(self.headers.get("x-face-secret", ""), SECRET):
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("content-length") or 0)
        if not 0 < length <= MAX_BYTES:
            return self._send(400, {"error": "bad_size"})
        try:
            self._send(200, embed(self.rfile.read(length)))
        except Exception as e:  # never crash the server on a bad image
            self._send(500, {"error": "embed_failed", "detail": type(e).__name__})

    def log_message(self, fmt, *args):  # one short line per request, no bodies
        print(f"[face] {self.command} {self.path} {args[1] if len(args) > 1 else ''}", flush=True)


if __name__ == "__main__":
    # Stop on Ctrl+C / kill like the other dev servers. (A process started from a script inherits
    # "ignore Ctrl+C", which Python would otherwise keep.)
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    port = int(os.environ.get("PORT", "8790"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"[face] listening on http://{host}:{port}", flush=True)
    try:
        ThreadingHTTPServer((host, port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("[face] stopped", flush=True)
