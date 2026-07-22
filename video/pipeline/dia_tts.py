#!/usr/bin/env python3
"""Dia TTS batch synthesizer (nari-labs/dia).

Called by voice.ts with one JSON job file so the ~1.6B model is loaded ONCE and
reused for every segment (loading per-segment would dominate runtime).

Job file shape:
  {
    "model":   "nari-labs/Dia-1.6B-0626",   # optional
    "device":  "auto|cuda|mps|cpu",          # optional
    "seed":    42,                            # optional, for repeatable voice
    "segments": [ { "id": "intro", "text": "...", "outFile": "/abs/intro.mp3" }, ... ]
  }

Writes each segment to its outFile (mp3, 44.1kHz). Prints one line per segment so
the Node side can stream progress. Exits non-zero on failure so voice.ts can fall
back to another provider.
"""
import json
import sys


def pick_device(pref: str) -> str:
    import torch

    if pref and pref != "auto":
        return pref
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def load_model(model_id: str, device: str):
    """Load via the native `dia` package. Its from_pretrained signature has
    changed across releases, so try the richer call first and degrade."""
    import torch
    from dia.model import Dia

    # float16 on accelerators, float32 on CPU (fp16 on CPU is slow/unsupported).
    compute_dtype = "float16" if device in ("cuda", "mps") else "float32"
    print(f"[dia] loading {model_id} on {device} ({compute_dtype})", flush=True)
    try:
        return Dia.from_pretrained(model_id, compute_dtype=compute_dtype, device=torch.device(device))
    except TypeError:
        # older package: no device kwarg
        return Dia.from_pretrained(model_id, compute_dtype=compute_dtype)


def main() -> int:
    if len(sys.argv) < 2:
        print("[dia] usage: dia_tts.py <job.json>", file=sys.stderr)
        return 2
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        job = json.load(f)

    model_id = job.get("model") or "nari-labs/Dia-1.6B-0626"
    device = pick_device(job.get("device") or "auto")
    seed = job.get("seed")
    segments = job.get("segments") or []

    model = load_model(model_id, device)

    if seed is not None:
        try:
            import torch

            torch.manual_seed(int(seed))
        except Exception:
            pass

    for seg in segments:
        text = (seg.get("text") or "").strip()
        # Dia is a dialogue model — it expects speaker tags. Our narration is a
        # single speaker, so prefix [S1] when the script hasn't already tagged it.
        if not text.startswith("[S"):
            text = "[S1] " + text
        out_file = seg["outFile"]
        print(f"[dia] {seg.get('id')} synthesizing…", flush=True)
        output = model.generate(text, use_torch_compile=False, verbose=False)
        model.save_audio(out_file, output)
        print(f"[dia] {seg.get('id')} -> {out_file}", flush=True)

    print(f"[dia] done ({len(segments)} segments)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
