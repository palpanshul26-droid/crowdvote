"""
FrameCut — Complete Single-File FastAPI Backend (server.py)

Powered exclusively by Google Gemini (official google-genai SDK) + FFmpeg.
Ready for Railway deployment with Vercel frontend CORS support.

Handles:
- Serving index.html, style.css, and script.js
- System capability & dependency verification (FFmpeg, FFprobe, Google Gemini SDK & GEMINI_API_KEY, yt-dlp)
- Chunked video file upload validation & SSRF-protected authorized URL ingestion
- Isolated temporary job directories with automatic TTL expiration cleanup
- Real FFmpeg audio extraction, video probing, cropping/aspect conversion, caption burning & thumbnails
- Real speech transcription via Google Gemini (gemini-3.5-transcribe) or optional local faster-whisper
- Real AI highlight detection, clip selection, title & description generation via Google Gemini (gemini-4-hydrogen)
- Real clip preview streaming (HTTP Range), downloading, SRT editing, trim/re-render, deletion & ZIP export
"""

from __future__ import annotations

import asyncio
import importlib.util
import ipaddress
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import tempfile
import textwrap
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

try:
    from google import genai
    from google.genai import types as genai_types

    GENAI_SDK_AVAILABLE = True
except ImportError:
    genai = None  # type: ignore
    genai_types = None  # type: ignore
    GENAI_SDK_AVAILABLE = False

# ---------------------------------------------------------------------------
# Configuration & Environment Loading
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv_if_present() -> None:
    """Minimal .env parser so local development can load GEMINI_API_KEY from .env."""
    env_path = BASE_DIR / ".env"
    if not env_path.is_file():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ and not val.startswith("MY_"):
                os.environ[key] = val
    except OSError:
        pass


_load_dotenv_if_present()

MISSING_GEMINI_KEY_MESSAGE = (
    "GEMINI_API_KEY is missing. Please configure it in your backend environment variables."
)

MAX_UPLOAD_MB = max(10, int(os.getenv("MAX_UPLOAD_MB", "500")))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
JOB_TTL_SECONDS = max(300, int(os.getenv("JOB_TTL_SECONDS", "3600")))
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base").strip() or "base"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-4-hydrogen").strip() or "gemini-4-hydrogen"
GEMINI_TRANSCRIBE_MODEL = (
    os.getenv("GEMINI_TRANSCRIBE_MODEL", "gemini-3.5-transcribe").strip()
    or "gemini-3.5-transcribe"
)

ALLOWED_ORIGINS_RAW = os.getenv("ALLOWED_ORIGINS", "*").strip()
CORS_ORIGINS: List[str] = (
    ["*"]
    if not ALLOWED_ORIGINS_RAW or ALLOWED_ORIGINS_RAW == "*"
    else [o.strip().rstrip("/") for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()]
)

TEMP_ROOT = Path(tempfile.gettempdir()) / "framecut_jobs"
TEMP_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}
ALLOWED_ASPECT_RATIOS = {"9:16", "1:1", "16:9"}
ALLOWED_CAPTION_STYLES = {"dynamic", "minimal", "classic"}
SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{4,64}$")

JOBS: Dict[str, Dict[str, Any]] = {}
JOB_TASKS: Dict[str, asyncio.Task[Any]] = {}
_LOCAL_FASTER_WHISPER_MODEL: Any = None


# ---------------------------------------------------------------------------
# Custom Pipeline Error
# ---------------------------------------------------------------------------


class PipelineError(Exception):
    def __init__(
        self,
        message: str,
        code: str = "PROCESSING_ERROR",
        missing_dependency: Optional[str] = None,
        how_to_fix: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.missing_dependency = missing_dependency
        self.how_to_fix = how_to_fix


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------


class UrlJobRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)
    authorized: bool = False
    aspect_ratio: str = "9:16"
    clip_count: int = Field(4, ge=1, le=10)
    min_duration: int = Field(20, ge=5, le=120)
    max_duration: int = Field(60, ge=10, le=180)
    burn_captions: bool = True
    caption_style: str = "dynamic"
    language: str = "auto"


class ClipMutationRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=120)
    start: float = Field(..., ge=0.0)
    end: float = Field(..., gt=0.0)
    aspect_ratio: Optional[str] = None
    burn_captions: Optional[bool] = None
    caption_style: Optional[str] = None
    captions_srt: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers: Time, IDs, Gemini Client, & Capability Checks
# ---------------------------------------------------------------------------


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_id(value: str, label: str = "ID") -> str:
    if not SAFE_ID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label} format.")
    return value


def _get_api_key(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val or val.startswith("MY_"):
        return ""
    return val


def _get_gemini_client() -> Any:
    gemini_key = _get_api_key("GEMINI_API_KEY")
    if not gemini_key:
        raise PipelineError(
            MISSING_GEMINI_KEY_MESSAGE,
            code="MISSING_GEMINI_API_KEY",
            missing_dependency="GEMINI_API_KEY",
            how_to_fix="Add GEMINI_API_KEY in your Railway service variables or local backend environment and restart server.py.",
        )
    if not GENAI_SDK_AVAILABLE or genai is None or genai_types is None:
        raise PipelineError(
            "Google's official Gemini SDK (`google-genai`) is not installed on the backend.",
            code="MISSING_GENAI_SDK",
            missing_dependency="google-genai",
            how_to_fix="Install dependencies with `pip install -r requirements.txt` (includes `google-genai`).",
        )
    return genai.Client(
        api_key=gemini_key,
        http_options=genai_types.HttpOptions(headers={"User-Agent": "aistudio-build"}),
    )


def _slugify(text: str, fallback: str = "clip") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return cleaned[:60] or fallback


def _job_dir(job_id: str) -> Path:
    _validate_id(job_id, "job_id")
    path = (TEMP_ROOT / job_id).resolve()
    if path.parent != TEMP_ROOT.resolve():
        raise HTTPException(status_code=400, detail="Invalid job path.")
    return path


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def check_system_capabilities() -> Dict[str, Any]:
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    has_faster_whisper = _has_module("faster_whisper")
    gemini_key = _get_api_key("GEMINI_API_KEY")
    has_yt_dlp = bool(shutil.which("yt-dlp") or _has_module("yt_dlp"))

    gemini_ready = bool(gemini_key and GENAI_SDK_AVAILABLE)

    transcription_provider: Optional[str] = None
    transcription_model = ""
    if has_faster_whisper:
        transcription_provider = "faster-whisper"
        transcription_model = WHISPER_MODEL_NAME
    elif gemini_ready:
        transcription_provider = "gemini"
        transcription_model = GEMINI_TRANSCRIBE_MODEL

    missing: List[Dict[str, str]] = []
    if not ffmpeg_path or not ffprobe_path:
        missing.append(
            {
                "dependency": "FFmpeg / FFprobe",
                "message": "FFmpeg and FFprobe binaries are required for video probing, audio extraction, cropping, and caption rendering.",
                "how_to_fix": "Install FFmpeg on the backend container (e.g., `apt install ffmpeg` or Nixpacks ffmpeg package) and ensure `ffmpeg` and `ffprobe` are on PATH.",
            }
        )
    if not GENAI_SDK_AVAILABLE:
        missing.append(
            {
                "dependency": "google-genai SDK",
                "message": "Google's official Gemini SDK (`google-genai`) is not installed.",
                "how_to_fix": "Install `pip install -r requirements.txt` (includes `google-genai`).",
            }
        )
    if not gemini_key:
        missing.append(
            {
                "dependency": "GEMINI_API_KEY",
                "message": MISSING_GEMINI_KEY_MESSAGE,
                "how_to_fix": "Set `GEMINI_API_KEY` in Railway Environment Variables (or local shell) and restart `server.py`.",
            }
        )

    ready = len(missing) == 0
    return {
        "status": "ready" if ready else "degraded",
        "ready": ready,
        "ffmpeg": {"available": bool(ffmpeg_path), "path": ffmpeg_path},
        "ffprobe": {"available": bool(ffprobe_path), "path": ffprobe_path},
        "transcription": {
            "available": bool(transcription_provider),
            "provider": transcription_provider,
            "model": transcription_model,
        },
        "ai": {
            "available": gemini_ready,
            "provider": "gemini",
            "model": GEMINI_MODEL,
            "sdk_installed": GENAI_SDK_AVAILABLE,
            "api_key_configured": bool(gemini_key),
        },
        "yt_dlp": {"available": has_yt_dlp},
        "max_upload_mb": MAX_UPLOAD_MB,
        "job_ttl_seconds": JOB_TTL_SECONDS,
        "missing_requirements": missing,
    }


def _default_stages() -> List[Dict[str, str]]:
    return [
        {"id": "ingest", "label": "Ingest & Probe Media", "state": "pending"},
        {"id": "audio", "label": "Extract Audio (FFmpeg)", "state": "pending"},
        {"id": "transcribe", "label": "Transcribe Speech (Gemini)", "state": "pending"},
        {"id": "highlights", "label": "Detect Highlights (Gemini)", "state": "pending"},
        {"id": "render", "label": "Render Clips & Captions (FFmpeg)", "state": "pending"},
    ]


def _set_stage(job: Dict[str, Any], stage_id: str, state: str) -> None:
    for stage in job["stages"]:
        if stage["id"] == stage_id:
            stage["state"] = state
            break
    job["updated_at"] = _utc_now_iso()


def _create_job_record(
    origin: str,
    filename: str,
    options: Dict[str, Any],
    url: Optional[str] = None,
) -> Dict[str, Any]:
    job_id = uuid.uuid4().hex[:16]
    job_path = _job_dir(job_id)
    (job_path / "clips").mkdir(parents=True, exist_ok=True)
    now = _utc_now_iso()
    record: Dict[str, Any] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "stage_message": "Queued for processing...",
        "created_at": now,
        "updated_at": now,
        "created_ts": time.time(),
        "options": options,
        "source": {
            "origin": origin,
            "filename": filename,
            "url": url,
            "local_path": None,
            "duration": 0.0,
            "width": 0,
            "height": 0,
            "fps": 0.0,
            "size_bytes": 0,
            "has_audio": False,
        },
        "stages": _default_stages(),
        "transcript": None,
        "clips": [],
        "error": None,
    }
    JOBS[job_id] = record
    return record


