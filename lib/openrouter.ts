import type { ComparisonResult, Confidence, IndependentPrediction, Probabilities } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-v4-flash-0731";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SourceCitation {
  url: string;
  title: string;
}

interface Completion {
  content: string;
  sources: SourceCitation[];
  finishReason: string | null;
}

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 120_000;

class RetryableError extends Error {}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;

  if (typeof m.content === "string" && m.content.trim()) return m.content;

  // Some providers return content as an array of parts rather than a plain string.
  if (Array.isArray(m.content)) {
    const joined = m.content
      .map((part) =>
        typeof part === "string" ? part : ((part as Record<string, unknown>)?.text as string) ?? ""
      )
      .join("")
      .trim();
    if (joined) return joined;
  }

  // Reasoning models sometimes leave `content` empty and put the answer in `reasoning`.
  if (typeof m.reasoning === "string" && m.reasoning.trim()) return m.reasoning;

  return "";
}

function messageSources(message: unknown): SourceCitation[] {
  if (!message || typeof message !== "object") return [];
  const annotations = (message as Record<string, unknown>).annotations;
  if (!Array.isArray(annotations)) return [];

  const sources: SourceCitation[] = [];
  for (const raw of annotations) {
    const citation = (raw as Record<string, unknown>)?.url_citation as
      | Record<string, unknown>
      | undefined;
    const url = typeof citation?.url === "string" ? citation.url : null;
    if (!url) continue;
    const title = typeof citation?.title === "string" && citation.title ? citation.title : url;
    if (!sources.some((s) => s.url === url)) sources.push({ url, title });
  }
  return sources.slice(0, 10);
}

