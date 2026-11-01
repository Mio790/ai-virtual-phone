import { buildChatCompletionsUrl, buildRequestHeaders, determineBaseUrl } from "./api-helpers";
import type { ApiConfig } from "./settings-types";
import type { IFPromptMessage } from "./if-theater";

/** Endpoint/provider configuration determines protocol, never the model's name. */
export function ifStreamEndpoint(config: ApiConfig): string {
  const base = determineBaseUrl(config).replace(/\/$/, "");
  if (!base) throw new Error("API 地址为空；未发起请求");
  const url = new URL(base);
  if (!/^https?:$/.test(url.protocol)) throw new Error("API 地址协议无效；未发起请求");
  const native = /(^|\.)api\.anthropic\.com$|(^|\.)generativelanguage\.googleapis\.com$/.test(url.hostname)
    || /\/(messages|v1beta)(\/|$)|:(streamGenerateContent|generateContent)/.test(url.pathname)
    || (!config.baseUrl && ["Anthropic", "Google"].includes(config.provider));
  if (native) throw new Error("IF流式暂不支持原生 Anthropic／Google 协议；请选择 OpenAI 兼容中转配置。未发起请求，不会自动重试");
  return buildChatCompletionsUrl(base);
}

/** One HTTP request, no retry/fallback, no plugins or modern-memory assembly. */
export async function streamIFReply(config: ApiConfig, messages: IFPromptMessage[], signal: AbortSignal, onDelta: (text: string) => void | Promise<void>, request: typeof fetch = fetch): Promise<string> {
  if (signal.aborted) throw new DOMException("已停止", "AbortError");
  const endpoint = ifStreamEndpoint(config);
  const response = await request(endpoint, { method: "POST", signal, headers: buildRequestHeaders(config, determineBaseUrl(config)), body: JSON.stringify({ model: config.defaultModel, messages, stream: true }) });
  if (!response.ok || !response.body) throw new Error(`IF流式 HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", output = "", done = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const consume = async (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw) return;
    if (raw === "[DONE]") { done = true; return; }
    const event = JSON.parse(raw);
    if (event.error) throw new Error("IF流式服务端返回错误");
    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === "string") { output += delta; await onDelta(delta); }
    const reason = event.choices?.[0]?.finish_reason;
    if (reason && reason !== "stop") throw new Error(`流式回复未正常完成：${reason}`);
    if (reason) done = true;
  };
  try {
    while (!done) {
      const chunk = await reader.read();
      if (signal.aborted) throw new DOMException("已停止", "AbortError");
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end;
      while (!done && (end = buffer.indexOf("\n")) >= 0) {
        if (signal.aborted) throw new DOMException("已停止", "AbortError");
        await consume(buffer.slice(0, end).replace(/\r$/, "")); buffer = buffer.slice(end + 1);
      }
      if (chunk.done) { if (!done && buffer.trim()) await consume(buffer); break; }
    }
    if (!done) throw new Error("流中断：未收到结束标记");
    if (signal.aborted) throw new DOMException("已停止", "AbortError");
    return output;
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
