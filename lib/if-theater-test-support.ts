import type { ApiConfig } from "./settings-types";

/** Explicit opt-in, isolated preview origin only. No production-host override. */
export function isIFOfflineAcceptance(location: { hostname: string; search: string }): boolean {
  return /^deploy-preview-2--mio-ai-virtual-phone\.netlify\.app$/.test(location.hostname)
    && new URLSearchParams(location.search).get("ifTheaterTest") === "1";
}
export const IF_TEST_CONFIG: ApiConfig = { id: "if-local-mock", name: "本地合成验收（零 API）", provider: "Custom", baseUrl: "https://local-mock.invalid/v1", apiKey: "IF-LOCAL-MOCK-NO-NETWORK", defaultModel: "synthetic-sse", enableImageRecognition: false, enableImageGeneration: false };

/** Browser-only synthetic SSE producer. It never invokes fetch or reads real keys. */
export const requestIFAcceptance: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  const user = body.messages?.filter((message: { role: string }) => message.role === "user").length || 0;
  const version = crypto.randomUUID().slice(0, 8);
  const text = `【本地合成验收 ${version}】\n这是零网络的测试回复。当前请求包含 ${user} 条用户历史。\n可测试流式显示、Stop、重新生成、版本切换和独立分支。此文本不代表真实模型行为。\n`;
  let timer: ReturnType<typeof setTimeout> | undefined, offset = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const tick = () => {
        if (init?.signal?.aborted) { controller.error(new DOMException("已停止", "AbortError")); return; }
        if (offset >= text.length) { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); return; }
        const content = text.slice(offset, offset + 4); offset += 4;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
        timer = setTimeout(tick, 80);
      };
      tick();
    },
    cancel() { if (timer) clearTimeout(timer); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
};