def _serialize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    src = dict(job["source"])
    src.pop("local_path", None)
    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "progress": job["progress"],
        "stage_message": job["stage_message"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "options": job["options"],
        "source": src,
        "stages": job["stages"],
        "transcript": job["transcript"],
        "clips": job["clips"],
        "error": job["error"],
    }


def _normalize_options(
    aspect_ratio: str,
    clip_count: int,
    min_duration: int,
    max_duration: int,
    burn_captions: bool,
    caption_style: str,
    language: str,
) -> Dict[str, Any]:
    if aspect_ratio not in ALLOWED_ASPECT_RATIOS:
        raise HTTPException(status_code=400, detail=f"Unsupported aspect ratio: {aspect_ratio}")
    if caption_style not in ALLOWED_CAPTION_STYLES:
        caption_style = "dynamic"
    if min_duration >= max_duration:
        raise HTTPException(
            status_code=400,
            detail="Minimum clip duration must be strictly less than maximum clip duration.",
        )
    return {
        "aspect_ratio": aspect_ratio,
        "clip_count": max(1, min(10, int(clip_count))),
        "min_duration": max(5, min(120, int(min_duration))),
        "max_duration": max(10, min(180, int(max_duration))),
        "burn_captions": bool(burn_captions),
        "caption_style": caption_style,
        "language": (language or "auto").strip().lower(),
    }


# ---------------------------------------------------------------------------
# Subprocess Runner, FFprobe & FFmpeg Processing
# ---------------------------------------------------------------------------


def _run_subprocess(cmd: List[str], cwd: Optional[Path] = None, timeout: int = 900) -> str:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise PipelineError(
            f"Required command `{cmd[0]}` was not found on the server.",
            code="MISSING_BINARY",
            missing_dependency=cmd[0],
            how_to_fix=f"Install `{cmd[0]}` and ensure it is available on PATH.",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise PipelineError(
            f"Command `{cmd[0]}` timed out after {timeout} seconds.",
            code="PROCESS_TIMEOUT",
        ) from exc

    if proc.returncode != 0:
        err_tail = (proc.stderr or proc.stdout or "Unknown error").strip()[-600:]
        raise PipelineError(
            f"`{cmd[0]}` failed (exit code {proc.returncode}): {err_tail}",
            code="SUBPROCESS_FAILED",
        )
    return proc.stdout


def _probe_video(media_path: Path) -> Dict[str, Any]:
    if not shutil.which("ffprobe"):
        raise PipelineError(
            "FFprobe is required to validate and inspect video files, but it is not installed.",
            code="MISSING_FFPROBE",
            missing_dependency="ffprobe",
            how_to_fix="Install FFmpeg (includes ffprobe) on the server and restart server.py.",
        )

    raw = _run_subprocess(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(media_path),
        ],
        timeout=60,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PipelineError("FFprobe returned unreadable media metadata.", code="INVALID_MEDIA") from exc

    streams = data.get("streams", [])
    fmt = data.get("format", {})
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if not video_stream:
        raise PipelineError(
            "The uploaded file or URL does not contain a valid video stream.",
            code="NO_VIDEO_STREAM",
        )

    duration = float(fmt.get("duration") or video_stream.get("duration") or 0.0)
    if duration <= 0.5:
        raise PipelineError(
            "Video duration could not be determined or is shorter than 0.5 seconds.",
            code="INVALID_DURATION",
        )

    fps = 0.0
    fps_raw = video_stream.get("r_frame_rate") or video_stream.get("avg_frame_rate") or "0/1"
    if "/" in fps_raw:
        num, den = fps_raw.split("/", 1)
        if float(den) > 0:
            fps = round(float(num) / float(den), 2)

    return {
        "duration": round(duration, 3),
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "fps": fps,
        "size_bytes": media_path.stat().st_size if media_path.exists() else 0,
        "has_audio": bool(audio_stream),
    }


def _probe_audio_duration(audio_path: Path, fallback: float = 0.0) -> float:
    if not shutil.which("ffprobe"):
        return fallback
    try:
        raw = _run_subprocess(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            timeout=30,
        )
        val = float(raw.strip())
        return val if val > 0 else fallback
    except Exception:
        return fallback


def _extract_audio(source_path: Path, audio_path: Path) -> Path:
    if not shutil.which("ffmpeg"):
        raise PipelineError(
            "FFmpeg is not installed on the server.",
            code="MISSING_FFMPEG",
            missing_dependency="ffmpeg",
            how_to_fix="Install FFmpeg (`apt install ffmpeg` or `brew install ffmpeg`) and restart server.py.",
        )
    _run_subprocess(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "48k",
            str(audio_path),
        ],
        timeout=300,
    )
    if not audio_path.is_file() or audio_path.stat().st_size == 0:
        raise PipelineError("Audio extraction produced an empty audio file.", code="AUDIO_EXTRACT_EMPTY")
    return audio_path


