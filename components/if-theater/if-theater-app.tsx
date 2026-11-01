"use client";
import { useEffect, useRef, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { loadApiConfigs } from "@/lib/settings-storage";
import { streamIFReply } from "@/lib/if-theater-stream";
import { buildIFPrompt, ifTurnContext, newIFId, newIFSave, forkIFSave, editIFMemory, type IFData, type IFScript } from "@/lib/if-theater";
import { readIFData, writeIFData, readIFPending, clearIFPending, type IFPending } from "@/lib/if-theater-storage";
import { runIFStreamingTurn, recoverIFPending } from "@/lib/if-theater-turn";
import { isIFOfflineAcceptance, IF_TEST_CONFIG, requestIFAcceptance } from "@/lib/if-theater-test-support";
import ui from "./if-theater.module.css";

export default function IFTheaterApp({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<IFData | null>(null);
  const [editing, setEditing] = useState<IFScript | null>(null);
  const [saveId, setSaveId] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [apiId, setApiId] = useState("");
  const [partial, setPartial] = useState("");
  const [menu, setMenu] = useState<number | null>(null);
  const [pending, setPending] = useState<IFPending[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<{ saveId: string; text: string } | null>(null);
  const [acceptance, setAcceptance] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const root = useRef<HTMLElement | null>(null);
  const scroll = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);
  const characters = loadCharacters();
  const configs = acceptance ? [IF_TEST_CONFIG] : loadApiConfigs();
  const save = data?.saves.find(item => item.id === saveId);
  useEffect(() => {
    let mounted = true;
    if (window.location && isIFOfflineAcceptance(window.location)) { setAcceptance(true); setApiId(IF_TEST_CONFIG.id); }
    readIFData().then(data => { if (mounted) { setData(data); setSaveId(data.saves.some(save => save.id === data.activeSaveId) ? data.activeSaveId! : ""); } }).catch(error => { if (mounted) setError(String(error)); });
    readIFPending().then(pending => { if (mounted) setPending(pending); }).catch(error => { if (mounted) setError(`检查点读取失败（未改动旧历史）：${String(error)}`); });
    return () => { mounted = false; controller.current?.abort(); if (press.current) clearTimeout(press.current); };
  }, []);
  // Resize only this app when Safari's keyboard reduces the visual viewport.
  // Do not change document/body height or any other app's scrolling behavior.
  useEffect(() => {
    const element = root.current, viewport = window.visualViewport;
    if (!element || !viewport) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const parent = element.parentElement?.getBoundingClientRect();
        if (!parent || viewport.scale > 1.05) return;
        const available = Math.min(parent.bottom, viewport.offsetTop + viewport.height) - parent.top;
        element.style.setProperty("--if-visible-height", `${Math.max(0, Math.min(parent.height, available))}px`);
        element.dataset.keyboard = String(parent.height - available > 100);
      });
    };
    viewport.addEventListener("resize", resize); viewport.addEventListener("scroll", resize); resize();
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize); };
  }, []);
  useEffect(() => { follow.current = true; }, [saveId]);
  useEffect(() => {
    if (save && !editing && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [saveId, save?.messages.length, partial, editing]);
  useEffect(() => {
    if (menu === null || typeof document === "undefined") return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [menu]);
  const cancelPress = () => { if (press.current) clearTimeout(press.current); press.current = null; };
  const commit = async (next: IFData) => { const persisted = await writeIFData(next); setData(persisted); };
  const selectSave = async (id: string) => {
    if (!data) return;
    await commit({ ...data, activeSaveId: id }); setSaveId(id); setMenu(null);
  };
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
  const generate = async (rerollIndex?: number) => {
    if (!data || !save) return;
    const config = configs.find(item => item.id === apiId);
    if (!config?.apiKey) throw new Error("请先选择有效 API 配置；未发起请求");
    const abort = new AbortController(); controller.current = abort;
    setPrompt(JSON.stringify(ifTurnContext(save, input, rerollIndex), null, 2));
    setPartial(""); setMenu(null);
    try {
      const result = await runIFStreamingTurn(data, save.id, input, abort.signal,
        (messages, signal, onDelta) => streamIFReply(config, messages, signal, onDelta, acceptance ? requestIFAcceptance : undefined), setPartial, rerollIndex);
      setData(result.data); setSaveId(result.saveId); setError(result.warning);
      if (rerollIndex === undefined) setInput("");
      setPartial("");
    } finally {
      controller.current = null;
      try { setPending(await readIFPending()); } catch (error) { setError(`检查点读取失败：${String(error)}`); }
    }
  };
  return <section ref={root} className={ui.root} aria-label="多人 IF 剧场">
    <header className={ui.header}>
      <div className={ui.heading}><span className={ui.eyebrow}>IF THEATER</span><h1>{editing ? "编辑剧本" : save ? "剧情进行中" : "多人 IF 剧场"}</h1></div>
      <button className={ui.secondary} disabled={busy} onClick={onClose}>关闭</button>
    </header>
    <main ref={scroll} className={ui.scroll} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120; }}>
    {acceptance && <p className={ui.notice} role="status"><strong>本地合成验收模式 · 零费用</strong><br />IF 回复零网络，不使用真实 Key。数据仅存此预览域名；其他 App 不属于演练模式。</p>}
    {error && <p className={ui.error} role="alert">{error}</p>}
    {pending.map(item => <details className={ui.panel} key={item.id}><summary>恢复中断的回复 <span className={ui.badge}>仅本地</span></summary><p className={ui.hint}>恢复不请求模型；历史不一致时拒绝覆盖。</p><pre className={ui.pre}>{item.text || "请求前检查点，尚无回复"}</pre>
      <div className={ui.actions}>
      <button disabled={busy || !item.text.trim()} onClick={() => run(async () => {
        const result = await recoverIFPending(item); setData(result.data); setSaveId(result.saveId); setError(result.warning); setPartial(""); setPending(await readIFPending());
      })} className={ui.primary} aria-label="恢复部分回复（版本冲突时拒绝覆盖）">恢复部分回复</button>
      <button className={ui.danger} disabled={busy} onClick={() => run(async () => { if (confirm("仅移除这个检查点？已保存的剧情不会删除；请先复制需要的文本。")) { await clearIFPending(item.id); setPending(await readIFPending()); } })}>移除检查点</button>
      </div>
    </details>)}
    {!data ? <div className={ui.empty} role="status"><h2>正在读取剧场…</h2><p>读取失败不会覆盖旧数据。</p></div> : editing ? <>
      <div className={ui.intro}><span className={ui.badge}>剧本模板</span><h2>设定属于你的舞台</h2><p>保存完整原文。模板的编辑不会改变已有存档。</p></div>
      <div className={ui.fields}>
      {([
        ['title', '剧本标题', '给这场故事起一个名字', '显示在大厅和新存档中。'],
        ['world', '完整世界观', '时代、地点、世界法则，以及需要永久保留的设定…', '原文保留，每轮注入；不自动压缩。'],
        ['time', '时刻设定', '例如：深秋，晚宴开始前的一个小时', '明确故事当前的时间与场景。'],
        ['opening', '开场白', '环境与角色如何登场？', '作为新存档的第一条剧场消息。'],
        ['player', '主控人设', '你的身份、背景与主控边界…', '由你决定主控，不代写你的选择。'],
        ['rules', '剧本规则', '文风、叙事视角、互动边界或特殊约定…', '与世界观、角色身份一起持续注入。'],
      ] as const).map(([key, label, placeholder, hint]) => <label className={ui.field} key={key}><span className={ui.fieldTitle}>{label}</span><span className={ui.hint} id={`if-${key}-hint`}>{hint}</span><textarea aria-label={label} aria-describedby={`if-${key}-hint`} rows={key === 'title' ? 2 : key === 'world' ? 7 : 4} disabled={busy} placeholder={placeholder} value={editing[key]} onChange={event => setEditing({ ...editing, [key]: event.target.value })} /><span className={ui.count}>{editing[key].length.toLocaleString()} 字符</span></label>)}
      </div>
      <section className={ui.panel} aria-label="参演角色选择"><div className={ui.sectionTitle}><h2>参演角色</h2><span className={ui.badge}>已选 {editing.actors.length} 位</span></div><p className={ui.hint}>只读引用原角色卡，时代身份仅在此剧本生效。</p>
      {!characters.length && <p className={ui.emptyText}>角色库暂时为空。可先保存剧本，添加角色后再回来选择。</p>}
      <div className={ui.actorGrid}>{characters.map(character => <label className={ui.actorChoice} data-selected={editing.actors.some(actor => actor.characterId === character.id)} key={character.id}><input type="checkbox" disabled={busy} checked={editing.actors.some(actor => actor.characterId === character.id)} onChange={event => setEditing({ ...editing, actors: event.target.checked ? [...editing.actors, snapshot(character.id)] : editing.actors.filter(actor => actor.characterId !== character.id) })} /><span>{character.name}</span></label>)}</div>
      </section>
      {editing.actors.map(actor => <label className={ui.field} key={actor.characterId}><span className={ui.fieldTitle}>{actor.name} · 剧本落地身份</span><span className={ui.hint}>时代身份、爵位、住所、财产与关系。原卡保持不变。</span><textarea aria-label={`${actor.name}的剧本身份`} disabled={busy} rows={4} placeholder="填写此角色在本剧本中的身份…" value={actor.identity} onChange={event => setEditing({ ...editing, actors: editing.actors.map(item => item.characterId === actor.characterId ? { ...item, identity: event.target.value } : item) })} /></label>)}
    </> : save ? <>
      <div className={ui.chatHeading}><button className={ui.secondary} disabled={busy} onClick={() => run(() => selectSave(""))}>回到大厅</button><span className={ui.badge}>存档 #{save.id.slice(0, 6)}</span></div>
      <h2 className={ui.saveTitle}>{save.title}</h2>
      <section className={ui.panel} aria-label="当前存档与分支"><label className={ui.fieldTitle} htmlFor="if-branch">当前分支</label><select id="if-branch" disabled={busy} value={saveId} onChange={event => run(() => selectSave(event.target.value))}>{data.saves.filter(item => item.scriptId === save.scriptId).map(item => <option key={item.id} value={item.id}>{item.title} · #{item.id.slice(0, 6)}</option>)}</select><div className={ui.actions}><button disabled={busy} onClick={() => run(async () => { const branch = forkIFSave(save, save.messages.length); await commit({ ...data, activeSaveId: branch.id, saves: [...data.saves, branch] }); setSaveId(branch.id); setMenu(null); })}>另存当前分支</button><span className={ui.hint}>{save.messages.length} 条消息 · {save.script.actors.length} 位参演</span></div></section>
      <details className={ui.panel}><summary>存档设定与专属记忆</summary><p className={ui.hint}>保存后每轮完整注入；其他分支与现代记忆不受影响。</p>
        <label className={ui.field}><span className={ui.fieldTitle}>本分支记忆</span><textarea aria-label="IF 专属记忆" disabled={busy} rows={4} placeholder="记录本分支需要持续记住的事情…" value={memoryDraft?.saveId === save.id ? memoryDraft.text : save.memory} onChange={event => setMemoryDraft({ saveId: save.id, text: event.target.value })} /></label>
        <button disabled={busy} onClick={() => run(async () => { await commit(editIFMemory(data, save.id, memoryDraft?.saveId === save.id ? memoryDraft.text : save.memory)); setMemoryDraft(null); })} aria-label="保存专属记忆（不调用模型）">保存专属记忆</button>
        <p className={ui.hint}>原卡只读。手动刷新基础快照时，保留本剧本落地身份。</p>
        <button disabled={busy} onClick={() => run(async () => {
          const actors = save.script.actors.map(actor => ({ ...snapshot(actor.characterId), identity: actor.identity }));
          await commit({ ...data, saves: data.saves.map(item => item.id === save.id ? { ...save, script: { ...save.script, actors } } : item) });
        })} aria-label="主动刷新角色基础快照（保留落地身份）">刷新角色基础快照</button>
      </details>
      <p className={ui.transcriptLabel}>当前分支的剧情 <span>长按气泡或点「操作」</span></p>
      {!save.messages.length && <div className={ui.empty}><h3>这一幕，由你开始</h3><p>在下方输入消息，发送后只请求一次模型。</p></div>}
      {save.messages.map((message, i) => {
        const versions = data.replyVersions?.find(group => group.index === i && group.saveIds.includes(save.id));
        const selected = versions?.saveIds.indexOf(save.id) ?? 0;
        return <article className={`${ui.message} ${message.role === 'user' ? ui.userMessage : ''}`} key={`${save.id}-${i}`} onContextMenu={event => { event.preventDefault(); if (!busy) setMenu(i); }} onPointerDown={event => { cancelPress(); pointer.current = { x: event.clientX, y: event.clientY }; if (!busy && event.isPrimary) press.current = setTimeout(() => setMenu(i), 550); }} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerMove={event => { if (Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 10) cancelPress(); }}>
          <div className={ui.messageHead}><strong>{message.role === "user" ? "你" : "剧场"}</strong><span className={ui.hint}>#{i + 1}{message.incomplete ? " · 未完成" : ""}</span><button className={ui.messageAction} disabled={busy} onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(i)}>操作</button></div><p>{message.content}</p>
          {versions && <nav className={ui.swipes} aria-label="回复版本"><button aria-label="上一个回复版本" disabled={busy || selected === 0} onClick={() => run(() => selectSave(versions.saveIds[selected - 1]))}>←</button><div><span className={ui.hint}>当前回复版本</span><span className={ui.version} aria-live="polite"> {selected + 1} / {versions.saveIds.length} </span></div><button aria-label="下一个回复版本" disabled={busy || selected === versions.saveIds.length - 1} onClick={() => run(() => selectSave(versions.saveIds[selected + 1]))}>→</button><small>只续写所选版本的历史</small></nav>}
        </article>;
      })}
      {partial && <article className={`${ui.message} ${ui.streaming}`}><strong>{busy ? "正在生成…" : "未保存的回复 · 请先复制保留"}</strong><p>{partial}</p></article>}
      {prompt && <details className={ui.panel} open><summary>实际请求 Prompt <span className={ui.badge}>不含 Key</span></summary><pre className={ui.pre}>{prompt}</pre></details>}
    </> : <>
      <div className={ui.intro}><span className={ui.badge}>独立世界 · 多人叙事</span><h2>让故事，换一种可能。</h2><p>选择一场剧本，带上熟悉的角色。每个存档、每条分支，都有自己的经历。</p><button className={ui.primary} disabled={busy} onClick={() => setEditing(blank())}>＋ 新建剧本</button></div>
      <div className={ui.sectionTitle}><h2>剧本大厅</h2><span className={ui.badge}>{data.scripts.length} 个剧本</span></div>
      {!data.scripts.length && <div className={ui.empty}><h3>舞台还空着</h3><p>点击「新建剧本」，填写世界观并选择参演角色。</p></div>}
      <div className={ui.cardList}>{data.scripts.map(script => <section className={ui.scriptCard} key={script.id}><span className={ui.eyebrow}>SCENARIO</span><h3>{script.title}</h3><p className={ui.excerpt}>{script.world || "尚未填写世界观"}</p><p className={ui.hint}>{script.actors.length} 位参演 · {data.saves.filter(save => save.scriptId === script.id).length} 个存档</p><button className={ui.primary} disabled={busy} onClick={() => run(async () => { const next = newIFSave(script); await commit({ ...data, activeSaveId: next.id, saves: [...data.saves, next] }); setSaveId(next.id); })}>新存档</button><div className={ui.actions}><button disabled={busy} onClick={() => setEditing(structuredClone(script))}>编辑</button><button disabled={busy} onClick={() => setEditing({ ...structuredClone(script), id: newIFId(), title: `${script.title} 副本` })}>复制</button><button className={ui.danger} disabled={busy} onClick={() => run(async () => { if (confirm("仅删除剧本模板？已有存档不会删除。")) await commit({ ...data, scripts: data.scripts.filter(item => item.id !== script.id) }); })}>删除模板</button></div></section>)}</div>
      <div className={ui.sectionTitle}><h2>继续你的故事</h2><span className={ui.badge}>{data.saves.length} 个存档 / 分支</span></div>
      {!data.saves.length && <p className={ui.emptyText}>创建新存档后，可从这里继续。</p>}
      <div className={ui.cardList}>{data.saves.map(item => <button className={ui.saveCard} aria-label={`${item.title} · ${item.messages.length} 条`} disabled={busy} key={item.id} onClick={() => run(() => selectSave(item.id))}><span><strong>{item.title}</strong><small>{item.messages.length} 条消息 · #{item.id.slice(0, 6)}</small></span><span aria-hidden="true">进入 →</span></button>)}</div>
    </>}
    </main>
    {data && editing && <footer className={ui.footer}><button className={ui.secondary} disabled={busy} onClick={() => setEditing(null)}>取消</button><button className={ui.primary} disabled={busy} onClick={() => run(async () => { await commit({ ...data, scripts: [...data.scripts.filter(item => item.id !== editing.id), editing] }); setEditing(null); })}>保存剧本</button></footer>}
    {data && save && !editing && <footer className={ui.composer}>
      <label className={ui.apiLabel} htmlFor="if-api">本轮 API 配置<select id="if-api" disabled={busy} value={apiId} onChange={event => setApiId(event.target.value)}><option value="">请选择（不自动调用）</option>{configs.map(config => <option key={config.id} value={config.id}>{config.name} · {config.defaultModel}</option>)}</select></label>
      <textarea aria-label="剧场消息" disabled={busy} rows={2} placeholder="写下你的台词或行动…" value={input} onChange={event => setInput(event.target.value)} />
      <div className={ui.sendRow}><button className={ui.secondary} disabled={busy || !input.trim()} aria-label="查看本轮完整 Prompt" onClick={() => setPrompt(JSON.stringify(buildIFPrompt(save, input), null, 2))}>查看 Prompt</button><button className={ui.danger} disabled={!busy || !controller.current} aria-label="Stop" onClick={() => controller.current?.abort()}>停止 Stop</button><button className={ui.primary} disabled={busy || !input.trim() || !apiId} aria-label="发送一次请求" onClick={() => run(() => generate())}>发送 Send</button></div>
      <p className={ui.composerHint} role="status">{busy ? "生成中 · 可随时停止，已收到的内容会尝试保存" : "一次发送，仅一次请求 · 不自动总结"}</p>
    </footer>}
    {data && save && menu !== null && <div className={ui.scrim} onClick={event => { if (event.target === event.currentTarget && !busy) setMenu(null); }}>
      <div ref={dialog} className={ui.sheet} role="dialog" aria-modal="true" aria-label="气泡操作" tabIndex={-1} onKeyDown={event => {
        if (event.key === 'Escape' && !busy) setMenu(null);
        if (event.key === 'Tab') {
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}><span className={ui.sheetHandle} /><h2>消息操作</h2><p className={ui.hint}>第 {menu + 1} 条 · 当前存档 #{save.id.slice(0, 6)}<br />历史修改另存分支，原剧情不会被覆盖。</p>
        <button className={ui.primary} disabled={busy || save.messages[menu]?.role !== "assistant" || save.messages[menu - 1]?.role !== "user"} aria-label="Re-roll（一次请求）" onClick={() => run(() => generate(menu))}>重新生成 Re-roll <small>一次请求，保留旧版本</small></button>
        {([['Edit', '编辑消息'], ['Backtrack', '回溯到这里'], ['Delete', '从新分支移除此条及后续']] as const).map(([action, label]) => <button className={action === 'Delete' ? ui.danger : ui.secondary} disabled={busy} aria-label={action} key={action} onClick={() => run(async () => {
          const text = action === "Edit" ? window.prompt("编辑消息（另存分支，原后续保留）", save.messages[menu].content) : null;
          if (action === "Edit" && text === null) return;
          const branch = forkIFSave(save, action === "Backtrack" ? menu + 1 : menu, action === "Edit" ? { ...save.messages[menu], content: text! } : undefined);
          await commit({ ...data, activeSaveId: branch.id, saves: [...data.saves, branch] }); setSaveId(branch.id); setMenu(null);
        })}>{label}<small>{action}</small></button>)}
        <button disabled={busy} onClick={() => setMenu(null)}>取消</button>
      </div>
    </div>}
  </section>;
}
