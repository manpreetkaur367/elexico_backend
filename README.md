# ElexicoAI Backend

Express + TypeScript backend that proxies all Gemini AI calls for the ElexicoAI frontend. The API key is kept **server-side only** — never exposed to the browser.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| POST | `/api/chat` | AI chat reply for a slide question |
| POST | `/api/summary` | AI-generated summary + key points |
| POST | `/api/polish-sentence` | Polish a raw sentence for TTS |

### POST `/api/chat`
```json
{ "question": "What is a REST API?", "slideTitle": "APIs" }
```
Response:
```json
{ "reply": "A REST API is a contract that lets apps talk using HTTP..." }
```

### POST `/api/summary`
```json
{
  "slideTitle": "APIs",
  "slideDescription": "An API is a contract between systems...",
  "slideKeyPoints": ["REST uses HTTP verbs", "Secured with JWT tokens"]
}
```
Response:
```json
{
  "description": "APIs are like menus letting apps order what they need.",
  "keyPoints": ["Define request and response format", "Secured with tokens", "REST uses HTTP verbs", "GraphQL fetches exact data"]
}
```

### POST `/api/polish-sentence`
```json
{ "sentence": "Backend handles logic.", "slideTitle": "Introduction to Backend" }
```
Response:
```json
{ "polished": "The backend quietly handles all the logic behind every app." }
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Create .env
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# 3. Run dev server
npm run dev
# → http://localhost:4000
```

---

## Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo `manpreetkaur367/elexico_backend`
4. Set these in Render dashboard:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `GEMINI_API_KEY` = your key
     - `FRONTEND_URL` = your frontend URL (e.g. `https://elexico.vercel.app`)
5. Click **Deploy**

Render will give you a URL like `https://elexico-backend.onrender.com` — set this as `VITE_BACKEND_URL` in your frontend `.env`.
