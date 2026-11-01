import { buildChatCompletionsUrl, buildRequestHeaders, determineBaseUrl, isNativeAnthropicApi, isNativeGoogleApi } from "./api-helpers";
import type { ApiConfig } from "./settings-types";
import type { IFPromptMessage } from "./if-theater";

/** One HTTP request, no retry/fallback, no plugins or modern-memory assembly. */
export async function streamIFReply(config: ApiConfig, messages: IFPromptMessage[], signal: AbortSignal, onDelta: (text: string) => void, request: typeof fetch = fetch): Promise<string> {
  if (signal.aborted) throw new DOMException("已停止", "AbortError");
  if (isNativeAnthropicApi(config) || isNativeGoogleApi(config)) throw new Error("IF流式暂仅支持 OpenAI 兼容配置；未发起请求");
  const response = await request(buildChatCompletionsUrl(determineBaseUrl(config)), { method: "POST", signal, headers: buildRequestHeaders(config, determineBaseUrl(config)), body: JSON.stringify({ model: config.defaultModel, messages, stream: true }) });
  if (!response.ok || !response.body) throw new Error(`IF流式 HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", output = "", done = false;
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw) return;
    if (raw === "[DONE]") { done = true; return; }
    const event = JSON.parse(raw);
    if (event.error) throw new Error("IF流式服务端返回错误");
    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === "string") { output += delta; onDelta(delta); }
    if (event.choices?.[0]?.finish_reason) done = true;
  };
  try {
    while (!done) {
      const chunk = await reader.read();
      if (signal.aborted) throw new DOMException("已停止", "AbortError");
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, end).replace(/\r$/, "")); buffer = buffer.slice(end + 1); }
      if (chunk.done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (!done) throw new Error("流中断：未收到结束标记");
    if (signal.aborted) throw new DOMException("已停止", "AbortError");
    return output;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
