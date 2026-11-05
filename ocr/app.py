"""Glideslope receipt OCR (F-09.1): deep-learning text detection + recognition, no LLM.

RapidOCR runs the PP-OCR models (DBNet text detection, angle classifier, SVTR/CRNN text recognition) on
ONNX Runtime, CPU only. The service returns every text line with its box; turning lines into a receipt
(items, subtotal, tax, total) happens in the app (src/lib/core/receipt-ocr.ts) where it is unit-tested.
"""

import os

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from rapidocr import RapidOCR

MAX_BYTES = 6 * 1024 * 1024
TOKEN = os.environ.get("OCR_TOKEN", "")

app = FastAPI(title="glideslope-ocr", docs_url=None, redoc_url=None)
engine = RapidOCR()


def prepare(img: np.ndarray) -> np.ndarray:
    """Phone photos of thermal receipts: cap the long side and lift contrast so faint print survives."""
    h, w = img.shape[:2]
    scale = 1600 / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), x_ocr_token: str = Header(default="")):
    if TOKEN and x_ocr_token != TOKEN:
        raise HTTPException(status_code=401, detail="token")
    data = await file.read()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="ukuran")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=415, detail="bukan gambar")
    img = prepare(img)
    res = engine(img)
    lines = []
    if res.boxes is not None:
        for box, txt, score in zip(res.boxes, res.txts, res.scores):
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            lines.append({"text": str(txt), "score": round(float(score), 3), "box": [min(xs), min(ys), max(xs), max(ys)]})
    h, w = img.shape[:2]
    return {"width": w, "height": h, "lines": lines}
