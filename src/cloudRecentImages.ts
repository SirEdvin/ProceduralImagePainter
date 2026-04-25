import type { Provider } from './cloudUpload';

export interface CloudRecentImage {
  id: string;
  provider: Provider;
  key: string;
  url: string;
  name: string;
  type: string;
  thumbnail: string;
  addedAt: number;
}

const STORAGE_KEY = 'cloudRecentImages';
const MAX_ITEMS = 10;

function readAll(): CloudRecentImage[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CloudRecentImage[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: CloudRecentImage[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listCloudRecentImages(): CloudRecentImage[] {
  return readAll().sort((a, b) => b.addedAt - a.addedAt);
}

export function addCloudRecentImage(
  entry: Omit<CloudRecentImage, 'id' | 'addedAt'>,
): { added: CloudRecentImage; evicted: CloudRecentImage[] } {
  const all = readAll();
  const added: CloudRecentImage = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    addedAt: Date.now(),
  };
  all.push(added);
  all.sort((a, b) => a.addedAt - b.addedAt);
  const evicted: CloudRecentImage[] = [];
  while (all.length > MAX_ITEMS) {
    const dropped = all.shift();
    if (dropped) evicted.push(dropped);
  }
  writeAll(all);
  return { added, evicted };
}

export function removeCloudRecentImage(id: string): CloudRecentImage | undefined {
  const all = readAll();
  const idx = all.findIndex((i) => i.id === id);
  if (idx === -1) return undefined;
  const [removed] = all.splice(idx, 1);
  writeAll(all);
  return removed;
}

export function getCloudRecentImage(id: string): CloudRecentImage | undefined {
  return readAll().find((i) => i.id === id);
}
