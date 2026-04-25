#!/usr/bin/env python3
"""FunASR/SenseVoice helper for GBrain local transcription.

Outputs JSON:
  {"text": "...", "language": "zh", "duration": 0, "segments": [{"start":0,"end":0,"text":"..."}]}

Install dependencies with:
  uv pip install funasr modelscope --python python3
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def ffprobe_duration(path: Path) -> float:
    if not shutil.which("ffprobe"):
        return 0.0
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path)
        ], text=True).strip()
        return float(out or 0)
    except Exception:
        return 0.0


def ensure_audio(path: Path) -> Path:
    # FunASR generally handles common audio files; convert video containers to 16k mono wav.
    if path.suffix.lower() not in {".mp4", ".mov", ".mkv", ".webm", ".m4v"}:
        return path
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required to extract audio from video files")
    tmp = Path(tempfile.mkdtemp(prefix="gbrain-sensevoice-")) / "audio.wav"
    subprocess.check_call([
        "ffmpeg", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", str(tmp)
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return tmp


def clean_text(text: str) -> str:
    # SenseVoice emits control tags such as <|zh|><|Speech|><|withitn|>.
    import re
    return re.sub(r"<\|[^|]+\|>", "", text or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--model", default="iic/SenseVoiceSmall")
    args = parser.parse_args()

    media = Path(args.input).expanduser().resolve()
    if not media.exists():
        raise SystemExit(f"input not found: {media}")

    try:
        from funasr import AutoModel
    except Exception as exc:
        raise SystemExit(
            "FunASR is not installed. Install it with: "
            "uv pip install funasr modelscope --python python3\n"
            f"Original import error: {exc}"
        )

    audio = ensure_audio(media)
    duration = ffprobe_duration(media)
    log_buffer = io.StringIO()
    with contextlib.redirect_stdout(log_buffer):
        model = AutoModel(model=args.model, trust_remote_code=True)
        result = model.generate(input=str(audio), language=args.language, use_itn=True)
    logs = log_buffer.getvalue().strip()
    if logs:
        print(logs, file=sys.stderr)

    if isinstance(result, list) and result:
        first = result[0]
    elif isinstance(result, dict):
        first = result
    else:
        first = {}

    text = clean_text(str(first.get("text") or first.get("sentence_info") or ""))
    raw_segments = first.get("sentence_info") or first.get("segments") or []
    segments = []
    if isinstance(raw_segments, list):
        for item in raw_segments:
            if not isinstance(item, dict):
                continue
            start = item.get("start", item.get("timestamp", [0, 0])[0] if isinstance(item.get("timestamp"), list) else 0)
            end = item.get("end", item.get("timestamp", [0, 0])[-1] if isinstance(item.get("timestamp"), list) else 0)
            # FunASR commonly returns ms; normalize obviously-large values.
            start = float(start or 0)
            end = float(end or 0)
            if start > 10000 or end > 10000:
                start /= 1000.0
                end /= 1000.0
            seg_text = clean_text(str(item.get("text") or item.get("sentence") or ""))
            if seg_text:
                segments.append({"start": start, "end": end, "text": seg_text})

    if not segments and text:
        segments = [{"start": 0, "end": duration, "text": text}]

    print(json.dumps({
        "text": text,
        "language": args.language,
        "duration": duration or (segments[-1]["end"] if segments else 0),
        "segments": segments,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
