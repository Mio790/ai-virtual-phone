// IF-only domain. No modern chat/memory imports or implicit model calls.
export type IFActor = { characterId: string; name: string; persona: string; personality: string; identity: string };
export type IFScript = { id: string; title: string; world: string; time: string; opening: string; player: string; rules: string; actors: IFActor[] };
export type IFMessage = { role: "user" | "assistant"; content: string };
export type IFPromptMessage = { role: "system" | "user" | "assistant"; content: string };
export type IFSave = { id: string; scriptId: string; title: string; script: IFScript; messages: IFMessage[]; memory: string };
export type IFData = { revision: number; scripts: IFScript[]; saves: IFSave[] };
export const newIFId = () => crypto.randomUUID();
export function newIFSave(script: IFScript): IFSave {
  return { id: newIFId(), scriptId: script.id, title: `${script.title} · 新存档`, script: structuredClone(script), messages: script.opening ? [{ role: "assistant", content: script.opening }] : [], memory: "" };
}
export function buildIFPrompt(save: IFSave, input: string): IFPromptMessage[] {
  const script = save.script;
  const system = [
    "你扮演同一剧本中的环境、NPC和相关在场角色。这是单次多人RP，不使用DM、代理或掷骰。不强制每个角色每轮出场。",
    "禁止代写玩家台词、动作、表情或决定；禁止Echo重复玩家输入；禁止上帝视角。双重人格属于同一角色卡同一身体，不拆分身份。",
    "以下剧本落地身份优先于角色原有现代背景，每轮持续生效。不得把现代聊天或记忆当成本剧本经历。",
    `[世界原文]\n${script.world}`, `[时刻设定]\n${script.time}`, `[玩家主控]\n${script.player}`, `[剧本规则]\n${script.rules}`,
    ...script.actors.map(actor => `[角色 ${actor.characterId}：${actor.name}]\n[基础快照]\n${actor.persona}\n${actor.personality}\n[本剧本落地身份（时代/爵位/住所/财产/关系）]\n${actor.identity}`),
    `[当前存档专属记忆]\n${save.memory}`,
  ].join("\n\n");
  return [{ role: "system", content: system }, ...save.messages.map(message => ({ ...message })), { role: "user", content: input }];
}
export type IFTransport = (messages: IFPromptMessage[], signal: AbortSignal) => Promise<string>;
/** Exactly one transport invocation. No retries, summaries, titles or agent requests. */
export async function sendIFTurn(save: IFSave, input: string, signal: AbortSignal, transport: IFTransport): Promise<IFSave> {
  if (!input.trim()) throw new Error("请输入内容");
  if (signal.aborted) throw new Error("已停止");
  const response = await transport(buildIFPrompt(save, input), signal);
  if (signal.aborted) throw new Error("已停止");
  if (!response.trim()) throw new Error("模型返回空内容；原存档未修改");
  return { ...save, messages: [...save.messages, { role: "user", content: input }, { role: "assistant", content: response }] };
}