# ---------------------------------------------------------------------------
# Authorized URL Download with SSRF Validation
# ---------------------------------------------------------------------------


def _validate_public_url(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PipelineError(
            "Please provide a valid HTTP or HTTPS video URL.",
            code="INVALID_URL",
        )
    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or hostname.endswith(".local"):
        raise PipelineError(
            "Local and private network URLs are blocked for security.",
            code="SSRF_BLOCKED",
        )
    try:
        infos = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise PipelineError(f"Could not resolve hostname `{hostname}`.", code="DNS_FAILED") from exc

    for info in infos:
        ip_str = info[4][0]
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            raise PipelineError(
                "URL resolves to a restricted private or internal network address.",
                code="SSRF_BLOCKED",
            )
    return parsed


def _download_authorized_url(url: str, target_dir: Path) -> Tuple[Path, str]:
    parsed = _validate_public_url(url)
    path_ext = Path(parsed.path).suffix.lower()

    # Attempt 1: Direct HTTP(S) media stream if URL points to a video file or video content-type
    is_direct_ext = path_ext in ALLOWED_VIDEO_EXTENSIONS
    if is_direct_ext or not (shutil.which("yt-dlp") or _has_module("yt_dlp")):
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "FrameCut/1.0 (+AuthorizedMediaIngest)"},
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                is_media_ct = ctype.startswith("video/") or ctype == "application/octet-stream"
                if is_media_ct or is_direct_ext:
                    ext = (
                        path_ext
                        if path_ext in ALLOWED_VIDEO_EXTENSIONS
                        else (mimetypes.guess_extension(ctype) or ".mp4")
                    )
                    if ext not in ALLOWED_VIDEO_EXTENSIONS:
                        ext = ".mp4"
                    out_path = target_dir / f"source{ext}"
                    written = 0
                    with out_path.open("wb") as fh:
                        while True:
                            chunk = resp.read(1024 * 1024)
                            if not chunk:
                                break
                            written += len(chunk)
                            if written > MAX_UPLOAD_BYTES:
                                fh.close()
                                out_path.unlink(missing_ok=True)
                                raise PipelineError(
                                    f"Remote media exceeds the {MAX_UPLOAD_MB} MB size limit.",
                                    code="FILE_TOO_LARGE",
                                )
                            fh.write(chunk)
                    filename = Path(parsed.path).name or f"remote_video{ext}"
                    return out_path, filename
        except PipelineError:
            raise
        except urllib.error.HTTPError as exc:
            if not (shutil.which("yt-dlp") or _has_module("yt_dlp")):
                raise PipelineError(
                    f"Failed to download URL (HTTP {exc.code}: {exc.reason}).",
                    code="URL_DOWNLOAD_FAILED",
                ) from exc
        except Exception as exc:
            if is_direct_ext:
                raise PipelineError(
                    f"Failed to download direct media URL: {exc}", code="URL_DOWNLOAD_FAILED"
                ) from exc

    # Attempt 2: Use yt-dlp for supported authorized video platform links
    yt_dlp_bin = shutil.which("yt-dlp")
    if not yt_dlp_bin and not _has_module("yt_dlp"):
        raise PipelineError(
            "This URL is not a direct MP4/MOV/WebM file, and `yt-dlp` is not installed on the backend.",
            code="MISSING_YT_DLP",
            missing_dependency="yt-dlp",
            how_to_fix="Install `pip install yt-dlp` on the server, or provide a direct .mp4 / .mov / .webm media URL.",
        )

    out_template = str(target_dir / "source.%(ext)s")
    cmd = ([yt_dlp_bin] if yt_dlp_bin else ["python3", "-m", "yt_dlp"]) + [
        "--no-playlist",
        "--max-filesize",
        f"{MAX_UPLOAD_MB}M",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_template,
        url,
    ]
    _run_subprocess(cmd, cwd=target_dir, timeout=600)

    candidates = [
        p
        for p in target_dir.glob("source.*")
        if p.suffix.lower() in ALLOWED_VIDEO_EXTENSIONS and p.stat().st_size > 0
    ]
    if not candidates:
        raise PipelineError(
            "yt-dlp completed but no playable video file was produced. Check that the URL is publicly accessible or authorized.",
            code="URL_NO_OUTPUT",
        )
    chosen = max(candidates, key=lambda p: p.stat().st_size)
    return chosen, chosen.name


# ---------------------------------------------------------------------------
# Real Speech Transcription (Optional Local faster-whisper or Google Gemini)
# ---------------------------------------------------------------------------


def _parse_clock_to_seconds(clock: str) -> float:
    parts = [float(p) for p in clock.strip().replace(",", ".").split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0]


def _distribute_text_across_duration(
    text: str, duration: float, offset: float
) -> List[Dict[str, Any]]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []

    raw_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    chunks: List[str] = []
    for sentence in raw_sentences:
        words = sentence.split()
        if len(words) <= 14:
            chunks.append(sentence)
        else:
            for i in range(0, len(words), 12):
                chunks.append(" ".join(words[i : i + 12]))

    total_chars = max(1, sum(len(c) for c in chunks))
    safe_duration = max(1.0, float(duration))
    cursor = offset
    segments: List[Dict[str, Any]] = []
    for idx, chunk in enumerate(chunks):
        span = safe_duration * (len(chunk) / total_chars)
        seg_end = offset + safe_duration if idx == len(chunks) - 1 else min(offset + safe_duration, cursor + max(0.4, span))
        segments.append(
            {
                "start": round(cursor, 3),
                "end": round(max(cursor + 0.2, seg_end), 3),
                "text": chunk,
            }
        )
        cursor = seg_end
    return segments


def _parse_gemini_transcript_output(
    raw_text: str, chunk_duration: float, offset: float
) -> List[Dict[str, Any]]:
    text = (raw_text or "").strip()
    if not text:
        return []

    # 1. Try JSON payload if model returned structured segments
    if text.startswith("{") or text.startswith("[") or "```json" in text:
        try:
            parsed = _extract_json_object(text)
            raw_segs = parsed.get("segments") if isinstance(parsed, dict) else parsed
            if isinstance(raw_segs, list) and raw_segs:
                out: List[Dict[str, Any]] = []
                for seg in raw_segs:
                    seg_txt = str(seg.get("text", "")).strip()
                    if not seg_txt:
                        continue
                    s_val = max(0.0, min(chunk_duration, float(seg.get("start", 0.0))))
                    e_val = max(s_val + 0.2, min(chunk_duration, float(seg.get("end", s_val + 2.0))))
                    out.append(
                        {
                            "start": round(s_val + offset, 3),
                            "end": round(e_val + offset, 3),
                            "text": seg_txt,
                        }
                    )
                if out:
                    return out
        except Exception:
            pass

    # 2. Try parsing [MM:SS - MM:SS] or [HH:MM:SS - HH:MM:SS] lines
    line_re = re.compile(
        r"\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:-|–|->|to)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]?\s*[:\-]?\s*(.+)"
    )
    timed_segments: List[Dict[str, Any]] = []
    for line in text.splitlines():
        match = line_re.match(line.strip())
        if match:
            try:
                s_val = max(0.0, min(chunk_duration, _parse_clock_to_seconds(match.group(1))))
                e_val = max(s_val + 0.2, min(chunk_duration, _parse_clock_to_seconds(match.group(2))))
                spoken = match.group(3).strip()
                if spoken:
                    timed_segments.append(
                        {
                            "start": round(s_val + offset, 3),
                            "end": round(e_val + offset, 3),
                            "text": spoken,
                        }
                    )
            except ValueError:
                continue
    if timed_segments:
        return timed_segments

    # 3. Distribute clean verbatim transcript evenly across the real audio duration
    return _distribute_text_across_duration(text, chunk_duration, offset)


