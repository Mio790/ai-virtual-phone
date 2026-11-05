import Dexie from "dexie";
import type { IFData, IFScript } from "./if-theater";
export type IFPending = { id: string; data: IFData; saveId: string; input: string; text: string; rerollIndex?: number };
const pendingPrefix = "ai_phone_if_pending_";
const deltaPrefix = "ai_phone_if_delta_";
const knownPending = new Set<string>();
export const isIFStorageKey = (name: string) => name === "ai_phone_if_theater_v1" || name.startsWith(pendingPrefix) || name.startsWith(deltaPrefix);

function isScript(script: IFScript): boolean {
  return !!script && ["id", "title", "world", "time", "opening", "player", "rules"].every(field => typeof script[field as keyof IFScript] === "string")
    && Array.isArray(script.actors) && script.actors.every(actor => actor && ["characterId", "name", "persona", "personality", "identity"].every(field => typeof actor[field as keyof typeof actor] === "string"));
}
function validateData(data: IFData): void {
  const valid = data && Number.isSafeInteger(data.revision) && data.revision >= 0 && Array.isArray(data.scripts) && data.scripts.every(isScript)
    && Array.isArray(data.saves) && data.saves.every(save => save && typeof save.id === "string" && typeof save.title === "string" && typeof save.scriptId === "string" && typeof save.memory === "string" && isScript(save.script)
      && Array.isArray(save.messages) && save.messages.every(message => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string"));
  if (!valid) throw new Error("IF 备份结构不完整；原数据未修改");
  if (data.replyVersions && (!Array.isArray(data.replyVersions) || !data.replyVersions.every(group => group && Number.isInteger(group.index) && group.index >= 0 && Array.isArray(group.saveIds)
    && group.saveIds.every(id => data.saves.some(save => save.id === id && save.messages[group.index]?.role === "assistant"))))) throw new Error("IF 版本分支引用损坏；原数据未修改");
}

// Reuse the existing KV schema unchanged, one exclusive key, no modern cache reads.
const key = "ai_phone_if_theater_v1";
const db = new Dexie("AiPhoneKvDB");
db.version(1).stores({ entries: "key" });
export async function readIFData(): Promise<IFData> {
  const row = await db.table("entries").get(key);
  const data = row ? JSON.parse(row.value) : { revision: 0, scripts: [], saves: [] };
  validateData(data);
  return data;
}
export async function writeIFData(data: IFData): Promise<IFData> {
  const next = structuredClone({ ...data, revision: data.revision + 1 });
  await db.transaction("rw", db.table("entries"), async () => {
    const row = await db.table("entries").get(key);
    if ((row ? JSON.parse(row.value).revision : 0) !== data.revision) throw new Error("另一个窗口已修改剧场，请重新打开后再试；本次未覆盖");
    const value = JSON.stringify(next);
    await db.table("entries").put({ key, value });
    if ((await db.table("entries").get(key))?.value !== value) throw new Error("剧场落盘校验失败");
  });
  return next;
}

/** A separate KV checkpoint: a failed history transaction cannot erase received text. */
export async function checkpointIFReply(pending: IFPending): Promise<void> {
  const key = pendingPrefix + pending.id, deltaKey = deltaPrefix + pending.id;
  const delta = JSON.stringify({ text: pending.text });
  await db.transaction("rw", db.table("entries"), async () => {
    if (!knownPending.has(pending.id)) {
      const row = await db.table("entries").get(key);
      if (!row) {
        const value = JSON.stringify({ ...pending, text: "" });
        await db.table("entries").put({ key, value });
        if ((await db.table("entries").get(key))?.value !== value) throw new Error("回复快照落盘校验失败");
      }
    }
    await db.table("entries").put({ key: deltaKey, value: delta });
    if ((await db.table("entries").get(deltaKey))?.value !== delta) throw new Error("回复检查点落盘校验失败");
  });
  knownPending.add(pending.id);
}
export async function readIFPending(): Promise<IFPending[]> {
  return db.transaction("r", db.table("entries"), async () => {
    const rows = await db.table("entries").where("key").startsWith(pendingPrefix).toArray();
    return Promise.all(rows.map(async row => {
      const pending: IFPending = JSON.parse(row.value);
      if (row.key !== pendingPrefix + pending.id || typeof pending.text !== "string") throw new Error("回复检查点损坏，未修改存档");
      validateData(pending.data);
      const delta = await db.table("entries").get(deltaPrefix + pending.id);
      const text = delta ? JSON.parse(delta.value).text : pending.text;
      if (typeof text !== "string") throw new Error("回复增量检查点损坏，未修改存档");
      return { ...pending, text };
    }));
  });
}
export async function clearIFPending(id: string): Promise<void> {
  await db.transaction("rw", db.table("entries"), async () => {
    await db.table("entries").delete(pendingPrefix + id);
    await db.table("entries").delete(deltaPrefix + id);
  });
  knownPending.delete(id);
}

/** Backup import uses this path only for IF keys: database-first, no shared cache poison. */
export async function importIFRecord(name: string, value: string, overwrite: boolean): Promise<"added" | "overwritten" | "skipped"> {
  if (!isIFStorageKey(name)) throw new Error("不是 IF 数据键");
  const parsed = JSON.parse(value);
  if (name === key) {
    validateData(parsed);
  } else if (name.startsWith(pendingPrefix)) {
    if (!parsed || parsed.id !== name.slice(pendingPrefix.length) || !parsed.id || typeof parsed.saveId !== "string" || typeof parsed.input !== "string" || typeof parsed.text !== "string") throw new Error("IF 回复快照损坏");
    validateData(parsed.data);
  } else if (!parsed || typeof parsed.text !== "string" || !name.slice(deltaPrefix.length)) throw new Error("IF 回复检查点损坏");
  return db.transaction("rw", db.table("entries"), async () => {
    const row = await db.table("entries").get(name), exists = !!row;
    if (exists && !overwrite) return "skipped";
    // Restoring an archive must invalidate an older in-flight writer, even when
    // the archive and that writer happen to carry the same revision number.
    const revision = name === key ? Math.max(parsed.revision, row ? JSON.parse(row.value).revision : 0) + 1 : 0;
    if (name === key && !Number.isSafeInteger(revision)) throw new Error("IF 修订号无效；原数据未修改");
    const persistedValue = name === key ? JSON.stringify({ ...parsed, revision }) : value;
    await db.table("entries").put({ key: name, value: persistedValue });
    if ((await db.table("entries").get(name))?.value !== persistedValue) throw new Error("IF 备份恢复落盘校验失败");
    return exists ? "overwritten" : "added";
  });
}
