// agent/src/arbiter-llm.ts — LLM-powered dispute resolution with rule-based fallback
// Part of Recourse: Chargebacks for the Machine Economy
// Providers (priority order): Groq (llama-3.3-70b) → OpenRouter (DeepSeek) → rule-based fallback.

export interface SimpleBundle {
  version: number;
  taskId: string;
  buyerAddr: string;
  sellerAddr: string;
  amount: string;
  requestHash: string;
  responseHash: string;
  deliveryStatus: "delivered" | "failed" | "partial" | "none";
  timestamp: number;
}

export interface EscrowContext {
  escrowId: number;
  status: string;
  createdAt: number;
  disputedAt: number | null;
}

export interface Verdict {
  buyerWins: boolean;
  confidence: number; // 0..1
  reasoning: string;
  source: "llm" | "fallback";
}

// --- LLM Provider Configuration ---
// Two providers: Groq (fast inference) and OpenRouter (DeepSeek fallback).
// Priority: GROQ_API_KEY → OPENROUTER_API_KEY → rule-based fallback.
// Override models via GROQ_MODEL / OPENROUTER_MODEL env vars.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";

interface ProviderConfig {
  url: string;
  model: string;
  apiKey: string;
  name: string;
}

function selectProvider(): ProviderConfig | null {
  // Priority 1: Groq
  if (process.env.GROQ_API_KEY) {
    return {
      url: GROQ_URL,
      model: GROQ_MODEL,
      apiKey: process.env.GROQ_API_KEY,
      name: "groq",
    };
  }
  // Priority 2: OpenRouter (DeepSeek)
  if (process.env.OPENROUTER_API_KEY) {
    return {
      url: OPENROUTER_URL,
      model: OPENROUTER_MODEL,
      apiKey: process.env.OPENROUTER_API_KEY,
      name: "openrouter",
    };
  }
  return null;
}

function buildPrompt(bundle: SimpleBundle, escrow: EscrowContext) {
  return [
    {
      role: "system",
      content:
        "You are a Recourse arbiter agent for a blockchain-based agent payment escrow system. " +
        "You analyze cryptographic evidence bundles to decide whether a buyer should receive a refund. " +
        "Respond ONLY with compact JSON: {\"buyerWins\":boolean,\"confidence\":number,\"reasoning\":\"string\"}",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Decide if buyer should get a refund based on the evidence bundle and escrow state.",
        bundle: {
          deliveryStatus: bundle.deliveryStatus,
          requestHash: bundle.requestHash,
          responseHash: bundle.responseHash,
          amount: bundle.amount,
          taskId: bundle.taskId,
        },
        escrow: {
          escrowId: escrow.escrowId,
          status: escrow.status,
          disputed: escrow.disputedAt !== null,
        },
        rules: [
          "If deliveryStatus is 'failed' or 'none', buyer wins (refund).",
          "If deliveryStatus is 'delivered' and requestHash matches responseHash, seller wins (payout).",
          "If deliveryStatus is 'partial', use judgment based on evidence.",
        ],
      }),
    },
  ];
}

export async function analyzeDispute(
  bundle: SimpleBundle,
  escrow: EscrowContext,
): Promise<Verdict> {
  const prompt = buildPrompt(bundle, escrow);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const provider = selectProvider();
    if (!provider) {
      throw new Error("No LLM provider configured (set GROQ_API_KEY or OPENROUTER_API_KEY)");
    }

    const res = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`,
        ...(provider.name === "openrouter" ? { "HTTP-Referer": "https://recourse.dev", "X-Title": "Recourse" } : {}),
      },
      body: JSON.stringify({ model: provider.model, messages: prompt, max_tokens: 200 }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${provider.name} returned ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";

    // Robust JSON extraction: strip code fences, greedy brace match
    const cleaned = text.replace(/```(?:json)?\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        buyerWins: Boolean(parsed.buyerWins),
        confidence: Math.min(1, Math.max(0, typeof parsed.confidence === "number" ? parsed.confidence : 0.8)),
        reasoning: parsed.reasoning || "LLM analysis complete",
        source: "llm",
      };
    }

    throw new Error("Could not parse LLM response");
  } catch (err) {
    // Rule-based fallback
    const buyerWins =
      bundle.deliveryStatus === "failed" || bundle.deliveryStatus === "none";
    const errMsg = err instanceof Error ? err.message : (err as any)?.name || "unknown";
    return {
      buyerWins,
      confidence: 0.5,
      reasoning: `Rule-based fallback (LLM unavailable: ${errMsg}): deliveryStatus=${bundle.deliveryStatus} → ${buyerWins ? "buyer wins (refund)" : "seller wins (payout)"}`,
      source: "fallback",
    };
  } finally {
    clearTimeout(timeout);
  }
}
