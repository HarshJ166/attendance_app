"""Measure SFace matching on the public LFW 'pairs' test set (same / different person) to pick a threshold.
Images are fetched from the Hugging Face datasets server into a cache dir; nothing is committed.
Usage: .venv/bin/python calibrate.py <cache_dir> [n_pairs]"""
import json, os, random, subprocess, sys
import numpy as np
from server import embed

CACHE, N = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 400
os.makedirs(CACHE, exist_ok=True)
API = "https://datasets-server.huggingface.co/rows?dataset=logasja/lfw&config=pairs&split=test"

def get(url, path):
    # curl, not urllib: python.org's macOS Python ships without CA certificates.
    if not os.path.exists(path):
        subprocess.run(["curl", "-sfL", "--retry", "4", "--retry-all-errors", "--max-time", "30", "-o", path, url], check=True)
    return open(path, "rb").read()

# The split is stored in blocks (same-person runs, then different-person runs), so take an even slice
# from every block of 100 to get a balanced sample.
per_block = max(1, N // 22)
rows = []
for off in range(0, 2200, 100):
    data = json.loads(get(f"{API}&offset={off}&length=100", os.path.join(CACHE, f"rows-{off}.json")))
    picked = random.Random(off).sample(list(enumerate(data["rows"])), k=min(per_block, len(data["rows"])))
    rows += [(off + i, r["row"]) for i, r in picked]

same, diff, skipped = [], [], 0
for idx, row in rows:
    feats = []
    for k in ("img_0", "img_1"):
        out = embed(get(row[k]["src"], os.path.join(CACHE, f"{idx}-{k}.jpg")))
        feats.append(np.array(out["embedding"], dtype=np.float32) if out.get("faces") == 1 else None)
    if any(f is None for f in feats):
        skipped += 1
        continue
    a, b = feats
    cos = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
    (same if row["pair"] == 1 else diff).append(cos)

same, diff = np.array(same), np.array(diff)
print(f"pairs scored: {len(same)} same-person, {len(diff)} different-person, {skipped} skipped (no single clear face)")
print(f"skipped = {skipped / len(rows) * 100:.1f}% of pairs")
print(f"cosine  same: median {np.median(same):.3f}  5th pct {np.percentile(same, 5):.3f} | different: median {np.median(diff):.3f}  99th pct {np.percentile(diff, 99):.3f}  max {diff.max():.3f}")
for t in (0.30, 0.363, 0.40, 0.45, 0.50):
    print(f"threshold {t:.3f}: same person accepted {np.mean(same >= t)*100:5.1f}%   different person wrongly accepted {np.mean(diff >= t)*100:5.2f}%")
