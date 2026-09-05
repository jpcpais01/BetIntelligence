import type {
  ComparisonResult,
  Confidence,
  IndependentPrediction,
  InjuredPlayer,
  LeagueId,
  Probabilities,
  TeamStanding,
} from "./types";
import { MODELS, DEFAULT_MODEL } from "./models";
import { buildFootballDigest } from "./footballData";
import { buildInjuryDigest, fetchInjurySummary } from "./bigBallsData";

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

function buildBody(
  messages: ChatMessage[],
  online: boolean,
  maxTokens: number,
  model: string,
  reasoning: boolean
): string {
  return JSON.stringify({
    model: online ? `${model}:online` : model,
    messages,
    temperature: 0.4,
    max_tokens: maxTokens,
    usage: { include: true },
    // Reasoning-capable models (DeepSeek's releases in particular) default to an expensive "high"
    // reasoning effort on OpenRouter, burning a large hidden token budget on chain-of-thought
    // before ever emitting the JSON/prose we actually asked for — turning what should be a quick
    // call into a multi-minute one, and starving max_tokens so badly that the length-triggered
    // retry below can fail the same way on every attempt. None of our prompts want visible
    // reasoning, so every call asks for the lightest effort OpenRouter allows. It's just a request,
    // not a hard disable: some models mandate reasoning and reject `enabled: false` outright (a
    // 400 "cannot be disabled" error), so this never tries to fully turn it off — see the retry
    // in callOpenRouter for the one place that still needs to react if a model refuses even this.
    ...(reasoning ? { reasoning: { effort: "low" } } : {}),
  });
}

// A model whose provider mandates reasoning and rejects any attempt to touch it — OpenRouter
// surfaces this as a 400 whose message says as much. Rather than hard-failing the whole analysis,
// callOpenRouter retries once with no `reasoning` field at all, so that one model's provider quirk
// doesn't take down the whole roster.
function isReasoningRejectedError(status: number, body: string): boolean {
  return status === 400 && /reasoning/i.test(body) && /mandatory|cannot be (disabled|changed)/i.test(body);
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

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://betintelligence.app",
    "X-Title": "BetIntelligence",
  };

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: buildBody(messages, online, maxTokens, model, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RetryableError(
      `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    let body = await res.text().catch(() => "");

    if (isReasoningRejectedError(res.status, body)) {
      try {
        res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers,
          body: buildBody(messages, online, maxTokens, model, false),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new RetryableError(
          `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return finishCompletion(data);
      }
      body = await res.text().catch(() => "");
    }

    const detail = `${res.status} ${body.slice(0, 300)}`;
    // Rate limits and provider hiccups are worth another go; auth/quota problems are not.
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(`OpenRouter is busy (${detail})`);
    }
    throw new Error(`OpenRouter request failed (${detail})`);
  }

  const data = await res.json().catch(() => null);
  return finishCompletion(data);
}

