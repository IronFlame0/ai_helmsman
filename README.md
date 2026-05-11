# ⚓ AI Helmsman

A self-hosted RAG (Retrieval-Augmented Generation) chat that answers questions based on your own documents — PDFs and web pages.

![Stack](https://img.shields.io/badge/Claude-Sonnet_4.6-blueviolet) ![Stack](https://img.shields.io/badge/ChromaDB-vector_store-orange) ![Stack](https://img.shields.io/badge/React_18-frontend-61dafb) ![Stack](https://img.shields.io/badge/FastAPI-backend-009688)

## Features

- **PDF & URL ingestion** — drop a PDF or paste a URL; text is chunked, embedded, and stored
- **Multi-query retrieval** — each question is expanded into multilingual variants (RU + EN) and searched in parallel for better recall
- **Streaming answers** — Claude's response streams token-by-token via SSE
- **Source attribution** — every answer shows which documents were used, with favicons and article titles
- **Prompt caching** — conversation history is cached on the Anthropic side to cut costs on long sessions
- **Pluggable embeddings** — local (`all-MiniLM-L6-v2`) or OpenAI (`text-embedding-3-small`)

## Architecture

```
browser
  └── React + Vite (TypeScript)
        └── /api  →  nginx  →  FastAPI (Python)
                                ├── Ingestion: PDF (PyMuPDF) / URL (httpx + BeautifulSoup)
                                ├── Embeddings: sentence-transformers or OpenAI
                                ├── Vector store: ChromaDB (persistent, cosine similarity)
                                ├── Query expansion: Claude Haiku
                                └── Generation: Claude Sonnet (streaming SSE)
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Anthropic API key → [console.anthropic.com](https://console.anthropic.com)

### 1. Clone & configure

```bash
git clone <repo>
cd ai_helmsman
cp backend/.env.example .env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Run

**Production:**
```bash
docker compose up --build
```

**Development** (hot reload on both frontend and backend):
```bash
docker compose -f docker-compose.dev.yml up --build
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

All settings are in `.env`:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model for answers |
| `REWRITE_MODEL` | `claude-haiku-4-5-20251001` | Model for query expansion |
| `EMBEDDING_PROVIDER` | `local` | `local` or `openai` |
| `OPENAI_API_KEY` | — | Required if `EMBEDDING_PROVIDER=openai` |
| `TOP_K` | `5` | Max chunks retrieved per query |
| `MAX_DISTANCE` | `0.69` | Cosine distance cutoff (0 = identical, 1 = orthogonal) |
| `CHROMA_DIR` | `/app/chroma_store` | Vector DB path inside container |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/sources` | List indexed sources |
| `DELETE` | `/sources/{id}` | Remove a source and its chunks |
| `POST` | `/upload/pdf` | Upload and index a PDF |
| `POST` | `/upload/url` | Fetch and index a URL |
| `POST` | `/chat` | SSE stream: sources → text tokens → done |

### Chat SSE events

```
event: sources
data: [{"source_name": "...", "title": "...", "url": "...", ...}]

event: text
data: token

event: done
data:
```

## Local Development (without Docker)

**Backend:**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env  # fill in your key
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` → `http://localhost:8000` automatically.

## Data Storage

- Vector embeddings: `backend/chroma_store/` (ChromaDB, mapped as Docker volume)
- Source metadata: `backend/chroma_store/sources.json`

Deleting a source via the UI removes both its metadata and all associated vectors.