def _transcribe_gemini_single_chunk(
    client: Any,
    audio_path: Path,
    language: str,
    chunk_duration: float,
    offset: float,
) -> List[Dict[str, Any]]:
    audio_bytes = audio_path.read_bytes()
    lang_hint = (
        f" The primary spoken language is `{language}`."
        if language and language != "auto"
        else ""
    )
    prompt = (
        "Transcribe all spoken dialogue in this audio verbatim with accurate timestamps. "
        "Format each spoken phrase on its own line as `[MM:SS - MM:SS] spoken text`."
        f"{lang_hint} Return only the transcript."
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_TRANSCRIBE_MODEL,
            contents=[
                genai_types.Part.from_bytes(data=audio_bytes, mime_type="audio/mpeg"),
                prompt,
            ],
        )
        raw_text = (response.text or "").strip()
    except Exception as exc:
        raise PipelineError(
            f"Google Gemini transcription failed ({GEMINI_TRANSCRIBE_MODEL}): {exc}",
            code="GEMINI_TRANSCRIBE_ERROR",
            how_to_fix="Verify that GEMINI_API_KEY is valid in your backend environment and has quota for Gemini audio transcription.",
        ) from exc

    return _parse_gemini_transcript_output(raw_text, chunk_duration, offset)


def _transcribe_audio(
    audio_path: Path, language: str, total_duration: float, work_dir: Path
) -> Dict[str, Any]:
    global _LOCAL_FASTER_WHISPER_MODEL

    lang_arg = None if (not language or language == "auto") else language

    # Optional local faster-whisper (open-source CTranslate2, if installed on server)
    if _has_module("faster_whisper"):
        from faster_whisper import WhisperModel  # type: ignore

        if _LOCAL_FASTER_WHISPER_MODEL is None:
            _LOCAL_FASTER_WHISPER_MODEL = WhisperModel(
                WHISPER_MODEL_NAME, device="auto", compute_type="int8"
            )
        seg_iter, info = _LOCAL_FASTER_WHISPER_MODEL.transcribe(
            str(audio_path),
            language=lang_arg,
            vad_filter=True,
        )
        segments: List[Dict[str, Any]] = []
        for s in seg_iter:
            txt = (s.text or "").strip()
            if txt:
                segments.append(
                    {
                        "start": round(float(s.start), 3),
                        "end": round(float(s.end), 3),
                        "text": txt,
                    }
                )
        return {
            "language": getattr(info, "language", None) or language or "auto",
            "provider": f"faster-whisper ({WHISPER_MODEL_NAME})",
            "text": " ".join(s["text"] for s in segments).strip(),
            "segments": segments,
        }

    # Default: Google Gemini exclusive transcription via official google-genai SDK
    client = _get_gemini_client()
    max_inline_bytes = 18 * 1024 * 1024
    if audio_path.stat().st_size <= max_inline_bytes:
        chunk_dur = _probe_audio_duration(audio_path, fallback=total_duration)
        segments = _transcribe_gemini_single_chunk(client, audio_path, language, chunk_dur, 0.0)
        return {
            "language": language or "auto",
            "provider": f"Google Gemini ({GEMINI_TRANSCRIBE_MODEL})",
            "text": " ".join(s["text"] for s in segments).strip(),
            "segments": segments,
        }

    # Chunk long audio files into 10-minute MP3 parts so inline audio stays well under limits
    chunk_dir = work_dir / "audio_chunks"
    chunk_dir.mkdir(exist_ok=True)
    segment_seconds = 600
    _run_subprocess(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(audio_path),
            "-f",
            "segment",
            "-segment_time",
            str(segment_seconds),
            "-c",
            "copy",
            str(chunk_dir / "chunk_%03d.mp3"),
        ],
        timeout=180,
    )
    chunk_files = sorted(chunk_dir.glob("chunk_*.mp3"))
    all_segments: List[Dict[str, Any]] = []
    offset = 0.0
    for cpath in chunk_files:
        chunk_dur = _probe_audio_duration(cpath, fallback=float(segment_seconds))
        part_segments = _transcribe_gemini_single_chunk(client, cpath, language, chunk_dur, offset)
        all_segments.extend(part_segments)
        offset += chunk_dur

    return {
        "language": language or "auto",
        "provider": f"Google Gemini ({GEMINI_TRANSCRIBE_MODEL})",
        "text": " ".join(s["text"] for s in all_segments).strip(),
        "segments": all_segments,
    }


# ---------------------------------------------------------------------------
# Real AI Highlight Selection, Titles & Descriptions (Google Gemini Exclusive)
# ---------------------------------------------------------------------------


def _build_highlight_prompt(
    segments: List[Dict[str, Any]],
    duration: float,
    clip_count: int,
    min_duration: int,
    max_duration: int,
) -> str:
    lines: List[str] = []
    for seg in segments:
        lines.append(f"[{seg['start']:.2f}s - {seg['end']:.2f}s] {seg['text']}")
    transcript_block = "\n".join(lines)
    if len(transcript_block) > 48000:
        transcript_block = transcript_block[:48000] + "\n...[transcript truncated due to length]"

    effective_min = min(min_duration, max(3, int(duration * 0.6)))
    effective_max = min(max_duration, max(effective_min + 2, int(duration)))

    return (
        f"Analyze the timestamped speech transcript from a video of total duration {duration:.2f} seconds.\n\n"
        f"Select up to {clip_count} distinct, non-overlapping highlight clips that work as standalone "
        "short-form videos with a strong opening hook, complete narrative arc, and clean ending.\n"
        f"Target duration per clip: between {effective_min} and {effective_max} seconds "
        f"(timestamps must stay strictly within 0.0 to {duration:.2f}).\n\n"
        "For each selected clip, generate:\n"
        "- title: punchy, scroll-stopping title (max 8 words)\n"
        "- hook: opening hook line or key takeaway\n"
        "- description: concise 1-2 sentence social caption/description for publishing\n"
        "- reason: 1 sentence explaining why this moment retains viewers\n"
        "- start: exact start timestamp in seconds\n"
        "- end: exact end timestamp in seconds\n\n"
        "Transcript:\n"
        f"{transcript_block}"
    )


def _extract_json_object(raw_text: str) -> Any:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", text, flags=re.DOTALL)
        if not match:
            raise PipelineError(
                "Google Gemini did not return valid JSON for highlight selection.",
                code="GEMINI_PARSE_ERROR",
            )
        return json.loads(match.group(1))


