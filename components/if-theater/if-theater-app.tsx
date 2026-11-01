"use client";
import { useEffect, useRef, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { loadApiConfigs } from "@/lib/settings-storage";
import { simpleLLMCall } from "@/lib/api-helpers";
import { buildIFPrompt, newIFId, newIFSave, sendIFTurn, type IFData, type IFScript } from "@/lib/if-theater";
import { readIFData, writeIFData } from "@/lib/if-theater-storage";

export default function IFTheaterApp({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<IFData | null>(null);
  const [editing, setEditing] = useState<IFScript | null>(null);
  const [saveId, setSaveId] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [apiId, setApiId] = useState("");
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const characters = loadCharacters();
  const configs = loadApiConfigs();
  const save = data?.saves.find(item => item.id === saveId);
  useEffect(() => { readIFData().then(setData).catch(error => setError(String(error))); return () => controller.current?.abort(); }, []);
  const commit = async (next: IFData) => { const persisted = await writeIFData(next); setData(persisted); };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  const snapshot = (id: string) => {
    const character = characters.find(item => item.id === id);
    if (!character) throw new Error("原角色卡不存在，无法刷新");
    return { characterId: id, name: character.name, persona: character.persona, personality: character.personality || "", identity: "" };
  };
  const blank = (): IFScript => ({ id: newIFId(), title: "新剧本", world: "", time: "", opening: "", player: "", rules: "", actors: [] });
  const style = { display: "block", width: "100%", minHeight: 80, color: "#111", marginBottom: 12 };
  return <section style={{ position: "absolute", inset: 0, overflow: "auto", padding: "max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))", background: "#17151b", color: "#eee" }}>
    <button disabled={busy} onClick={onClose}>关闭</button><h2>多人 IF 剧场 · 阶段 A</h2>
    <p>独立剧本与存档。当前为非流式单次请求；流式、版本和分支操作待阶段 B。</p>
    {error && <p role="alert">{error}</p>}
    {!data ? <p>正在读取剧场…（读取失败不会覆盖旧数据）</p> : editing ? <>
      {([['title', '标题'], ['world', '完整世界观'], ['time', '时刻设定'], ['opening', '开场白'], ['player', '玩家主控人设'], ['rules', '剧本规则']] as const).map(([key, label]) => <label key={key}>{label}<textarea disabled={busy} style={style} value={editing[key]} onChange={event => setEditing({ ...editing, [key]: event.target.value })} /></label>)}
      <h3>参演原角色卡（只读引用）</h3>
      {characters.map(character => <label key={character.id} style={{ display: "block" }}><input type="checkbox" disabled={busy} checked={editing.actors.some(actor => actor.characterId === character.id)} onChange={event => setEditing({ ...editing, actors: event.target.checked ? [...editing.actors, snapshot(character.id)] : editing.actors.filter(actor => actor.characterId !== character.id) })} />{character.name}</label>)}
      {editing.actors.map(actor => <label key={actor.characterId}>{actor.name} · 剧本落地身份<textarea disabled={busy} placeholder="时代身份、爵位、住所、财产、关系；每轮优先于现代背景" style={style} value={actor.identity} onChange={event => setEditing({ ...editing, actors: editing.actors.map(item => item.characterId === actor.characterId ? { ...item, identity: event.target.value } : item) })} /></label>)}
      <button disabled={busy} onClick={() => run(async () => { await commit({ ...data, scripts: [...data.scripts.filter(item => item.id !== editing.id), editing] }); setEditing(null); })}>保存剧本</button><button disabled={busy} onClick={() => setEditing(null)}>取消</button>
    </> : save ? <>
      <button disabled={busy} onClick={() => setSaveId("")}>回到大厅</button><h3>{save.title}</h3>
      <p>本存档持有独立世界原文与角色快照；编辑大厅剧本不会改动当前存档。</p>
      <button disabled={busy} onClick={() => run(async () => {
        const actors = save.script.actors.map(actor => ({ ...snapshot(actor.characterId), identity: actor.identity }));
        await commit({ ...data, saves: data.saves.map(item => item.id === save.id ? { ...save, script: { ...save.script, actors } } : item) });
      })}>主动刷新角色基础快照（保留落地身份）</button>
      {save.messages.map((message, i) => <article key={i} style={{ whiteSpace: "pre-wrap", padding: 12, margin: "12px 0", border: "1px solid #777" }}><strong>{message.role === "user" ? "你" : "剧场"}</strong><p>{message.content}</p></article>)}
      <label>本轮 API 配置<select disabled={busy} value={apiId} onChange={event => setApiId(event.target.value)}><option value="">请选择（不自动调用）</option>{configs.map(config => <option key={config.id} value={config.id}>{config.name} · {config.defaultModel}</option>)}</select></label>
      <textarea aria-label="剧场消息" disabled={busy} style={style} value={input} onChange={event => setInput(event.target.value)} />
      <button disabled={busy || !input.trim()} onClick={() => setPrompt(JSON.stringify(buildIFPrompt(save, input), null, 2))}>查看本轮完整 Prompt</button>
      <button disabled={busy || !input.trim() || !apiId} onClick={() => run(async () => {
        const config = configs.find(item => item.id === apiId);
        if (!config?.apiKey) throw new Error("所选 API 配置缺少 Key");
        const abort = new AbortController(); controller.current = abort;
        setPrompt(JSON.stringify(buildIFPrompt(save, input), null, 2));
        const next = await sendIFTurn(save, input, abort.signal, async (messages, signal) => {
          const result = await simpleLLMCall(config, messages, { signal, label: "IF剧场" });
          if (!result.content) throw new Error(result.error || "返回为空");
          return result.content;
        });
        await commit({ ...data, saves: data.saves.map(item => item.id === save.id ? next : item) }); setInput("");
      })}>发送一次请求</button><button disabled={!busy} onClick={() => controller.current?.abort()}>Stop</button>
      {prompt && <details open><summary>实际提交给请求适配器的 Prompt（不含 Key）</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{prompt}</pre></details>}
    </> : <>
      <button disabled={busy} onClick={() => setEditing(blank())}>新建剧本</button>
      {data.scripts.map(script => <article key={script.id}><h3>{script.title}</h3><button disabled={busy} onClick={() => setEditing(structuredClone(script))}>编辑</button><button disabled={busy} onClick={() => setEditing({ ...structuredClone(script), id: newIFId(), title: `${script.title} 副本` })}>复制</button><button disabled={busy} onClick={() => run(async () => { if (confirm("仅删除剧本模板？已有存档不会删除。")) await commit({ ...data, scripts: data.scripts.filter(item => item.id !== script.id) }); })}>删除模板</button><button disabled={busy} onClick={() => run(async () => { const next = newIFSave(script); await commit({ ...data, saves: [...data.saves, next] }); setSaveId(next.id); })}>新存档</button></article>)}
      <h3>独立存档</h3>{data.saves.map(item => <button disabled={busy} key={item.id} onClick={() => setSaveId(item.id)}>{item.title} · {item.messages.length} 条</button>)}
    </>}
  </section>;
}
