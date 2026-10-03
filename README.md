# SmartRAG – Cost-Aware RAG Assistant

FastAPI + SQLite backend, Three.js/Chart.js glassmorphism frontend (served by the same server, no build step).

## Run (Windows / macOS / Linux)
```bash
cd backend
python -m venv venv && venv\Scripts\activate      # Linux/mac: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env                            # Linux/mac: cp .env.example .env
uvicorn main:app --reload --port 8000
```
Open http://localhost:8000 → Register → Documents → upload `sample_docs/acme_cloud_policy.txt` → AI Chat.
XAMPP/PHP is **not required**; Python serves both API and UI.

## Modes
* **Offline (default, no keys):** local hashing embeddings + extractive answers with citations. Costs are *estimated* from token counts at the configured prices.
* **Real LLM:** set `LLM_API_KEY` (+ `LLM_BASE_URL`, `CHEAP_MODEL`, `STRONG_MODEL`) in `.env` – any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Ollama `http://localhost:11434/v1`). Token counts then come from the API's `usage`.
* **Real embeddings:** set `EMBED_API_KEY`, `EMBED_BASE_URL`, `EMBED_MODEL`. Re-upload documents after switching embedding provider.

## How it works
1. Upload → text extraction (pypdf) → 160-word overlapping chunks → embeddings → stored in SQLite (NumPy cosine search; swap in FAISS/Chroma in `chat()` if desired).
2. Query → embed → **semantic cache** lookup (cosine ≥ threshold, per user). Hit = no LLM call, original cost counted as saved.
3. Miss → top-k retrieval → **complexity router** (length, reasoning keywords, multi-part) → cheap or strong model → cached + logged (tokens, latency, cost).
4. Dashboard/Analytics read real aggregates from `queries`. Cache is auto-invalidated when documents change.

Try: ask "What is the Pro plan price?" twice (second = cache hit), then "Compare the support policies and explain which plan is best" (routes to strong model). Tune thresholds in Settings.

## Frontend (React + TypeScript + Tailwind + React Three Fiber)
`frontend-react/` is the main UI (Recharts charts, R3F 3D background). A **prebuilt `dist/`** is included, so the backend serves it automatically – no Node needed to run.
To modify it:
```bash
cd frontend-react && npm install
npm run dev      # http://localhost:5173 (proxies /api to :8000)
npm run build    # refresh dist/ for the backend
```
If `frontend-react/dist` is missing, the backend falls back to the plain-JS UI in `frontend/`.
