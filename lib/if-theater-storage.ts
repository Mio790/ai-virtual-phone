import Dexie from "dexie";
import type { IFData } from "./if-theater";

// Reuse the existing KV schema unchanged, one exclusive key, no modern cache reads.
const key = "ai_phone_if_theater_v1";
const db = new Dexie("AiPhoneKvDB");
db.version(1).stores({ entries: "key" });
export async function readIFData(): Promise<IFData> {
  const row = await db.table("entries").get(key);
  return row ? JSON.parse(row.value) : { revision: 0, scripts: [], saves: [] };
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