def _detect_highlights_with_gemini(
    transcript: Dict[str, Any],
    duration: float,
    options: Dict[str, Any],
) -> List[Dict[str, Any]]:
    segments = transcript.get("segments") or []
    if not segments:
        raise PipelineError(
            "No speech segments were detected in this video, so Gemini highlights could not be generated.",
            code="EMPTY_TRANSCRIPT",
            how_to_fix="Ensure the source video contains audible speech, or create manual custom clips.",
        )

    client = _get_gemini_client()
    prompt = _build_highlight_prompt(
        segments=segments,
        duration=duration,
        clip_count=options["clip_count"],
        min_duration=options["min_duration"],
        max_duration=options["max_duration"],
    )

    response_schema = genai_types.Schema(
        type=genai_types.Type.OBJECT,
        properties={
            "highlights": genai_types.Schema(
                type=genai_types.Type.ARRAY,
                items=genai_types.Schema(
                    type=genai_types.Type.OBJECT,
                    properties={
                        "title": genai_types.Schema(type=genai_types.Type.STRING),
                        "hook": genai_types.Schema(type=genai_types.Type.STRING),
                        "description": genai_types.Schema(type=genai_types.Type.STRING),
                        "reason": genai_types.Schema(type=genai_types.Type.STRING),
                        "start": genai_types.Schema(type=genai_types.Type.NUMBER),
                        "end": genai_types.Schema(type=genai_types.Type.NUMBER),
                    },
                    required=["title", "hook", "description", "reason", "start", "end"],
                ),
            )
        },
        required=["highlights"],
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=(
                    "You are an expert short-form video editor. Return only accurate highlight "
                    "timestamps, compelling titles, hooks, and publish-ready descriptions grounded "
                    "strictly in the provided transcript."
                ),
                response_mime_type="application/json",
                response_schema=response_schema,
            ),
        )
        raw_text = (response.text or "").strip()
    except Exception as exc:
        raise PipelineError(
            f"Google Gemini highlight detection failed ({GEMINI_MODEL}): {exc}",
            code="GEMINI_API_ERROR",
            how_to_fix="Verify GEMINI_API_KEY and GEMINI_MODEL in your backend environment variables.",
        ) from exc

    parsed = _extract_json_object(raw_text)
    raw_highlights = parsed.get("highlights") if isinstance(parsed, dict) else None
    if not isinstance(raw_highlights, list) or not raw_highlights:
        raise PipelineError(
            "Google Gemini returned zero highlight candidates for this transcript.",
            code="NO_HIGHLIGHTS_FOUND",
        )

    cleaned: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_highlights[: options["clip_count"]]):
        try:
            start = max(0.0, min(float(item.get("start", 0.0)), max(0.0, duration - 1.5)))
            end = max(start + 1.5, min(float(item.get("end", start + 15.0)), duration))
        except (TypeError, ValueError):
            continue
        if end - start < 1.5:
            continue
        cleaned.append(
            {
                "title": str(item.get("title") or f"Highlight {idx + 1}").strip()[:120],
                "hook": str(item.get("hook") or "").strip()[:240],
                "description": str(item.get("description") or "").strip()[:360],
                "reason": str(item.get("reason") or item.get("description") or "").strip()[:320],
                "start": round(start, 2),
                "end": round(end, 2),
            }
        )

    if not cleaned:
        raise PipelineError(
            "Gemini highlight timestamps fell outside the valid video duration.",
            code="INVALID_HIGHLIGHT_TIMESTAMPS",
        )
    return cleaned


# ---------------------------------------------------------------------------
# Real SRT Caption Generation & FFmpeg Clip Rendering
# ---------------------------------------------------------------------------


def _format_srt_timestamp(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hours = ms_total // 3_600_000
    ms_total %= 3_600_000
    minutes = ms_total // 60_000
    ms_total %= 60_000
    secs = ms_total // 1000
    ms = ms_total % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _build_clip_srt(
    segments: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    aspect_ratio: str,
) -> Tuple[str, str]:
    max_width = 30 if aspect_ratio == "9:16" else 42
    entries: List[str] = []
    excerpt_parts: List[str] = []
    counter = 1

    for seg in segments:
        s_start = float(seg["start"])
        s_end = float(seg["end"])
        if s_end <= clip_start or s_start >= clip_end:
            continue
        rel_start = max(0.0, s_start - clip_start)
        rel_end = min(clip_end - clip_start, s_end - clip_start)
        if rel_end - rel_start < 0.15:
            continue
        text = str(seg["text"]).strip()
        if not text:
            continue
        excerpt_parts.append(text)
        wrapped = "\n".join(textwrap.wrap(text, width=max_width)[:2])
        entries.append(
            f"{counter}\n{_format_srt_timestamp(rel_start)} --> {_format_srt_timestamp(rel_end)}\n{wrapped}\n"
        )
        counter += 1

    srt_content = "\n".join(entries).strip()
    if srt_content:
        srt_content += "\n"
    excerpt = " ".join(excerpt_parts).strip()
    return srt_content, excerpt[:360]


def _escape_ffmpeg_filter_path(path: Path) -> str:
    text = str(path.resolve()).replace("\\", "/")
    text = text.replace(":", "\\:")
    text = text.replace("'", "\\'")
    return text


def _aspect_filter_and_dims(aspect_ratio: str) -> Tuple[str, int, int]:
    if aspect_ratio == "9:16":
        return (
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
            1080,
            1920,
        )
    if aspect_ratio == "1:1":
        return (
            "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,setsar=1",
            1080,
            1080,
        )
    return (
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#09090F,setsar=1",
        1920,
        1080,
    )


def _caption_force_style(caption_style: str, aspect_ratio: str) -> str:
    if caption_style == "minimal":
        font_size = 15 if aspect_ratio == "9:16" else 17
        return (
            f"FontName=DejaVu Sans,FontSize={font_size},PrimaryColour=&H00F4F4F8,"
            "OutlineColour=&H0009090F,BorderStyle=1,Outline=1.5,Shadow=0,Alignment=2,MarginV=36"
        )
    if caption_style == "classic":
        font_size = 16 if aspect_ratio == "9:16" else 18
        return (
            f"FontName=DejaVu Sans,FontSize={font_size},PrimaryColour=&H00FFFFFF,"
            "BackColour=&HB409090F,BorderStyle=3,Outline=6,Shadow=0,Alignment=2,MarginV=32"
        )
    font_size = 18 if aspect_ratio == "9:16" else 20
    margin_v = 68 if aspect_ratio == "9:16" else 38
    return (
        f"FontName=DejaVu Sans,FontSize={font_size},Bold=1,PrimaryColour=&H00FFFFFF,"
        f"OutlineColour=&H00120926,BorderStyle=1,Outline=2.4,Shadow=1,Alignment=2,MarginV={margin_v}"
    )


def _render_single_clip(
    job: Dict[str, Any],
    clip_id: str,
    title: str,
    hook: str,
    description: str,
    reason: str,
    start: float,
    end: float,
    aspect_ratio: str,
    burn_captions: bool,
    caption_style: str,
    custom_srt: Optional[str] = None,
    version: int = 1,
) -> Dict[str, Any]:
    job_id = job["job_id"]
    source_path = Path(job["source"]["local_path"])
    if not source_path.is_file():
        raise PipelineError("Original source video file is no longer present on disk.", code="SOURCE_MISSING")

    duration = max(0.5, round(end - start, 3))
    clips_dir = _job_dir(job_id) / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    mp4_path = clips_dir / f"{clip_id}.mp4"
    srt_path = clips_dir / f"{clip_id}.srt"
    thumb_path = clips_dir / f"{clip_id}.jpg"

    transcript_segments = (job.get("transcript") or {}).get("segments") or []
    auto_srt, excerpt = _build_clip_srt(transcript_segments, start, end, aspect_ratio)
    final_srt = custom_srt if custom_srt is not None else auto_srt
    srt_path.write_text(final_srt, encoding="utf-8")

    vf_base, target_w, target_h = _aspect_filter_and_dims(aspect_ratio)
    vf_chain = vf_base
    if burn_captions and final_srt.strip():
        escaped_srt = _escape_ffmpeg_filter_path(srt_path)
        style_str = _caption_force_style(caption_style, aspect_ratio)
        vf_chain = f"{vf_base},subtitles='{escaped_srt}':force_style='{style_str}'"

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source_path),
        "-t",
        f"{duration:.3f}",
        "-vf",
        vf_chain,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(mp4_path),
    ]
    _run_subprocess(ffmpeg_cmd, timeout=600)

    if not mp4_path.is_file() or mp4_path.stat().st_size == 0:
        raise PipelineError(f"FFmpeg rendered an empty output for clip `{title}`.", code="RENDER_EMPTY")

    thumb_seek = min(max(0.2, duration * 0.25), max(0.2, duration - 0.2))
    try:
        _run_subprocess(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{thumb_seek:.2f}",
                "-i",
                str(mp4_path),
                "-vframes",
                "1",
                "-q:v",
                "3",
                str(thumb_path),
            ],
            timeout=60,
        )
    except PipelineError:
        pass

    return {
        "clip_id": clip_id,
        "title": title,
        "hook": hook,
        "description": description,
        "reason": reason,
        "start": round(start, 2),
        "end": round(end, 2),
        "duration": round(end - start, 2),
        "aspect_ratio": aspect_ratio,
        "burn_captions": burn_captions,
        "caption_style": caption_style,
        "width": target_w,
        "height": target_h,
        "size_bytes": mp4_path.stat().st_size,
        "version": version,
        "transcript_excerpt": excerpt,
        "preview_url": f"/api/jobs/{job_id}/clips/{clip_id}/stream",
        "thumbnail_url": f"/api/jobs/{job_id}/clips/{clip_id}/thumbnail",
        "download_url": f"/api/jobs/{job_id}/clips/{clip_id}/download",
        "srt_url": f"/api/jobs/{job_id}/clips/{clip_id}/srt",
    }


