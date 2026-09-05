"""
CLIP Embedding Server — provides text and image embeddings via HTTP.
Used by OSINT-Global-OS for similarity search across satellite tiles,
imported images, and text queries.

Endpoints:
  POST /embed/text   { "text": "..." }            -> { "embedding": [...] }
  POST /embed/image  { "image_path": "..." }       -> { "embedding": [...] }
  POST /similarity   { "a": [...], "b": [...] }    -> { "similarity": 0.87 }
  GET  /health                                       -> { "status": "ok" }
  GET  /models                                       -> { "model": "ViT-B-32", ... }

Run: py scripts/clip_server.py
Default port: 9776
"""

import sys
import os
import json
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

import open_clip
import torch
from PIL import Image

# --- GPU detection via nvidia-ml-py ---
def get_gpu_info():
    """Detect GPU using pynvml (nvidia-ml-py). Falls back to CPU."""
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        if count > 0:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode('utf-8')
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            pynvml.nvmlShutdown()
            return {
                "device": "cuda",
                "gpu_name": name,
                "vram_total_mb": mem.total // (1024 * 1024),
                "vram_free_mb": mem.free // (1024 * 1024),
            }
    except Exception:
        pass
    return {"device": "cpu", "gpu_name": None, "vram_total_mb": 0, "vram_free_mb": 0}

GPU_INFO = get_gpu_info()
# Use GPU only if pynvml detected it AND torch was compiled with CUDA
DEVICE = "cuda" if (GPU_INFO["device"] == "cuda" and torch.cuda.is_available()) else "cpu"
if DEVICE == "cpu" and GPU_INFO["gpu_name"]:
    print(f"[CLIP] GPU detected ({GPU_INFO['gpu_name']}) but torch is CPU-only build — using CPU", flush=True)
MODEL_NAME = "ViT-B-32"
PRETRAINED = "openai"

print(f"[CLIP] Loading {MODEL_NAME} ({PRETRAINED}) on {DEVICE}...", flush=True)
model, _, preprocess = open_clip.create_model_and_transforms(
    MODEL_NAME, pretrained=PRETRAINED, device=DEVICE
)
tokenizer = open_clip.get_tokenizer(MODEL_NAME)
print(f"[CLIP] Model loaded. Embedding dim: {model.visual.output_dim if hasattr(model.visual, 'output_dim') else 512}", flush=True)

EMBED_DIM = 512  # ViT-B-32 output dimension

# --- FastAPI ---
app = FastAPI(title="CLIP Embedding Server", version="1.0.0")


class TextRequest(BaseModel):
    text: str


class ImageRequest(BaseModel):
    image_path: str


class SimilarityRequest(BaseModel):
    a: list[float]
    b: list[float]


@app.get("/health")
async def health():
    # Refresh free VRAM if on GPU
    vram_free = GPU_INFO["vram_free_mb"]
    if DEVICE == "cuda":
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_free = mem.free // (1024 * 1024)
            pynvml.nvmlShutdown()
        except Exception:
            pass
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "gpu_name": GPU_INFO["gpu_name"],
        "vram_total_mb": GPU_INFO["vram_total_mb"],
        "vram_free_mb": vram_free,
        "dim": EMBED_DIM,
    }


@app.get("/models")
async def models():
    return {
        "model": MODEL_NAME,
        "pretrained": PRETRAINED,
        "device": DEVICE,
        "gpu_name": GPU_INFO["gpu_name"],
        "dim": EMBED_DIM,
    }


@app.post("/embed/text")
async def embed_text(req: TextRequest):
    if not req.text:
        raise HTTPException(status_code=400, detail="text is required")
    with torch.no_grad():
        tokens = tokenizer([req.text]).to(DEVICE)
        emb = model.encode_text(tokens)
        emb = emb / emb.norm(dim=-1, keepdim=True)
        return {"embedding": emb.cpu().numpy()[0].tolist()}


@app.post("/embed/image")
async def embed_image(req: ImageRequest):
    if not req.image_path or not os.path.exists(req.image_path):
        raise HTTPException(status_code=400, detail="image_path is required and must exist")
    try:
        img = Image.open(req.image_path).convert("RGB")
        img_t = preprocess(img).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            emb = model.encode_image(img_t)
            emb = emb / emb.norm(dim=-1, keepdim=True)
            return {"embedding": emb.cpu().numpy()[0].tolist()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image encoding failed: {str(e)}")


@app.post("/similarity")
async def similarity(req: SimilarityRequest):
    a = np.array(req.a, dtype=np.float32)
    b = np.array(req.b, dtype=np.float32)
    if len(a) != len(b):
        raise HTTPException(status_code=400, detail="Embedding dimensions must match")
    # Cosine similarity (vectors are already normalized, but normalize again for safety)
    a = a / (np.linalg.norm(a) + 1e-8)
    b = b / (np.linalg.norm(b) + 1e-8)
    sim = float(np.dot(a, b))
    return {"similarity": sim}


if __name__ == "__main__":
    port = int(os.environ.get("CLIP_PORT", "9776"))
    print(f"[CLIP] Starting server on port {port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
