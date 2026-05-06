"""
ChromaDB persistence layer.

Sources are tracked in chroma_store/sources.json alongside the vector DB
so we don't need a separate SQL store.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import chromadb

from embedding import get_provider

CHROMA_DIR = Path(os.getenv("CHROMA_DIR", "./chroma_store"))
SOURCES_FILE = CHROMA_DIR / "sources.json"
COLLECTION_NAME = "chunks"

_chroma: Optional[chromadb.ClientAPI] = None
_collection = None


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_collection():
    global _chroma, _collection
    if _collection is None:
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        _chroma = chromadb.PersistentClient(path=str(CHROMA_DIR))
        _collection = _chroma.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def _load_sources() -> dict:
    if SOURCES_FILE.exists():
        return json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    return {}


def _save_sources(sources: dict) -> None:
    SOURCES_FILE.write_text(json.dumps(sources, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

def source_exists_by_sha256(sha256: str) -> bool:
    return any(s.get("sha256") == sha256 for s in _load_sources().values())


def add_source(
    *,
    name: str,
    source_type: str,
    sha256: str,
    chunks_count: int,
    title: str = "",
    file_id: Optional[str] = None,
    url: Optional[str] = None,
    pages: Optional[int] = None,
) -> str:
    sources = _load_sources()
    source_id = str(uuid.uuid4())
    sources[source_id] = {
        "id": source_id,
        "name": name,
        "title": title,
        "type": source_type,
        "url": url,
        "pages": pages,
        "chunks_count": chunks_count,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sha256": sha256,
        "file_id": file_id,
    }
    _save_sources(sources)
    return source_id


def store_chunks(source_id: str, chunks: list[str], metadatas: list[dict]) -> None:
    if not chunks:
        return
    col = _get_collection()
    provider = get_provider()
    embeddings = provider.embed(chunks)
    col.add(
        ids=[f"{source_id}_{i}" for i in range(len(chunks))],
        documents=chunks,
        embeddings=embeddings,
        metadatas=[{**m, "source_id": source_id} for m in metadatas],
    )


def search(query: str, top_k: int = 5, max_distance: float = 0.65) -> list[dict]:
    col = _get_collection()
    total = col.count()
    if total == 0:
        return []
    provider = get_provider()
    results = col.query(
        query_embeddings=[provider.embed([query])[0]],
        n_results=min(top_k, total),
        include=["documents", "metadatas", "distances"],
    )
    hits = [
        {"text": doc, "metadata": meta, "distance": dist}
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        )
        if dist <= max_distance
    ]
    hits.sort(key=lambda h: h["distance"])
    return hits


def list_sources() -> list[dict]:
    return list(_load_sources().values())


def get_source(source_id: str) -> Optional[dict]:
    return _load_sources().get(source_id)


def delete_source(source_id: str) -> bool:
    sources = _load_sources()
    if source_id not in sources:
        return False
    col = _get_collection()
    col.delete(where={"source_id": source_id})
    sources.pop(source_id)
    _save_sources(sources)
    return True
