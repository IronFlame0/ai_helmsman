import hashlib
import json
import os
import asyncio

from contextlib import asynccontextmanager

# AsyncAnthropic is required for streaming SSE — sync .stream() blocks the event loop.
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from anthropic import AsyncAnthropic

load_dotenv()

from embedding import get_provider
from files_api import compute_sha256, delete_file, upload_pdf
from ingestion import ingest_pdf, ingest_url
from retrieval import (
    add_source,
    delete_source,
    get_source,
    list_sources,
    search,
    source_exists_by_sha256,
    store_chunks,
)

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
# Haiku is enough for query rewriting — fast and cheap
REWRITE_MODEL = os.getenv("REWRITE_MODEL", "claude-haiku-4-5-20251001")
TOP_K = int(os.getenv("TOP_K", "5"))
# cosine distance threshold: 0 = identical, 1 = orthogonal; chunks above this are dropped
MAX_DISTANCE = float(os.getenv("MAX_DISTANCE", "0.69"))

_anthropic = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

_QUERY_GEN_SYSTEM = """\
You are a multilingual search query generator for a RAG system.
Given a conversation history and a follow-up question, generate search query variants \
that maximize recall across documents written in different languages.

Rules:
- Resolve pronouns and references ("it", "that", "the same") using the conversation history
- Preserve technical terms, product names, numbers, and abbreviations exactly
- Remove gibberish (random character sequences that form no real word in any language)
- Generate at least 2 variants in the SAME language as the input question
- Generate at least 2 variants in ENGLISH (translate if needed)
- Each variant must be meaningfully different (synonyms, paraphrases, alternative phrasing)
- Output ONLY a valid JSON array of strings — no explanation, no markdown, no extra text
Example output: ["запросы на русском", "вариант 2", "English variant 1", "English variant 2"]\
"""


async def generate_queries(query: str, history: list["Message"]) -> list[str]:
    """
    Generate multilingual search query variants. Always includes the original query.
    Returns at least [query] on any error.
    """
    recent = history[-6:]
    history_text = "\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.content[:400]}"
        for m in recent
    ) if recent else ""

    try:
        response = await _anthropic.messages.create(
            model=REWRITE_MODEL,
            max_tokens=300,
            system=_QUERY_GEN_SYSTEM,
            messages=[{
                "role": "user",
                "content": (
                    f"Conversation:\n{history_text}\n\n" if history_text else ""
                ) + f"Question: {query}\n\nJSON array of search queries:",
            }],
        )
        raw = response.content[0].text.strip()
        variants: list[str] = json.loads(raw)
        seen: set[str] = set()
        result: list[str] = []
        for v in [query] + variants:
            v = v.strip()
            if v and v not in seen:
                seen.add(v)
                result.append(v)
        return result
    except Exception as exc:
        print(f"[queries] error: {exc}")
        return [query]

