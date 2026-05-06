"""PDF and URL → text → token-aware chunks."""
import re
from urllib.parse import urlparse

import httpx
import tiktoken
from bs4 import BeautifulSoup

_enc = tiktoken.get_encoding("cl100k_base")

CHUNK_SIZE = 1200   # tokens
CHUNK_OVERLAP = 150  # tokens


# ── Chunking ──────────────────────────────────────────────────────────────────

def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    tokens = _enc.encode(text)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        piece = _enc.decode(tokens[start:end]).strip()
        if piece:
            chunks.append(piece)
        if end == len(tokens):
            break
        start += chunk_size - overlap
    return chunks


# ── PDF ───────────────────────────────────────────────────────────────────────

def _parse_pdf(content: bytes) -> list[tuple[str, int]]:
    """Returns [(page_text, page_number), ...]  (1-based page numbers)."""
    import fitz  # pymupdf
    doc = fitz.open(stream=content, filetype="pdf")
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text()
        if text.strip():
            pages.append((text, i + 1))
    doc.close()
    return pages


def ingest_pdf(content: bytes, filename: str) -> tuple[list[str], list[dict], int]:
    """
    Returns (chunks, metadatas, page_count).
    Each metadata dict carries source_name, source_type, page, chunk_index, title.
    """
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    pdf_title = (doc.metadata or {}).get("title", "").strip() or filename
    doc.close()

    pages = _parse_pdf(content)
    chunks: list[str] = []
    metadatas: list[dict] = []
    for page_text, page_num in pages:
        for i, chunk in enumerate(chunk_text(page_text)):
            chunks.append(chunk)
            metadatas.append({
                "source_name": filename,
                "source_type": "pdf",
                "title": pdf_title,
                "page": page_num,
                "chunk_index": i,
            })
    return chunks, metadatas, len(pages)


# ── URL ───────────────────────────────────────────────────────────────────────

def _fetch_url(url: str) -> tuple[str, str]:
    """Returns (text, title)."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ai-helmsman/1.0)"}
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)), title


def ingest_url(url: str) -> tuple[list[str], list[dict]]:
    """Returns (chunks, metadatas)."""
    domain = urlparse(url).netloc
    text, title = _fetch_url(url)
    chunks = chunk_text(text)
    metadatas = [
        {
            "source_name": domain,
            "source_type": "url",
            "url": url,
            "title": title,
            "page": 0,
            "chunk_index": i,
        }
        for i in range(len(chunks))
    ]
    return chunks, metadatas
