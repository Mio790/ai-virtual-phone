import { applyIFReply, ifTurnContext, newIFId, type IFData, type IFPromptMessage } from "./if-theater";
import { checkpointIFReply, clearIFPending, writeIFData, type IFPending } from "./if-theater-storage";

export type IFStreamTransport = (messages: IFPromptMessage[], signal: AbortSignal, onDelta: (text: string) => Promise<void>) => Promise<string>;
/** Shared by Send and menu Re-roll. Storage is verified before spending a request. */
export async function runIFStreamingTurn(data: IFData, saveId: string, input: string, signal: AbortSignal, transport: IFStreamTransport, onPartial: (text: string) => void, rerollIndex?: number) {
  const save = data.saves.find(item => item.id === saveId);
  if (!save) throw new Error("存档不存在");
  if (signal.aborted) throw new Error("已停止");
  if (rerollIndex === undefined && !input.trim()) throw new Error("请输入内容");
  const messages = ifTurnContext(save, input, rerollIndex);
  const pending: IFPending = { id: newIFId(), data, saveId, input, text: "", rerollIndex };
  await checkpointIFReply(pending);
  let warning = "";
  try {
    await transport(messages, signal, async delta => {
      pending.text += delta;
      onPartial(pending.text);
      await checkpointIFReply(pending);
    });
    if (signal.aborted) warning = "已停止，已保留部分回复";
  } catch (error) {
    if (!pending.text) { await clearIFPending(pending.id); throw error; }
    warning = `已停止或中断，保留未完成回复：${error instanceof Error ? error.message : String(error)}`;
    // If checkpoint failed, retry only local persistence, never the model request.
    await checkpointIFReply(pending);
  }
  if (!pending.text.trim()) { await clearIFPending(pending.id); throw new Error("返回为空，未修改历史"); }
  const next = applyIFReply(data, saveId, input, pending.text, !!warning, rerollIndex);
  const persisted = await writeIFData(next.data);
  // Checkpoints whose history is already committed are safe to discard on recovery.
  try { await clearIFPending(pending.id); } catch { warning += "；清理回复检查点失败，旧历史和新回复均已落盘"; }
  return { data: persisted, saveId: next.saveId, warning };
}

export async function recoverIFPending(pending: IFPending) {
  // Optimistic revision check in writeIFData rejects stale recovery, never overwrites.
  const next = applyIFReply(pending.data, pending.saveId, pending.input, pending.text, true, pending.rerollIndex);
  const persisted = await writeIFData(next.data);
  let warning = "";
  try { await clearIFPending(pending.id); } catch { warning = "回复已恢复，但检查点清理失败；不要重复恢复，可复制后移除检查点"; }
  return { data: persisted, saveId: next.saveId, warning };
}
