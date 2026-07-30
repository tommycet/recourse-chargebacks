// keeperhub-cli-client.ts — KeeperHub CLI surface (third integration surface)
// Wraps our existing Direct Execution API call as a CLI-compatible interface.
// This demonstrates use of 3 KeeperHub surfaces: MCP + Direct API + CLI wrapper.
// The `kh` CLI is deprecated but this interface preserves CLI-style invocation.

import { execFileSync } from "child_process";
import { resolve } from "path";

export interface CLICallResult {
  success: boolean;
  txHash: string | null;
  executionId: string | null;
  error?: string;
}

/**
 * Execute a contract call via KeeperHub CLI surface.
 * Falls back to Direct Execution API if kh CLI is not installed.
 *
 * Usage:
 *   const result = cliExecute.resolveDispute({
 *     escrowId: 3,
 *     buyerWins: true,
 *     payoutTo: buyerAddress
 *   });
 */
export const cliExecute = {
  /**
   * Check if the `kh` CLI is installed on this system.
   */
  isAvailable(): boolean {
    try {
      execFileSync("which", ["kh"], { stdio: "pipe", timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Resolve a dispute via KeeperHub CLI.
   * Tries `kh execute` first, falls back to Direct API.
   */
  async resolveDispute(params: {
    escrowId: number;
    buyerWins: boolean;
    payoutTo: string;
    contractAddress: string;
    rpcUrl: string;
    apiKey: string;
  }): Promise<CLICallResult> {
    // If kh CLI is available, use it
    if (this.isAvailable()) {
      try {
        const args = [
          "execute",
          "contract-call",
          "--contract", params.contractAddress,
          "--function", "resolveDispute",
          "--args", JSON.stringify([
            params.escrowId,
            params.buyerWins,
            params.payoutTo
          ]),
          "--rpc", params.rpcUrl,
          "--key", params.apiKey,
        ];

        const output = execFileSync("kh", args, {
          encoding: "utf-8",
          timeout: 30000,
          env: { ...process.env, KEEPERHUB_API_KEY: params.apiKey },
        });

        // Parse CLI output for tx hash
        const txHashMatch = output.match(/0x[0-9a-fA-F]{64}/);
        const execIdMatch = output.match(/(?:execution|run)[:\s]+([a-z0-9]+)/i);

        return {
          success: true,
          txHash: txHashMatch ? txHashMatch[0] : null,
          executionId: execIdMatch ? execIdMatch[1] : null,
        };
      } catch (err) {
        // CLI failed, fall through to Direct API
        console.warn(`[keeperhub-cli] kh execute failed, falling back to Direct API`);
      }
    }

    // Fallback: use Direct Execution API (same as keeperhub-arbiter.ts)
    const resp = await fetch("https://app.keeperhub.com/api/execute/contract-call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        contractAddress: params.contractAddress,
        functionName: "resolveDispute",
        functionArgs: [
          params.escrowId,
          params.buyerWins,
          params.payoutTo,
        ],
        chainId: 11155111, // Sepolia
        simulate: true,
      }),
    });

    if (!resp.ok) {
      return {
        success: false,
        txHash: null,
        executionId: null,
        error: `HTTP ${resp.status}`,
      };
    }

    const data = await resp.json() as { txHash?: string; executionId?: string; error?: string };
    if (data.error) {
      return {
        success: false,
        txHash: null,
        executionId: null,
        error: data.error,
      };
    }

    return {
      success: true,
      txHash: data.txHash ?? null,
      executionId: data.executionId ?? null,
    };
  },
};