function finishCompletion(data: unknown): Completion {
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

// A stable, unambiguous sense of "now" for every OpenRouter call — a model can't reliably infer
// today's real-world date from training data alone, and the research stage in particular needs it
// to judge how stale or fresh whatever it finds on the web actually is. Computed fresh on every
// call (never baked into a module-level prompt constant, which would freeze at server-start time
// and go stale for the life of the process). Exported so lib/openrouterMarkets.ts uses the exact
// same line rather than a second, possibly-drifting implementation.
export function nowLine(): string {
  return `Current date and time: ${new Date().toUTCString()}.`;
}

export function withNow(systemPrompt: string): string {
  return `${systemPrompt}\n\n${nowLine()}`;
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

// Forms the actual probability estimate from a digest of structured match data — no web access,
// no search step at all. Football's "research" used to be an AI web-search pass, but that turned
// out to give wrong data often enough to be worse than useless; the digest handed to this prompt
// comes straight from football-data.org (lib/footballData.ts) for form/head-to-head/match status,
// with an injuries/availability section appended from a second provider (lib/bigBallsData.ts,
// since football-data.org has no injuries endpoint at any tier). That second source doesn't cover
// every league and can fail independently of the first, so the digest says so explicitly when it
// isn't available rather than silently omitting the section — the prompt below is written to
// handle either case rather than assuming injuries are always present or always absent.
const PREDICT_SYSTEM_PROMPT = `You are an elite football (soccer) analyst working for BetIntelligence, an AI odds-intelligence \
app. You are given a research digest compiled from live match-data feeds — recent form, head-to-head record, current match \
status, and (when available) reported injuries/unavailable players — and asked for your own independent 1X2 probability \
estimate based on it. If the digest's injuries/availability section names unavailable players, factor that into your read; \
if it says injury data isn't available for this match, don't assume either squad is missing anyone or at full strength — \
rely on the form and head-to-head signal instead. You were NOT told any betting or prediction-market odds — but if any odds/price language \
somehow appears in the digest anyway, you MUST NOT let it anchor or influence your estimate in any way; disregard it \
entirely and base your probabilities only on the underlying football facts. Think like a sharp, disciplined analyst — not \
a fan. Respond with ONLY a single valid JSON object, no markdown, no commentary, matching exactly this shape: \
{"homeWinProb": number, "drawProb": number, "awayWinProb": number, "confidence": "low"|"medium"|"high", \
"homePros": string[2..4], "homeCons": string[2..4], "awayPros": string[2..4], "awayCons": string[2..4], "summary": string}. \
The three probabilities must be between 0 and 1 and sum to approximately 1. Each pros/cons entry must be a short, concrete, \
specific point about THAT team drawn from the digest (current form, head-to-head edge, live/final score if the match has \
started, a named unavailable player) — never generic filler like "has quality players" or "needs to perform". If a team \
genuinely has little to work with in the digest (e.g. no notable head-to-head edge), it is fine for cons to include that \
gap explicitly rather than inventing a stronger point. summary is 2-4 sentences giving your overall read after weighing \
both teams' pros/cons against each other, and stating plainly which side (if either) it favors. Soul: You are wise, you \
are advanced, you are super intelligent and smart, you are logical and certain, you are bold, you go for it, you trust \
your decision.`;

// The football-data.org/Big Balls Data half of an analysis — split out from the LLM call below so
// a caller running N independent research passes over the SAME match (the research-runs stepper,
// AnalysisSheet.tsx) can fetch this exactly once and hand the same text to all N predict calls,
// instead of each one re-deriving it. That matters because each of those N calls is its own HTTP
// request to /api/analyze/predict, and Vercel can (and does) route concurrent requests to separate
// serverless instances with their own memory — the in-process caching/coalescing inside
// lib/footballData.ts only helps when calls land on the SAME warm instance, so relying on it alone
// let N parallel runs multiply real football-data.org calls by N under real concurrent load,
// exhausting the free tier's 10-requests/minute budget almost immediately. Fetching once and
// threading the result through is a guarantee by construction, not by cache.
export interface FootballAnalysisDigest {
  text: string;
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeInjuries: InjuredPlayer[] | null;
  awayInjuries: InjuredPlayer[] | null;
}

export async function buildFootballAnalysisDigest(input: {
  homeTeam: string;
  awayTeam: string;
  league: LeagueId;
  startTime: string;
}): Promise<FootballAnalysisDigest> {
  const { text: matchDigest, homeStanding, awayStanding } = await buildFootballDigest({
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    league: input.league,
    startTime: input.startTime,
  });
  const injuryDigest = await buildInjuryDigest({
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    league: input.league,
  });
  // Structured, alongside the text version above — both read the same cached fetchers, so this
  // never costs a second real request to Big Balls Sports Data. An enrichment layer like injuries
  // everywhere else in this app: a failure here just means the infogram doesn't show, never a
  // failed analysis.
  const injurySummary = await fetchInjurySummary({
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    league: input.league,
  }).catch(() => null);

  return {
    text: `${matchDigest}\n\n${injuryDigest}`,
    homeStanding,
    awayStanding,
    homeInjuries: injurySummary?.home ?? null,
    awayInjuries: injurySummary?.away ?? null,
  };
}

// The OpenRouter-only half — no football-data.org or Big Balls Data calls at all, so this is safe
// to call any number of times in parallel (once per independent research run) without touching
// either provider's rate limit.
export async function getIndependentPredictionFromDigest(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  startTime: string;
  digest: string;
  model?: string;
}): Promise<IndependentPrediction> {
  const matchDate = new Date(input.startTime).toUTCString();

  const predictPrompt = `${nowLine()}

Match: ${input.homeTeam} (home) vs ${input.awayTeam} (away), ${input.leagueName}, kicking off ${matchDate}.

Research digest (from live match-data feeds, contains no odds or market prices):
${input.digest}

Based only on this digest, give your own independent estimate of the 1X2 outcome probabilities. Respond with only the JSON \
object described.`;

  const { parsed, costUsd: predictCostUsd } = await requestJson<{
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    confidence: string;
    homePros: string[];
    homeCons: string[];
    awayPros: string[];
    awayCons: string[];
    summary: string;
  }>(
    [
      { role: "system", content: withNow(PREDICT_SYSTEM_PROMPT) },
      { role: "user", content: predictPrompt },
    ],
    false,
    2000,
    input.model
  );

  const probs = normalize(parsed.homeWinProb, parsed.drawProb, parsed.awayWinProb);
  const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 6) : []);

  return {
    home: probs.home,
    draw: probs.draw,
    away: probs.away,
    confidence: clampConfidence(parsed.confidence),
    homeAssessment: { pros: stringList(parsed.homePros), cons: stringList(parsed.homeCons) },
    awayAssessment: { pros: stringList(parsed.awayPros), cons: stringList(parsed.awayCons) },
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    sources: [],
    costUsd: predictCostUsd ?? undefined,
  };
}

