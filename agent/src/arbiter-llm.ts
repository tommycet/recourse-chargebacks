// agent/src/arbiter-llm.ts — LLM-powered dispute resolution with rule-based fallback
// Part of Recourse: Chargebacks for the Machine Economy
// Uses OpenRouter (deepseek/deepseek-chat) for evidence analysis; falls back to rules on failure.

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
  confidence: number;
  reasoning: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat";

export async function analyzeDispute(
  bundle: SimpleBundle,
  escrow: EscrowContext,
): Promise<Verdict> {
  const prompt = [
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, messages: prompt, max_tokens: 200 }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`OpenRouter returned ${res.status}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";

    // Extract JSON from the response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        buyerWins: Boolean(parsed.buyerWins),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
        reasoning: parsed.reasoning || "LLM analysis complete",
      };
    }

    throw new Error("Could not parse LLM response");
  } catch (err) {
    // Rule-based fallback
    const buyerWins =
      bundle.deliveryStatus === "failed" || bundle.deliveryStatus === "none";
    return {
      buyerWins,
      confidence: 0.9,
      reasoning: `Rule-based fallback (LLM unavailable: ${err instanceof Error ? err.message : "unknown"}): deliveryStatus=${bundle.deliveryStatus} → ${buyerWins ? "buyer wins (refund)" : "seller wins (payout)"}`,
    };
  }
}