# ---------------------------------------------------------------------------
# Full Async Background Job Pipeline
# ---------------------------------------------------------------------------


async def _run_job_pipeline(job_id: str) -> None:
    job = JOBS.get(job_id)
    if not job:
        return

    job_path = _job_dir(job_id)
    current_stage = "ingest"
    job["error"] = None
    job["stages"] = _default_stages()
    job["clips"] = []
    job["progress"] = 4

    try:
        # Stage 1: Ingest & Probe
        current_stage = "ingest"
        _set_stage(job, "ingest", "active")
        if job["source"]["origin"] == "url" and not job["source"]["local_path"]:
            job["status"] = "downloading"
            job["progress"] = 10
            job["stage_message"] = "Downloading authorized media URL..."
            downloaded_path, filename = await asyncio.to_thread(
                _download_authorized_url, job["source"]["url"], job_path
            )
            job["source"]["local_path"] = str(downloaded_path)
            job["source"]["filename"] = filename

        local_path_str = job["source"].get("local_path")
        if not local_path_str or not Path(local_path_str).is_file():
            raise PipelineError("Source video file is missing.", code="SOURCE_MISSING")
        source_path = Path(local_path_str)

        job["status"] = "validating"
        job["progress"] = 18
        job["stage_message"] = "Inspecting video stream with FFprobe..."
        meta = await asyncio.to_thread(_probe_video, source_path)
        job["source"].update(meta)
        _set_stage(job, "ingest", "done")

        if not meta["has_audio"]:
            raise PipelineError(
                "This video has no audio track. Speech transcription requires an audio stream.",
                code="NO_AUDIO_STREAM",
                how_to_fix="Upload a video containing spoken audio.",
            )

        # Stage 2: Extract Audio
        current_stage = "audio"
        _set_stage(job, "audio", "active")
        job["status"] = "extracting_audio"
        job["progress"] = 28
        job["stage_message"] = "Extracting 16 kHz mono audio track with FFmpeg..."
        audio_path = job_path / "audio.mp3"
        await asyncio.to_thread(_extract_audio, source_path, audio_path)
        _set_stage(job, "audio", "done")

        # Stage 3: Transcribe Speech (Gemini or optional local faster-whisper)
        current_stage = "transcribe"
        _set_stage(job, "transcribe", "active")
        job["status"] = "transcribing"
        job["progress"] = 45
        job["stage_message"] = "Transcribing speech with Google Gemini..."
        transcript = await asyncio.to_thread(
            _transcribe_audio,
            audio_path,
            job["options"]["language"],
            job["source"]["duration"],
            job_path,
        )
        job["transcript"] = transcript
        (job_path / "transcript.json").write_text(
            json.dumps(transcript, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        _set_stage(job, "transcribe", "done")

        # Stage 4: AI Highlight Detection (Gemini Exclusive)
        current_stage = "highlights"
        _set_stage(job, "highlights", "active")
        job["status"] = "detecting_highlights"
        job["progress"] = 64
        job["stage_message"] = "Selecting highlights, titles, and descriptions with Gemini..."
        highlights = await asyncio.to_thread(
            _detect_highlights_with_gemini,
            transcript,
            job["source"]["duration"],
            job["options"],
        )
        _set_stage(job, "highlights", "done")

        # Stage 5: FFmpeg Clip Rendering
        current_stage = "render"
        _set_stage(job, "render", "active")
        job["status"] = "rendering_clips"
        total = len(highlights)
        opts = job["options"]

        for idx, hl in enumerate(highlights, start=1):
            job["progress"] = 68 + int((idx - 1) / max(1, total) * 28)
            job["stage_message"] = (
                f"Rendering clip {idx} of {total} ({opts['aspect_ratio']}"
                f"{' + captions' if opts['burn_captions'] else ''})..."
            )
            clip_id = f"clip_{idx}_{uuid.uuid4().hex[:6]}"
            clip_obj = await asyncio.to_thread(
                _render_single_clip,
                job,
                clip_id,
                hl["title"],
                hl["hook"],
                hl["description"],
                hl["reason"],
                hl["start"],
                hl["end"],
                opts["aspect_ratio"],
                opts["burn_captions"],
                opts["caption_style"],
                None,
                1,
            )
            job["clips"].append(clip_obj)
            job["updated_at"] = _utc_now_iso()

        _set_stage(job, "render", "done")
        job["status"] = "completed"
        job["progress"] = 100
        job["stage_message"] = f"Rendered {len(job['clips'])} clips ready to preview and download."
        job["updated_at"] = _utc_now_iso()

    except asyncio.CancelledError:
        job["status"] = "failed"
        job["stage_message"] = "Job was cancelled."
        raise
    except PipelineError as exc:
        _set_stage(job, current_stage, "error")
        job["status"] = "failed"
        job["stage_message"] = "Processing halted due to an error."
        job["error"] = {
            "code": exc.code,
            "message": exc.message,
            "missing_dependency": exc.missing_dependency,
            "how_to_fix": exc.how_to_fix,
        }
        job["updated_at"] = _utc_now_iso()
    except Exception as exc:
        _set_stage(job, current_stage, "error")
        job["status"] = "failed"
        job["stage_message"] = "Unexpected processing error."
        job["error"] = {
            "code": "UNEXPECTED_ERROR",
            "message": str(exc) or "An unexpected server error occurred.",
            "missing_dependency": None,
            "how_to_fix": "Check server logs and retry.",
        }
        job["updated_at"] = _utc_now_iso()
    finally:
        JOB_TASKS.pop(job_id, None)


# ---------------------------------------------------------------------------
# Background Temporary Directory Cleanup
# ---------------------------------------------------------------------------


def _cleanup_job_files(job_id: str) -> None:
    task = JOB_TASKS.pop(job_id, None)
    if task and not task.done():
        task.cancel()
    JOBS.pop(job_id, None)
    try:
        path = _job_dir(job_id)
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass


async def _periodic_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(300)
        cutoff = time.time() - JOB_TTL_SECONDS
        expired_ids = [
            jid
            for jid, jdata in list(JOBS.items())
            if jdata.get("created_ts", 0) < cutoff and jid not in JOB_TASKS
        ]
        for jid in expired_ids:
            _cleanup_job_files(jid)

        if TEMP_ROOT.exists():
            for child in TEMP_ROOT.iterdir():
                if child.is_dir() and child.name not in JOBS:
                    try:
                        if child.stat().st_mtime < cutoff:
                            shutil.rmtree(child, ignore_errors=True)
                    except OSError:
                        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cleanup_task = asyncio.create_task(_periodic_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        for task in list(JOB_TASKS.values()):
            task.cancel()


# ---------------------------------------------------------------------------
# FastAPI Application & Routes (Railway + Vercel CORS Ready)
# ---------------------------------------------------------------------------

app = FastAPI(
    title="FrameCut AI Video Clipping Backend (Google Gemini)",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Range", "Accept-Ranges", "Content-Length"],
)


# Frontend Static Asset Routes
@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html", media_type="text/html; charset=utf-8")


@app.get("/style.css", include_in_schema=False)
async def serve_style() -> FileResponse:
    return FileResponse(BASE_DIR / "style.css", media_type="text/css; charset=utf-8")


@app.get("/script.js", include_in_schema=False)
async def serve_script() -> FileResponse:
    return FileResponse(BASE_DIR / "script.js", media_type="application/javascript; charset=utf-8")


# Health & Capabilities Endpoint
@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    return check_system_capabilities()


# Upload Video & Start Processing Job
@app.post("/api/jobs/upload", status_code=201)
async def api_upload_job(
    file: UploadFile = File(...),
    aspect_ratio: str = Form("9:16"),
    clip_count: int = Form(4),
    min_duration: int = Form(20),
    max_duration: int = Form(60),
    burn_captions: bool = Form(True),
    caption_style: str = Form("dynamic"),
    language: str = Form("auto"),
) -> Dict[str, Any]:
    if not _get_api_key("GEMINI_API_KEY"):
        raise HTTPException(status_code=503, detail=MISSING_GEMINI_KEY_MESSAGE)

    filename = Path(file.filename or "upload.mp4").name
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format `{ext or 'unknown'}`. Allowed formats: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}.",
        )

    options = _normalize_options(
        aspect_ratio=aspect_ratio,
        clip_count=clip_count,
        min_duration=min_duration,
        max_duration=max_duration,
        burn_captions=burn_captions,
        caption_style=caption_style,
        language=language,
    )

    job = _create_job_record(origin="upload", filename=filename, options=options)
    job_id = job["job_id"]
    dest_path = _job_dir(job_id) / f"source{ext}"

    total_written = 0
    try:
        with dest_path.open("wb") as out_fh:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_written += len(chunk)
                if total_written > MAX_UPLOAD_BYTES:
                    out_fh.close()
                    _cleanup_job_files(job_id)
                    raise HTTPException(
                        status_code=413,
                        detail=f"Uploaded video exceeds the server limit of {MAX_UPLOAD_MB} MB.",
                    )
                out_fh.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        _cleanup_job_files(job_id)
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded video: {exc}") from exc
    finally:
        await file.close()

    if total_written == 0:
        _cleanup_job_files(job_id)
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    job["source"]["local_path"] = str(dest_path)
    job["source"]["size_bytes"] = total_written
    JOB_TASKS[job_id] = asyncio.create_task(_run_job_pipeline(job_id))
    return _serialize_job(job)


# Authorized URL Ingest & Start Processing Job
@app.post("/api/jobs/url", status_code=201)
async def api_url_job(payload: UrlJobRequest) -> Dict[str, Any]:
    if not _get_api_key("GEMINI_API_KEY"):
        raise HTTPException(status_code=503, detail=MISSING_GEMINI_KEY_MESSAGE)

    if not payload.authorized:
        raise HTTPException(
            status_code=400,
            detail="You must confirm that you own or are authorized to process this video URL.",
        )

    try:
        parsed = _validate_public_url(payload.url)
    except PipelineError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    options = _normalize_options(
        aspect_ratio=payload.aspect_ratio,
        clip_count=payload.clip_count,
        min_duration=payload.min_duration,
        max_duration=payload.max_duration,
        burn_captions=payload.burn_captions,
        caption_style=payload.caption_style,
        language=payload.language,
    )

    label_name = Path(parsed.path).name or parsed.hostname or "authorized-url"
    job = _create_job_record(
        origin="url",
        filename=label_name,
        options=options,
        url=payload.url.strip(),
    )
    job_id = job["job_id"]
    JOB_TASKS[job_id] = asyncio.create_task(_run_job_pipeline(job_id))
    return _serialize_job(job)


# List Temporary Session Jobs
@app.get("/api/jobs")
async def api_list_jobs() -> Dict[str, Any]:
    ordered = sorted(JOBS.values(), key=lambda j: j["created_ts"], reverse=True)
    return {
        "jobs": [
            {
                "job_id": j["job_id"],
                "status": j["status"],
                "progress": j["progress"],
                "stage_message": j["stage_message"],
                "created_at": j["created_at"],
                "source_name": j["source"]["filename"],
                "clip_count": len(j["clips"]),
                "error": j["error"],
            }
            for j in ordered
        ]
    }


# Get Single Job State
@app.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str) -> Dict[str, Any]:
    _validate_id(job_id, "job_id")
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or already expired.")
    return _serialize_job(job)


