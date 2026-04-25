export interface RecentImage {
  id: number;
  name: string;
  type: string;
  blob: Blob;
  thumbnail: string;
  addedAt: number;
}

const DB_NAME = 'procedural-image-painter';
const DB_VERSION = 1;
const STORE = 'recentImages';
const MAX_ITEMS = 10;
const THUMB_MAX = 96;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('addedAt', 'addedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

async function makeThumbnail(file: File | Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(THUMB_MAX / bmp.width, THUMB_MAX / bmp.height, 1);
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}

export async function addRecentImage(file: File): Promise<void> {
  const thumbnail = await makeThumbnail(file);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, 'readwrite');
      const entry: Omit<RecentImage, 'id'> = {
        name: file.name,
        type: file.type || 'image/png',
        blob: file,
        thumbnail,
        addedAt: Date.now(),
      };
      const req = store.add(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await pruneOldest(db);
  } finally {
    db.close();
  }
}

async function pruneOldest(db: IDBDatabase): Promise<void> {
  const all = await new Promise<RecentImage[]>((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result as RecentImage[]);
    req.onerror = () => reject(req.error);
  });
  if (all.length <= MAX_ITEMS) return;
  all.sort((a, b) => a.addedAt - b.addedAt);
  const toDelete = all.slice(0, all.length - MAX_ITEMS);
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite');
    let pending = toDelete.length;
    if (pending === 0) return resolve();
    for (const item of toDelete) {
      const req = store.delete(item.id);
      req.onsuccess = () => {
        if (--pending === 0) resolve();
      };
      req.onerror = () => reject(req.error);
    }
  });
}

export async function listRecentImages(): Promise<RecentImage[]> {
  const db = await openDb();
  try {
    const all = await new Promise<RecentImage[]>((resolve, reject) => {
      const req = tx(db, 'readonly').getAll();
      req.onsuccess = () => resolve(req.result as RecentImage[]);
      req.onerror = () => reject(req.error);
    });
    all.sort((a, b) => b.addedAt - a.addedAt);
    return all;
  } finally {
    db.close();
  }
}

export async function getRecentImage(id: number): Promise<RecentImage | undefined> {
  const db = await openDb();
  try {
    return await new Promise<RecentImage | undefined>((resolve, reject) => {
      const req = tx(db, 'readonly').get(id);
      req.onsuccess = () => resolve(req.result as RecentImage | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteRecentImage(id: number): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, 'readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
