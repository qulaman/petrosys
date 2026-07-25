"use client";

/**
 * Хранилище очереди неотправленных записей — IndexedDB.
 *
 * Почему не localStorage (как было): туда влезает ~5 МБ, доступ синхронный и
 * значения только строковые. Выдача топлива тянет за собой фото чека — одна
 * такая запись выбивала бы квоту и вешала поток отрисовки. IndexedDB хранит
 * Blob как есть, работает асинхронно и даёт на порядки больший объём.
 */
import type { OutboxEntry } from "@/lib/outbox/types";
import { devError } from "@/lib/dev-log";

const DB_NAME = "qo-outbox";
const DB_VERSION = 1;
const STORE = "entries";
/** Ключ старой очереди в localStorage — переносим её при первом обращении. */
const LEGACY_KEY = "qo-outbox";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Однократный перенос записей из localStorage, чтобы не потерять уже стоящие в очереди. */
let migrated = false;
async function migrateLegacy() {
  if (migrated || typeof window === "undefined") return;
  migrated = true;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const list = JSON.parse(raw) as OutboxEntry[];
    for (const entry of list) await putEntry(entry);
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) {
    devError("outbox-db", "не удалось перенести старую очередь:", e);
  }
}

export async function allEntries(): Promise<OutboxEntry[]> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return [];
  try {
    await migrateLegacy();
    const list = await tx<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
    return list.sort((a, b) => a.createdAt - b.createdAt);
  } catch (e) {
    devError("outbox-db", "чтение очереди:", e);
    return [];
  }
}

export async function entriesOfKind(kind: string): Promise<OutboxEntry[]> {
  return (await allEntries()).filter((e) => e.kind === kind);
}

export async function putEntry(entry: OutboxEntry): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await tx("readwrite", (s) => s.put(entry) as IDBRequest<IDBValidKey>);
  } catch (e) {
    devError("outbox-db", "запись в очередь:", e);
  }
}

export async function deleteEntry(id: string): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
  } catch (e) {
    devError("outbox-db", "удаление из очереди:", e);
  }
}
