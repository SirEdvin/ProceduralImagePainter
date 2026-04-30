import type { Provider } from './cloudUpload';

export interface GeneratedImage {
  id: string;
  provider: Provider;
  key: string;
  url: string;
  name: string;
  type: string;
  phrase: string;
  thumbnail: string;
  addedAt: number;
}

const STORAGE_KEY = 'generatedImages';
const MAX_ITEMS = 24;

function readAll(): GeneratedImage[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GeneratedImage[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: GeneratedImage[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listGeneratedImages(): GeneratedImage[] {
  return readAll().sort((a, b) => b.addedAt - a.addedAt);
}

export function addGeneratedImage(
  entry: Omit<GeneratedImage, 'id' | 'addedAt'>,
): { added: GeneratedImage; evicted: GeneratedImage[] } {
  const all = readAll();
  const added: GeneratedImage = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    addedAt: Date.now(),
  };
  all.push(added);
  all.sort((a, b) => a.addedAt - b.addedAt);
  const evicted: GeneratedImage[] = [];
  while (all.length > MAX_ITEMS) {
    const dropped = all.shift();
    if (dropped) evicted.push(dropped);
  }
  writeAll(all);
  return { added, evicted };
}

export function removeGeneratedImage(id: string): GeneratedImage | undefined {
  const all = readAll();
  const idx = all.findIndex((item) => item.id === id);
  if (idx === -1) return undefined;
  const [removed] = all.splice(idx, 1);
  writeAll(all);
  return removed;
}
