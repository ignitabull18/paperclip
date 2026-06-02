import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, asNumber, parseObject } from "../utils.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context } = ctx;
  const url = asString(config.url, "");
  if (!url) throw new Error("HTTP adapter missing url");

  const method = asString(config.method, "POST");
  const timeoutMs = asNumber(config.timeoutMs, 0);
  const headers = parseObject(config.headers) as Record<string, string>;
  const payloadTemplate = parseObject(config.payloadTemplate);
  const body = { ...payloadTemplate, agentId: agent.id, runId, context };

  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      ...(timer ? { signal: controller.signal } : {}),
    });

    const responseText = await res.text();
    const boundedResponseText = responseText.slice(0, 60_000);
    let responseJson: unknown = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }

    if (!res.ok) {
      return {
        exitCode: res.status,
        signal: null,
        timedOut: false,
        errorMessage: `HTTP invoke failed with status ${res.status}`,
        errorCode: "http_status",
        resultJson: {
          httpStatus: res.status,
          responseText: boundedResponseText,
          responseJson,
        },
        summary: `HTTP ${method} ${url} failed with status ${res.status}`,
      };
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: {
        httpStatus: res.status,
        responseText: boundedResponseText,
        responseJson,
      },
      summary: `HTTP ${method} ${url} completed with status ${res.status}`,
    };
  } catch (err) {
    if (timer && err instanceof Error && err.name === "AbortError") {
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: `HTTP ${method} ${url} timed out after ${timeoutMs}ms`,
        errorCode: "timeout",
      };
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
