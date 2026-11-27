import localforage from "localforage";

import { collectActiveStorageKeys } from "@/services/workspace-archive";

export type IndexedDbStoreUsage = { name: string; records: number; bytes: number };
export type IndexedDbDatabaseUsage = { name: string; version: number; bytes: number; stores: IndexedDbStoreUsage[] };
export type LocalStorageUsage = { usage: number; quota: number | null; contentBytes: number; databases: IndexedDbDatabaseUsage[] };
export type CleanupResult = { removed: number; freedBytes: number };

const INTERNAL_STORE_NAMES = new Set(["local-forage-detect-blob-support"]);
const previewStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_previews" });
const imageStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const mediaStore = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
    const [estimate, database] = await Promise.all([readStorageEstimate(), readDatabaseUsage("infinite-canvas")]);
    return { usage: estimate?.usage ?? database.bytes, quota: estimate?.quota ?? null, contentBytes: database.bytes, databases: [database] };
}

export async function clearPreviewCache(): Promise<CleanupResult> {
    let removed = 0;
    let freedBytes = 0;
    await previewStore.iterate<unknown, void>((value) => {
        removed += 1;
        freedBytes += valueBytes(value);
    });
    await previewStore.clear();
    return { removed, freedBytes };
}

export async function clearOrphanMedia(): Promise<CleanupResult> {
    const activeKeys = await collectActiveStorageKeys();
    let removed = 0;
    let freedBytes = 0;

    for (const store of [imageStore, mediaStore]) {
        const orphanKeys: string[] = [];
        await store.iterate<unknown, void>((value, key) => {
            if (!activeKeys.has(key)) {
                orphanKeys.push(key);
                freedBytes += valueBytes(value);
            }
        });
        for (const key of orphanKeys) {
            await store.removeItem(key);
            removed += 1;
        }
    }
    return { removed, freedBytes };
}

async function readStorageEstimate() {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    try {
        return await navigator.storage.estimate();
    } catch {
        return null;
    }
}

function readDatabaseUsage(name: string) {
    return new Promise<IndexedDbDatabaseUsage>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const database = request.result;
            const names = Array.from(database.objectStoreNames).filter((storeName) => !INTERNAL_STORE_NAMES.has(storeName));
            if (!names.length) {
                database.close();
                resolve({ name, version: database.version, bytes: 0, stores: [] });
                return;
            }
            const transaction = database.transaction(names, "readonly");
            Promise.all(names.map((storeName) => readStoreUsage(transaction.objectStore(storeName))))
                .then((stores) => resolve({ name, version: database.version, bytes: stores.reduce((total, store) => total + store.bytes, 0), stores: stores.sort((a, b) => b.bytes - a.bytes) }))
                .catch(reject)
                .finally(() => database.close());
        };
    });
}

function readStoreUsage(store: IDBObjectStore) {
    return new Promise<IndexedDbStoreUsage>((resolve, reject) => {
        let records = 0;
        let bytes = 0;
        const request = store.openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve({ name: store.name, records, bytes });
                return;
            }
            records += 1;
            bytes += valueBytes(cursor.value);
            cursor.continue();
        };
    });
}

function valueBytes(value: unknown) {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}