SYSTEM_PROMPT = """\
You are a precise, helpful assistant that answers questions using the provided document context.

Guidelines:
- Ground your answer in the provided context. Quote or paraphrase it directly when useful.
- Always cite the source (file name and page number for PDFs, domain for URLs) inline when referencing specific information.
- If the context is insufficient to answer fully, say so clearly, then supplement with your general knowledge if relevant.
- Keep answers concise unless the question requires depth.\
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_provider()  # warm up embedding model at startup
    yield


app = FastAPI(title="AI Helmsman", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Sources ───────────────────────────────────────────────────────────────────

@app.get("/sources")
def get_sources():
    return list_sources()


@app.delete("/sources/{source_id}")
def delete_source_endpoint(source_id: str):
    source = get_source(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found.")
    if not delete_source(source_id):
        raise HTTPException(status_code=404, detail="Source not found.")
    if source.get("file_id"):
        delete_file(source["file_id"])
    return {"ok": True}


# ── Upload: PDF ───────────────────────────────────────────────────────────────

@app.post("/upload/pdf")
async def upload_pdf_endpoint(file: UploadFile = File(...)):
    content = await file.read()
    sha256 = compute_sha256(content)

    if source_exists_by_sha256(sha256):
        raise HTTPException(status_code=409, detail="This document is already indexed.")

    # Upload to Anthropic Files API for stable reference + future native access
    file_id = upload_pdf(content, file.filename or "upload.pdf")

    chunks, metadatas, page_count = ingest_pdf(content, file.filename or "upload.pdf")
    if not chunks:
        raise HTTPException(status_code=422, detail="Could not extract text from this PDF.")

    source_id = add_source(
        name=file.filename or "upload.pdf",
        title=metadatas[0].get("title", "") if metadatas else "",
        source_type="pdf",
        sha256=sha256,
        chunks_count=len(chunks),
        file_id=file_id,
        pages=page_count,
    )
    store_chunks(source_id, chunks, metadatas)

    return {"id": source_id, "name": file.filename, "chunks": len(chunks), "pages": page_count}


# ── Upload: URL ───────────────────────────────────────────────────────────────

@app.post("/upload/url")
async def upload_url_endpoint(url: str = Form(...)):
    import httpx as _httpx

    sha256 = hashlib.sha256(url.encode()).hexdigest()
    if source_exists_by_sha256(sha256):
        raise HTTPException(status_code=409, detail="This URL is already indexed.")

    try:
        chunks, metadatas = ingest_url(url)
    except _httpx.HTTPError as exc:
        raise HTTPException(status_code=422, detail=f"Failed to fetch URL: {exc}")

    if not chunks:
        raise HTTPException(status_code=422, detail="Could not extract text from this URL.")

    from urllib.parse import urlparse
    domain = urlparse(url).netloc

    source_id = add_source(
        name=domain,
        title=metadatas[0].get("title", "") if metadatas else "",
        source_type="url",
        sha256=sha256,
        chunks_count=len(chunks),
        url=url,
    )
    store_chunks(source_id, chunks, metadatas)

    return {"id": source_id, "name": domain, "chunks": len(chunks)}


# ── Chat ──────────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    query: str
    history: list[Message] = []


@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    queries = await generate_queries(req.query, req.history)
    # Run all searches in parallel; search() is sync+CPU-bound so use to_thread
    results_per_query = await asyncio.gather(*[
        asyncio.to_thread(search, q, TOP_K, MAX_DISTANCE)
        for q in queries
    ])
    # Merge: keep best (lowest) distance per unique chunk
    merged: dict[str, dict] = {}
    for hits in results_per_query:
        for hit in hits:
            meta = hit["metadata"]
            key = f"{meta.get('source_id', '')}_{meta.get('chunk_index', '')}"
            if key not in merged or hit["distance"] < merged[key]["distance"]:
                merged[key] = hit
    chunks = sorted(merged.values(), key=lambda h: h["distance"])[:TOP_K]
    if chunks:
        context_blocks = []
        for i, c in enumerate(chunks, 1):
            meta = c["metadata"]
            ref = meta.get("source_name", "Unknown")
            if meta.get("page"):
                ref += f", page {meta['page']}"
            context_blocks.append(f"[{i}] {ref}\n{c['text']}")
        context = "\n\n---\n\n".join(context_blocks)
        augmented_query = f"Context from documents:\n\n{context}\n\n---\n\nQuestion: {req.query}"
    else:
        augmented_query = req.query

    # Build message list with prompt caching on conversation history
    messages: list[dict] = []
    for idx, msg in enumerate(req.history):
        is_last = idx == len(req.history) - 1
        if is_last:
            # Cache everything up to (and including) the last history message;
            # on the next request this prefix won't need re-processing.
            messages.append({
                "role": msg.role,
                "content": [{"type": "text", "text": msg.content, "cache_control": {"type": "ephemeral"}}],
            })
        else:
            messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": augmented_query})

    seen_sources: set[str] = set()
    sources_meta: list[dict] = []
    for c in chunks:
        meta = c["metadata"]
        # Deduplicate: one entry per (source_id, page) pair so that different
        # URLs from the same domain are not collapsed into one source.
        key = f"{meta.get('source_id', meta.get('source_name', ''))}::{meta.get('page', '')}"
        if key not in seen_sources:
            seen_sources.add(key)
            sources_meta.append({
                "source_name": meta.get("source_name", ""),
                "source_type": meta.get("source_type", ""),
                "title": meta.get("title", ""),
                "page": meta.get("page"),
                "url": meta.get("url"),
            })

    async def generate():
        yield {"event": "sources", "data": json.dumps(sources_meta)}

        try:
            async with _anthropic.messages.stream(
                model=MODEL,
                max_tokens=4096,
                system=[{
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield {"event": "text", "data": text}

        except Exception as exc:
            yield {"event": "error", "data": str(exc)}

        yield {"event": "done", "data": ""}
    return EventSourceResponse(
        generate(),
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )