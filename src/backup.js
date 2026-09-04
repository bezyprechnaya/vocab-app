/* Резервная копия локальной базы (глава I, 3.3).

   Экспорт — все четыре стора плюс настройки в один JSON.
   Импорт — либо такой же файл (объединить / заменить всё), либо файл-пакет:
   это способ поставить пакет вообще без сети — скачал на другом устройстве,
   перенёс, импортировал.

   Импорт всегда одна транзакция на все сторы: при ошибке база остаётся прежней. */

import * as db from "./db.js";
import * as packs from "./packs.js";
import * as settingsStore from "./settings.js";

export const SCHEMA = 1;
const STATUS_RANK = { new: 0, learning: 1, learned: 2 };

export async function collect() {
  const [items, progress, sessions, packRows, settings] = await Promise.all([
    db.getAll("items"), db.getAll("progress"), db.getAll("sessions"),
    db.getAll("packs"), db.getAll("settings"),
  ]);
  return {
    schema: SCHEMA,
    kind: "backup",
    exportedAt: new Date().toISOString(),
    items, progress, sessions, packs: packRows, settings,
  };
}

export function fileName() {
  return `vocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function download() {
  const data = await collect();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName();
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return data;
}

export function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("это не JSON");
  }
  if (data && Array.isArray(data.items) && Array.isArray(data.items[0])) {
    packs.validate(data);
    return { type: "pack", data };
  }
  if (!data || data.schema !== SCHEMA || !Array.isArray(data.items)) {
    throw new Error("файл не похож на копию базы или пакет");
  }
  return { type: "backup", data };
}

/** Объединение: побеждает более продвинутый статус, закрытый день не затирается. */
export async function merge(data) {
  await db.transact(db.STORES, "readwrite", async (s) => {
    for (const item of data.items || []) {
      const existing = await db.request(s.items.get(item.id));
      s.items.put(existing ? {
        ...existing, ...item,
        tr: { ...existing.tr, ...item.tr },
        exTr: { ...existing.exTr, ...item.exTr },
        src: { ...existing.src, ...item.src },
      } : item);
    }
    for (const row of data.progress || []) {
      const existing = await db.request(s.progress.get(row.id));
      if (!existing || (STATUS_RANK[row.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0)) {
        s.progress.put({ ...existing, ...row, reviews: Math.max(existing?.reviews || 0, row.reviews || 0) });
      }
    }
    for (const row of data.sessions || []) {
      const existing = await db.request(s.sessions.get(row.id));
      if (!existing || existing.phase !== "done") s.sessions.put(row);
    }
    for (const row of data.packs || []) s.packs.put(row);
  });
  settingsStore.forget();
}

/** Замена: сносим содержимое и пишем то, что в файле. Настройки тоже. */
export async function replaceAll(data) {
  await db.transact(db.STORES, "readwrite", async (s) => {
    for (const name of db.STORES) s[name].clear();
    for (const item of data.items || []) s.items.put(item);
    for (const row of data.progress || []) s.progress.put(row);
    for (const row of data.sessions || []) s.sessions.put(row);
    for (const row of data.packs || []) s.packs.put(row);
    for (const row of data.settings || []) s.settings.put(row);
  });
  settingsStore.forget();
}

export async function importPack(pack) {
  await packs.write(pack);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("файл не прочитан"));
    reader.readAsText(file);
  });
}