async function callOpenRouter(
  messages: ChatMessage[],
  online: boolean,
  maxTokens: number
): Promise<Completion> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Add it to your environment to enable AI analysis."
    );
  }

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://betintelligence.app",
        "X-Title": "BetIntelligence",
      },
      body: JSON.stringify({
        model: online ? `${MODEL}:online` : MODEL,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RetryableError(
      `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = `${res.status} ${body.slice(0, 300)}`;
    // Rate limits and provider hiccups are worth another go; auth/quota problems are not.
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(`OpenRouter is busy (${detail})`);
    }
    throw new Error(`OpenRouter request failed (${detail})`);
  }

  const data = await res.json().catch(() => null);

  // OpenRouter can return HTTP 200 with an error payload instead of a completion.
  const errorPayload = (data as Record<string, unknown>)?.error;
  if (errorPayload) {
    const message =
      typeof errorPayload === "object" && errorPayload !== null
        ? String((errorPayload as Record<string, unknown>).message ?? JSON.stringify(errorPayload))
        : String(errorPayload);
    throw new RetryableError(`OpenRouter error: ${message.slice(0, 300)}`);
  }

  const choice = (data as Record<string, unknown>)?.choices;
  const first = Array.isArray(choice) ? (choice[0] as Record<string, unknown>) : undefined;
  const message = first?.message;
  const finishReason = typeof first?.finish_reason === "string" ? first.finish_reason : null;
  const content = messageText(message);

  if (!content) {
    // Reasoning models can burn the whole budget before emitting an answer.
    if (finishReason === "length") {
      throw new RetryableError(
        "The model hit its output limit before answering. Retrying with a shorter brief."
      );
    }
    throw new RetryableError("OpenRouter returned an empty response.");
  }

  return { content, sources: messageSources(message), finishReason };
}

function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not find JSON in AI response.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

const NUDGE =
  "Your previous reply could not be parsed. Reply with ONLY the raw JSON object described — " +
  "no markdown fences, no preamble, no commentary, and keep it short.";

// Retries cover the flaky parts: transient provider errors, empty replies, and replies that
// aren't parseable JSON. On a parse failure the model is nudged to answer in the right shape.
// Exported so other analysis flows (e.g. lib/openrouterMarkets.ts, for the Discover feed's
// general-market analysis) can reuse this hardened request/retry/parse loop rather than
// duplicating it.
export async function requestJson<T>(
  messages: ChatMessage[],
  online: boolean,
  maxTokens: number
): Promise<{ parsed: T; sources: SourceCitation[] }> {
  let lastError: Error | null = null;
  let attemptMessages = messages;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await callOpenRouter(attemptMessages, online, maxTokens);
      try {
        return { parsed: extractJson<T>(completion.content), sources: completion.sources };
      } catch (parseError) {
        lastError = parseError instanceof Error ? parseError : new Error(String(parseError));
        attemptMessages = [
          ...messages,
          { role: "assistant", content: completion.content.slice(0, 2000) },
          { role: "user", content: NUDGE },
        ];
      }
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      lastError = err;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }

  throw new Error(
    `The AI model failed to return a usable answer after ${MAX_ATTEMPTS} attempts. ${lastError?.message ?? ""}`.trim()
  );
}

export function clampConfidence(value: unknown): Confidence {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function normalize(home: number, draw: number, away: number): Probabilities {
  const h = Number.isFinite(home) ? Math.max(home, 0) : 0;
  const d = Number.isFinite(draw) ? Math.max(draw, 0) : 0;
  const a = Number.isFinite(away) ? Math.max(away, 0) : 0;
  const sum = h + d + a;
  if (sum <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: h / sum, draw: d / sum, away: a / sum };
}

const PREDICT_SYSTEM_PROMPT = `You are an elite football (soccer) analyst working for BetIntelligence, an AI odds-intelligence app. \
You independently assess matches using real football knowledge and, when available, current web information: recent form, \
lineups, injuries and suspensions, head-to-head record, table position and motivation, home/away splits, tactics, and news. \
You are NOT told any betting or prediction-market odds and must not guess or assume specific market prices. \
Think like a sharp, disciplined analyst — not a fan. Respond with ONLY a single valid JSON object, no markdown, no commentary, \
matching exactly this shape: {"homeWinProb": number, "drawProb": number, "awayWinProb": number, "confidence": "low"|"medium"|"high", \
"keyFactors": string[3..6], "rationale": string}. The three probabilities must be between 0 and 1 and sum to approximately 1.`;

export async function getIndependentPrediction(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  startTime: string;
}): Promise<IndependentPrediction> {
  const matchDate = new Date(input.startTime).toUTCString();
  const userPrompt = `Analyze the upcoming ${input.leagueName} match: ${input.homeTeam} (home) vs ${input.awayTeam} (away), \
kicking off ${matchDate}. Research both teams' current form, squad news, injuries/suspensions, key players, and head-to-head \
history, then give your own independent estimate of the 1X2 outcome probabilities. Respond with only the JSON object described.`;

  const { parsed, sources } = await requestJson<{
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    confidence: string;
    keyFactors: string[];
    rationale: string;
  }>(
    [
      { role: "system", content: PREDICT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    true,
    3000
  );

  const probs = normalize(parsed.homeWinProb, parsed.drawProb, parsed.awayWinProb);

  return {
    home: probs.home,
    draw: probs.draw,
    away: probs.away,
    confidence: clampConfidence(parsed.confidence),
    keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors.slice(0, 6) : [],
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    sources,
  };
}

const COMPARE_SYSTEM_PROMPT = `You are the same elite football analyst from BetIntelligence, continuing your analysis of a single match. \
You previously produced an independent 1X2 probability estimate WITHOUT seeing the betting market. You are now being shown the real \
Polymarket prediction-market implied probabilities for the same match for the first time. Compare your independent view against the \
market, reason about where and why you might disagree (market overreacting to news, public bias toward big clubs, your own analysis \
possibly missing something, etc), and decide if the market looks mispriced anywhere. Respond with ONLY a single valid JSON object, no \
markdown, no commentary, matching exactly this shape: {"homeEdge": number, "drawEdge": number, "awayEdge": number, \
"bestValue": "home"|"draw"|"away"|"none", "confidence": "low"|"medium"|"high", "agreesWithMarket": boolean, "verdict": string}. \
Edges are (your probability - market probability) expressed as a decimal, e.g. 0.08 means you think that outcome is 8 percentage \
points more likely than the market does. Only pick a bestValue other than "none" when the edge is meaningful (roughly 5 points or \
more) and you have real conviction; otherwise use "none". The verdict should be 2-4 sentences explaining your final read.`;

export async function compareToMarket(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  independent: IndependentPrediction;
  market: Probabilities;
}): Promise<ComparisonResult> {
  const userPrompt = `Match: ${input.homeTeam} vs ${input.awayTeam} (${input.leagueName}).

Your independent estimate (made before seeing the market):
- Home win: ${(input.independent.home * 100).toFixed(1)}%
- Draw: ${(input.independent.draw * 100).toFixed(1)}%
- Away win: ${(input.independent.away * 100).toFixed(1)}%
- Your confidence: ${input.independent.confidence}
- Your rationale: ${input.independent.rationale}

Now revealed — Polymarket's current implied probabilities for this exact match:
- Home win: ${(input.market.home * 100).toFixed(1)}%
- Draw: ${(input.market.draw * 100).toFixed(1)}%
- Away win: ${(input.market.away * 100).toFixed(1)}%

Compare your view to the market and respond with only the JSON object described.`;

  const { parsed } = await requestJson<{
    homeEdge: number;
    drawEdge: number;
    awayEdge: number;
    bestValue: string;
    confidence: string;
    agreesWithMarket: boolean;
    verdict: string;
  }>(
    [
      { role: "system", content: COMPARE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    false,
    2000
  );

  const bestValue =
    parsed.bestValue === "home" || parsed.bestValue === "draw" || parsed.bestValue === "away"
      ? parsed.bestValue
      : "none";

  return {
    edges: {
      home: Number.isFinite(parsed.homeEdge) ? parsed.homeEdge : 0,
      draw: Number.isFinite(parsed.drawEdge) ? parsed.drawEdge : 0,
      away: Number.isFinite(parsed.awayEdge) ? parsed.awayEdge : 0,
    },
    bestValue,
    confidence: clampConfidence(parsed.confidence),
    agreesWithMarket: Boolean(parsed.agreesWithMarket),
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
  };
}
