#!/usr/bin/env bash
# Downloads the two official OpenCV face models (YuNet: MIT, SFace: Apache-2.0) and verifies their SHA-256.
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p models
# shasum on macOS, GNU sha256sum on Debian (Docker image).
verify() { if command -v shasum >/dev/null; then shasum -a 256 -c --status; else sha256sum -c --status; fi; }
get() { # url file sha256
  [ -f "models/$2" ] && echo "$3  models/$2" | verify && { echo "ok  $2"; return; }
  curl -sfL --retry 3 -o "models/$2" "$1"
  echo "$3  models/$2" | verify || { echo "checksum FAILED for $2"; rm -f "models/$2"; exit 1; }
  echo "got $2"
}
get https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx face_detection_yunet_2023mar.onnx 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
get https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx face_recognition_sface_2021dec.onnx 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
