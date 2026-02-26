import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "2mb" }));

// ── Gemini config ───────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODELS = [
  "gemma-3-4b-it",
  "gemma-3-1b-it",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
];

function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

interface GeminiRequest {
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

// ── Gemini proxy helper — tries all models in order ──────────────────────────
async function callGemini(
  prompt: string,
  temperature = 0.7,
  maxOutputTokens = 300
): Promise<string> {
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(geminiUrl(model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens },
        }),
      });

      if (res.status === 429 || res.status === 403) {
        console.warn(`[Gemini] Model ${model} quota/permission error (${res.status}), trying next…`);
        continue;
      }
      if (!res.ok) {
        console.warn(`[Gemini] Model ${model} returned ${res.status}, trying next…`);
        continue;
      }

      const data = await res.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { code: number; message: string };
      };

      if (data.error?.code === 429 || data.error?.code === 403) {
        console.warn(`[Gemini] Model ${model} error in body: ${data.error.message}`);
        continue;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        console.log(`[Gemini] Success with model: ${model}`);
        return text;
      }
    } catch (err) {
      console.error(`[Gemini] Model ${model} fetch failed:`, err);
      continue;
    }
  }
  throw new Error("All Gemini models are currently unavailable. Please try again later.");
}

// ────────────────────────────────────────────────────────────────────────────
// ROUTES
// ────────────────────────────────────────────────────────────────────────────

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "ElexicoAI Backend",
    version: "1.0.0",
    endpoints: [
      "POST /api/chat",
      "POST /api/summary",
      "POST /api/polish-sentence",
    ],
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// ── POST /api/chat ───────────────────────────────────────────────────────────
// Body: { question: string, slideTitle: string }
// Returns: { reply: string }
app.post("/api/chat", async (req: Request, res: Response): Promise<void> => {
  const { question, slideTitle } = req.body as { question?: string; slideTitle?: string };

  if (!question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const prompt = `You are ElexicoAI, a warm and polite AI assistant inside a learning app, speaking in a courteous Indian English teacher tone.

STRICT RULES:
1. Answer in 2-3 short, simple sentences ONLY. Never more.
2. Use polite, encouraging language — like a kind teacher (e.g. "That is a great question.", "Let me explain that simply.", "Do note that…").
3. Answer ANY question — backend, general knowledge, science, math, history, anything.
4. Never use bullet points, lists, or headers. Just plain sentences.
5. Never say you can't answer or that something is out of scope.

Current slide (context only): "${slideTitle || "Backend Engineering"}"

Question: ${question}

Answer in 2-3 polite sentences:`;

  try {
    const reply = await callGemini(prompt, 0.5, 150);
    res.json({ reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI unavailable";
    res.status(503).json({ error: msg });
  }
});

// ── POST /api/summary ────────────────────────────────────────────────────────
// Body: { slideTitle: string, slideDescription: string, slideKeyPoints: string[] }
// Returns: { description: string, keyPoints: string[] }
app.post("/api/summary", async (req: Request, res: Response): Promise<void> => {
  const { slideTitle, slideDescription, slideKeyPoints } = req.body as {
    slideTitle?: string;
    slideDescription?: string;
    slideKeyPoints?: string[];
  };

  if (!slideTitle) {
    res.status(400).json({ error: "slideTitle is required" });
    return;
  }

  const avoidPoints = Array.isArray(slideKeyPoints) ? slideKeyPoints.join(" | ") : "";

  const prompt = `You are ElexicoAI. Topic: "${slideTitle}".

RULES:
- Do NOT copy or reuse any wording from the slide text below.
- "description": exactly 1 sentence, max 12 words, use a simple analogy.
- "keyPoints": exactly 4 items, each max 6 words, start with a verb, no full stops.

Slide text to AVOID: "${slideDescription || ""}" | ${avoidPoints}

Return ONLY valid JSON, no markdown, no extra text:
{"description":"...","keyPoints":["...","...","...","..."]}`;

  try {
    const raw = await callGemini(prompt, 0.7, 200);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const parsed = JSON.parse(jsonMatch[0]) as { description?: string; keyPoints?: string[] };
    if (!parsed.description || !Array.isArray(parsed.keyPoints)) {
      throw new Error("Invalid response structure");
    }

    // Post-process: trim to word limits
    const description = parsed.description.split(/[.!?]/)[0].trim().replace(/,\s*$/, "") + ".";
    const keyPoints = parsed.keyPoints.slice(0, 4).map((kp: string) =>
      kp.split(" ").slice(0, 7).join(" ").replace(/[.,]+$/, "")
    );

    res.json({ description, keyPoints });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI unavailable";
    res.status(503).json({ error: msg });
  }
});

// ── POST /api/polish-sentence ────────────────────────────────────────────────
// Body: { sentence: string, slideTitle: string, temperature?: number }
// Returns: { polished: string }
app.post("/api/polish-sentence", async (req: Request, res: Response): Promise<void> => {
  const { sentence, slideTitle, temperature } = req.body as {
    sentence?: string;
    slideTitle?: string;
    temperature?: number;
  };

  if (!sentence?.trim()) {
    res.status(400).json({ error: "sentence is required" });
    return;
  }

  const prompt = `You are a polite, friendly Indian English narrator for an educational app.

Rewrite this one sentence about "${slideTitle || "backend engineering"}" so it sounds warm, courteous, and natural when spoken aloud in a gentle Indian English accent.

RULES:
- Use polite, encouraging language (e.g. "Let us", "We can see that", "Do note that", "It is worth mentioning").
- Write in a calm, teacher-like tone — as if explaining to a student with care.
- Output ONLY the rewritten sentence — no extra words, no numbering, no quotes.

Original: ${sentence}

Rewritten:`;

  try {
    const raw = await callGemini(prompt, temperature ?? 0.5, 120);
    const polished = raw.split("\n")[0].trim() || sentence;
    res.json({ polished });
  } catch (err) {
    // Graceful fallback — return original sentence
    res.json({ polished: sentence });
  }
});

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server Error]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ElexicoAI backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Gemini key: ${GEMINI_API_KEY ? "✅ loaded" : "❌ MISSING"}\n`);
});