# Retry Failed Job
@app.post("/api/jobs/{job_id}/retry")
async def api_retry_job(job_id: str) -> Dict[str, Any]:
    _validate_id(job_id, "job_id")
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or already expired.")
    if job_id in JOB_TASKS and not JOB_TASKS[job_id].done():
        raise HTTPException(status_code=409, detail="Job is currently processing.")

    job["status"] = "queued"
    job["progress"] = 0
    job["stage_message"] = "Retrying processing pipeline..."
    job["error"] = None
    job["stages"] = _default_stages()
    JOB_TASKS[job_id] = asyncio.create_task(_run_job_pipeline(job_id))
    return _serialize_job(job)


# Delete Job & Temporary Directory
@app.delete("/api/jobs/{job_id}")
async def api_delete_job(job_id: str) -> Dict[str, Any]:
    _validate_id(job_id, "job_id")
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found.")
    _cleanup_job_files(job_id)
    return {"deleted": True, "job_id": job_id}


# Create Custom Manual Clip from Source Video
@app.post("/api/jobs/{job_id}/clips", status_code=201)
async def api_create_custom_clip(job_id: str, payload: ClipMutationRequest) -> Dict[str, Any]:
    _validate_id(job_id, "job_id")
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    duration = float(job["source"].get("duration") or 0.0)
    if duration <= 0.0 or not job["source"].get("local_path"):
        raise HTTPException(status_code=400, detail="Source media is not ready for clipping yet.")

    start = round(max(0.0, payload.start), 2)
    end = round(min(duration, payload.end), 2)
    if end - start < 1.0:
        raise HTTPException(status_code=400, detail="Clip duration must be at least 1.0 second.")

    aspect = payload.aspect_ratio or job["options"]["aspect_ratio"]
    if aspect not in ALLOWED_ASPECT_RATIOS:
        raise HTTPException(status_code=400, detail="Invalid aspect ratio.")
    burn = job["options"]["burn_captions"] if payload.burn_captions is None else payload.burn_captions
    style = payload.caption_style or job["options"]["caption_style"]
    if style not in ALLOWED_CAPTION_STYLES:
        style = "dynamic"

    clip_id = f"custom_{uuid.uuid4().hex[:8]}"
    title = (payload.title or f"Custom Clip {len(job['clips']) + 1}").strip()

    try:
        clip_obj = await asyncio.to_thread(
            _render_single_clip,
            job,
            clip_id,
            title,
            "",
            "Custom manual clip created from source timeline.",
            "Custom manual clip created from source timeline.",
            start,
            end,
            aspect,
            burn,
            style,
            payload.captions_srt,
            1,
        )
    except PipelineError as exc:
        raise HTTPException(status_code=500, detail=exc.message) from exc

    job["clips"].append(clip_obj)
    job["updated_at"] = _utc_now_iso()
    return clip_obj