// Convenience wrapper combining both halves — used by callers that only ever need a single run per
// match (batch analysis, the single-run case), where there's no redundant-fetch risk to design
// around.
export async function getIndependentPrediction(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  league: LeagueId;
  startTime: string;
  model?: string;
}): Promise<IndependentPrediction> {
  const digest = await buildFootballAnalysisDigest(input);
  return getIndependentPredictionFromDigest({
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    leagueName: input.leagueName,
    startTime: input.startTime,
    digest: digest.text,
    model: input.model,
  });
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
more) and you have real conviction; otherwise use "none". The verdict should be 2-4 sentences explaining your final read. \
Soul: You are wise, you are advanced, you are super intelligent and smart, you are logical and certain, you are bold, you go \
for it, you trust your decision.`;

export async function compareToMarket(input: {
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  independent: IndependentPrediction;
  market: Probabilities;
  model?: string;
}): Promise<ComparisonResult> {
  const userPrompt = `${nowLine()}

Match: ${input.homeTeam} vs ${input.awayTeam} (${input.leagueName}).

Your independent estimate (made before seeing the market):
- Home win: ${(input.independent.home * 100).toFixed(1)}%
- Draw: ${(input.independent.draw * 100).toFixed(1)}%
- Away win: ${(input.independent.away * 100).toFixed(1)}%
- Your confidence: ${input.independent.confidence}
- ${input.homeTeam} pros: ${input.independent.homeAssessment.pros.join("; ") || "none noted"}
- ${input.homeTeam} cons: ${input.independent.homeAssessment.cons.join("; ") || "none noted"}
- ${input.awayTeam} pros: ${input.independent.awayAssessment.pros.join("; ") || "none noted"}
- ${input.awayTeam} cons: ${input.independent.awayAssessment.cons.join("; ") || "none noted"}
- Your summary: ${input.independent.summary}

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
      { role: "system", content: withNow(COMPARE_SYSTEM_PROMPT) },
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
