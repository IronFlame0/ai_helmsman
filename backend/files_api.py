"""
Anthropic Files API wrapper.

Responsibilities:
  - Upload PDF blobs to Anthropic → returns file_id used as a stable reference
  - Delete files when sources are removed
  - Compute SHA-256 for local deduplication (two identical uploads → same hash)
"""
import hashlib
import io
import os
from typing import Optional

import anthropic


_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upload_pdf(content: bytes, filename: str) -> Optional[str]:
    """
    Upload a PDF to the Anthropic Files API.
    Returns the file_id on success, None if the API call fails (non-blocking).
    """
    try:
        response = _get_client().beta.files.upload(
            file=(filename, io.BytesIO(content), "application/pdf"),
        )
        return response.id
    except Exception as exc:
        print(f"[files_api] Warning: Anthropic Files upload failed — {exc}")
        return None


def delete_file(file_id: str) -> None:
    """Best-effort deletion; silently ignores errors."""
    try:
        _get_client().beta.files.delete(file_id)
    except Exception:
        pass