# Trim / Edit / Re-render Existing Clip
@app.patch("/api/jobs/{job_id}/clips/{clip_id}")
async def api_update_clip(
    job_id: str, clip_id: str, payload: ClipMutationRequest
) -> Dict[str, Any]:
    _validate_id(job_id, "job_id")
    _validate_id(clip_id, "clip_id")
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    clip_index = next((i for i, c in enumerate(job["clips"]) if c["clip_id"] == clip_id), None)
    if clip_index is None:
        raise HTTPException(status_code=404, detail="Clip not found.")

    existing = job["clips"][clip_index]
    duration = float(job["source"].get("duration") or 0.0)
    start = round(max(0.0, payload.start), 2)
    end = round(min(duration, payload.end), 2)
    if end - start < 1.0:
        raise HTTPException(status_code=400, detail="Clip duration must be at least 1.0 second.")

    aspect = payload.aspect_ratio or existing["aspect_ratio"]
    if aspect not in ALLOWED_ASPECT_RATIOS:
        raise HTTPException(status_code=400, detail="Invalid aspect ratio.")
    burn = existing["burn_captions"] if payload.burn_captions is None else payload.burn_captions
    style = payload.caption_style or existing["caption_style"]
    if style not in ALLOWED_CAPTION_STYLES:
        style = "dynamic"
    title = (payload.title or existing["title"]).strip()
    next_version = int(existing.get("version", 1)) + 1

    try:
        updated = await asyncio.to_thread(
            _render_single_clip,
            job,
            clip_id,
            title,
            existing.get("hook", ""),
            existing.get("description", ""),
            existing.get("reason", ""),
            start,
            end,
            aspect,
            burn,
            style,
            payload.captions_srt,
            next_version,
        )
    except PipelineError as exc:
        raise HTTPException(status_code=500, detail=exc.message) from exc

    job["clips"][clip_index] = updated
    job["updated_at"] = _utc_now_iso()
    return updated


# Delete Single Clip
@app.delete("/api/jobs/{job_id}/clips/{clip_id}")
async def api_delete_clip(job_id: str, clip_id: str) -> Dict[str, Any]:
    _validate_id(job_id, "job_id")
    _validate_id(clip_id, "clip_id")
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    before = len(job["clips"])
    job["clips"] = [c for c in job["clips"] if c["clip_id"] != clip_id]
    if len(job["clips"]) == before:
        raise HTTPException(status_code=404, detail="Clip not found.")

    clips_dir = _job_dir(job_id) / "clips"
    for ext in (".mp4", ".srt", ".jpg"):
        (clips_dir / f"{clip_id}{ext}").unlink(missing_ok=True)

    job["updated_at"] = _utc_now_iso()
    return {"deleted": True, "clip_id": clip_id}


# Stream Clip Video Preview (Supports HTTP Range Requests via FileResponse)
@app.get("/api/jobs/{job_id}/clips/{clip_id}/stream")
async def api_stream_clip(job_id: str, clip_id: str) -> FileResponse:
    _validate_id(job_id, "job_id")
    _validate_id(clip_id, "clip_id")
    mp4_path = _job_dir(job_id) / "clips" / f"{clip_id}.mp4"
    if not mp4_path.is_file():
        raise HTTPException(status_code=404, detail="Clip video file not found.")
    return FileResponse(mp4_path, media_type="video/mp4")


# Clip Poster Thumbnail
@app.get("/api/jobs/{job_id}/clips/{clip_id}/thumbnail")
async def api_clip_thumbnail(job_id: str, clip_id: str) -> FileResponse:
    _validate_id(job_id, "job_id")
    _validate_id(clip_id, "clip_id")
    thumb_path = _job_dir(job_id) / "clips" / f"{clip_id}.jpg"
    if not thumb_path.is_file():
        raise HTTPException(status_code=404, detail="Clip thumbnail not found.")
    return FileResponse(thumb_path, media_type="image/jpeg")


# Download Single Clip MP4
@app.get("/api/jobs/{job_id}/clips/{clip_id}/download")
async def api_download_clip(job_id: str, clip_id: str) -> FileResponse:
    _validate_id(job_id, "job_id")
    _validate_id(clip_id, "clip_id")
    job = JOBS.get(job_id)
    clip = next((c for c in (job["clips"] if job else []) if c["clip_id"] == clip_id), None)
    mp4_path = _job_dir(job_id) / "clips" / f"{clip_id}.mp4"
    if not mp4_path.is_file():
        raise HTTPException(status_code=404, detail="Clip video file not found.")
    dl_name = f"{_slugify(clip['title'], clip_id) if clip else clip_id}.mp4"
    return FileResponse(mp4_path, media_type="video/mp4", filename=dl_name)


# Read or Download Clip SRT Captions
@app.get("/api/jobs/{job_id}/clips/{clip_id}/srt")
async def api_clip_srt(job_id: str, clip_id: str, download: bool = Query(False)):
    _validate_id(job_id, "job_id")
    _validate_id(clip_id, "clip_id")
    srt_path = _job_dir(job_id) / "clips" / f"{clip_id}.srt"
    if not srt_path.is_file():
        raise HTTPException(status_code=404, detail="Caption file not found.")
    if download:
        job = JOBS.get(job_id)
        clip = next((c for c in (job["clips"] if job else []) if c["clip_id"] == clip_id), None)
        dl_name = f"{_slugify(clip['title'], clip_id) if clip else clip_id}.srt"
        return FileResponse(srt_path, media_type="application/x-subrip", filename=dl_name)
    return PlainTextResponse(srt_path.read_text(encoding="utf-8"), media_type="text/plain; charset=utf-8")


# Download All Rendered Clips as ZIP Archive
@app.get("/api/jobs/{job_id}/download-all")
async def api_download_all_clips(job_id: str) -> FileResponse:
    _validate_id(job_id, "job_id")
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if not job["clips"]:
        raise HTTPException(status_code=400, detail="No rendered clips are available to archive.")

    job_path = _job_dir(job_id)
    clips_dir = job_path / "clips"
    zip_path = job_path / f"framecut_{job_id}_clips.zip"

    def _build_zip() -> Path:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
            for idx, clip in enumerate(job["clips"], start=1):
                cid = clip["clip_id"]
                slug = _slugify(clip["title"], f"clip-{idx}")
                mp4_file = clips_dir / f"{cid}.mp4"
                srt_file = clips_dir / f"{cid}.srt"
                if mp4_file.is_file():
                    zf.write(mp4_file, arcname=f"{idx:02d}_{slug}.mp4")
                if srt_file.is_file() and srt_file.stat().st_size > 0:
                    zf.write(srt_file, arcname=f"{idx:02d}_{slug}.srt")
        return zip_path

    await asyncio.to_thread(_build_zip)
    source_slug = _slugify(Path(job["source"]["filename"]).stem, job_id)
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{source_slug}-clips.zip",
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
