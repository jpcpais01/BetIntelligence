import type { ComparisonResult, Confidence, IndependentPrediction, Probabilities } from "./types";
import { MODELS, DEFAULT_MODEL } from "./models";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  costUsd: number | null;
}

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 120_000;

// Carries cost when it's known — an attempt that gets retried (an empty reply, a truncated
// answer) can still have burned real tokens and money, so that cost shouldn't just vanish from
// the total because the attempt didn't produce a usable answer.
class RetryableError extends Error {
  costUsd: number | null;
  constructor(message: string, costUsd: number | null = null) {
    super(message);
    this.costUsd = costUsd;
  }
}

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

// OpenRouter only includes the dollar cost of a completion when asked to via `usage.include` in
// the request body; the field can come back as either a number or a numeric string depending on
// provider, so this is defensive about both and about it being entirely absent.
function usageCost(data: unknown): number | null {
  const usage = (data as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;
  const raw = usage?.cost;
  const cost = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(cost) ? cost : null;
}

async function callOpenRouter(
  messages: ChatMessage[],
  online: boolean,
  maxTokens: number,
  model: string
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
        model: online ? `${model}:online` : model,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
        usage: { include: true },
        // Reasoning-capable models (DeepSeek's releases in particular) default to an expensive
        // "high" reasoning effort on OpenRouter, burning a large hidden token budget on chain-of-
        // thought before ever emitting the JSON/prose we actually asked for — turning what should
        // be a quick call into a multi-minute one, and starving max_tokens so badly that the
        // length-triggered retry above can fail the same way on every attempt. None of our prompts
        // want visible reasoning, so it's switched off for every model, every call.
        reasoning: { enabled: false },
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
    throw new RetryableError(`OpenRouter error: ${message.slice(0, 300)}`, usageCost(data));
  }

  const choice = (data as Record<string, unknown>)?.choices;
  const first = Array.isArray(choice) ? (choice[0] as Record<string, unknown>) : undefined;
  const message = first?.message;
  const finishReason = typeof first?.finish_reason === "string" ? first.finish_reason : null;
  const content = messageText(message);

  if (!content) {
    const costSoFar = usageCost(data);
    // Reasoning models can burn the whole budget before emitting an answer.
    if (finishReason === "length") {
      throw new RetryableError(
        "The model hit its output limit before answering. Retrying with a shorter brief.",
        costSoFar
      );
    }
    throw new RetryableError("OpenRouter returned an empty response.", costSoFar);
  }

  return { content, sources: messageSources(message), finishReason, costUsd: usageCost(data) };
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
  maxTokens: number,
  model: string = MODELS[DEFAULT_MODEL].openrouterId
): Promise<{ parsed: T; sources: SourceCitation[]; costUsd: number | null }> {
  let lastError: Error | null = null;
  let attemptMessages = messages;
  // Every attempt that actually reached OpenRouter can have cost real money, whether or not it
  // produced a usable answer — this accumulates across retries rather than only keeping the
  // successful attempt's cost.
  let totalCost: number | null = null;
  const addCost = (cost: number | null) => {
    if (cost !== null) totalCost = (totalCost ?? 0) + cost;
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await callOpenRouter(attemptMessages, online, maxTokens, model);
      addCost(completion.costUsd);
      try {
        return { parsed: extractJson<T>(completion.content), sources: completion.sources, costUsd: totalCost };
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
      addCost(err.costUsd);
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

// Same retry loop as requestJson, minus the JSON-extraction step — for the research/organize
// stage of the two-stage independent-read pipeline (see getIndependentPrediction), whose output
// is free-form prose, not JSON. Exported so lib/openrouterMarkets.ts can reuse it too.
export async function requestText(
  messages: ChatMessage[],
  online: boolean,
  maxTokens: number,
  model: string = MODELS[DEFAULT_MODEL].openrouterId
): Promise<{ text: string; sources: SourceCitation[]; costUsd: number | null }> {
  let lastError: Error | null = null;
  let totalCost: number | null = null;
  const addCost = (cost: number | null) => {
    if (cost !== null) totalCost = (totalCost ?? 0) + cost;
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await callOpenRouter(messages, online, maxTokens, model);
      addCost(completion.costUsd);
      return { text: completion.content, sources: completion.sources, costUsd: totalCost };
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      addCost(err.costUsd);
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

// Stage 1 of the independent read: pure research and organization, nothing else. This is the
// only step with web access, so it's the only place odds could leak in — its whole job is to
// hand stage 2 a clean set of facts with zero trace of what anyone else thinks the odds are.
const RESEARCH_SYSTEM_PROMPT = `You are a football research assistant for BetIntelligence. Your ONLY job is to research the \
web for the given match and organize everything relevant to a statistical assessment into clear labeled sections: Form (recent \
results for both teams), Injuries & Suspensions, Key Players & Lineups, Head-to-Head History, Table Position & Motivation, \
Tactics, and Other News. Write plain prose or bullet points under each heading — no JSON, no odds talk. \
CRITICAL RULE: you must NEVER mention, quote, paraphrase, or allude to any betting odds, bookmaker lines, prediction-market \
prices (including Polymarket), implied win probabilities, or anyone else's numerical prediction, from any source, anywhere in \
your output — even in passing, even to say a source discussed them. If a source you read mentions odds, silently omit that part \
and report only the underlying facts (injuries, news, form) it was based on. Never write phrases like "bookmakers favor X" or \
"the market prices this at Y%". If a section has nothing notable, write "Nothing significant found" under it.`;

// Stage 2: forms the actual probability estimate. Deliberately has NO web access of its own —
// it only ever sees the digest stage 1 already produced, so even if some search result did
// mention odds, this step has no independent way to go looking for more.
const PREDICT_SYSTEM_PROMPT = `You are an elite football (soccer) analyst working for BetIntelligence, an AI odds-intelligence \
app. You are given a research digest compiled by a separate research step — recent form, lineups, injuries and suspensions, \
head-to-head record, table position and motivation, tactics, and news — and asked for your own independent 1X2 probability \
estimate based on it. You were NOT told any betting or prediction-market odds, and the digest was compiled specifically to \
exclude them — but if any odds/price language somehow appears in it anyway, you MUST NOT let it anchor or influence your \
estimate in any way; disregard it entirely and base your probabilities only on the underlying football facts. Think like a \
sharp, disciplined analyst — not a fan. Respond with ONLY a single valid JSON object, no markdown, no commentary, matching \
exactly this shape: {"homeWinProb": number, "drawProb": number, "awayWinProb": number, "confidence": "low"|"medium"|"high", \
"keyFactors": string[3..6], "rationale": string}. The three probabilities must be between 0 and 1 and sum to approximately 1.`;

const RESEARCH_MAX_TOKENS = 3000;

export async function getIndependentPrediction(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  startTime: string;
  model?: string;
}): Promise<IndependentPrediction> {
  const matchDate = new Date(input.startTime).toUTCString();

  const researchPrompt = `Research the upcoming ${input.leagueName} match: ${input.homeTeam} (home) vs ${input.awayTeam} \
(away), kicking off ${matchDate}. Compile a research digest covering both teams' current form, squad news, \
injuries/suspensions, key players, and head-to-head history, organized into the sections described. Remember: never mention \
odds, betting lines, or market/implied prices anywhere in your output.`;

  const { text: digest, sources, costUsd: researchCostUsd } = await requestText(
    [
      { role: "system", content: RESEARCH_SYSTEM_PROMPT },
      { role: "user", content: researchPrompt },
    ],
    true,
    RESEARCH_MAX_TOKENS,
    input.model
  );

  const predictPrompt = `Match: ${input.homeTeam} (home) vs ${input.awayTeam} (away), ${input.leagueName}, kicking off \
${matchDate}.

Research digest (compiled separately, contains no odds or market prices):
${digest}

Based only on this digest, give your own independent estimate of the 1X2 outcome probabilities. Respond with only the JSON \
object described.`;

  const { parsed, costUsd: predictCostUsd } = await requestJson<{
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    confidence: string;
    keyFactors: string[];
    rationale: string;
  }>(
    [
      { role: "system", content: PREDICT_SYSTEM_PROMPT },
      { role: "user", content: predictPrompt },
    ],
    false,
    2000,
    input.model
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
    costUsd: researchCostUsd !== null || predictCostUsd !== null ? (researchCostUsd ?? 0) + (predictCostUsd ?? 0) : undefined,
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
  model?: string;
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

  const { parsed, costUsd } = await requestJson<{
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
    2000,
    input.model
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
    costUsd: costUsd ?? undefined,
  };
}
