import { Painter, type PainterConfig } from './painter';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import {
  hasAnyEnabled,
  loadSettings,
  primaryProvider,
  type CloudSettings,
  type CloudProvider,
  providerDisplayName,
  providerSettingsError,
} from './settings';
import {
  deleteFromCloud,
  downloadFromCloud,
  type CloudObjectRef,
  type UploadFailure,
  uploadToAllEnabled,
  uploadToProvider,
} from './cloudUpload';
import {
  addRecentImage,
  deleteRecentImage,
  getRecentImage,
  listRecentImages,
  type RecentImage,
} from './recentImages';
import {
  addCloudRecentImage,
  getCloudRecentImage,
  listCloudRecentImages,
  removeCloudRecentImage,
  type CloudRecentImage,
} from './cloudRecentImages';
import {
  addGeneratedImage,
  listGeneratedImages,
  removeGeneratedImage,
  type GeneratedImage,
} from './generatedImages';
import { initSettingsPage } from './settingsPage';

// Comprehensive list of common web fonts to test for availability
const COMMON_FONTS = [
  // Sans-serif
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Helvetica',
  'Helvetica Neue',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Calibri',
  'Segoe UI',
  'Century Gothic',
  'Lucida Sans Unicode',
  'Lucida Grande',
  'Geneva',
  'Futura',
  'Gill Sans',
  'Optima',
  'Avenir',
  // Serif
  'Times New Roman',
  'Times',
  'Georgia',
  'Garamond',
  'Palatino Linotype',
  'Palatino',
  'Book Antiqua',
  'Baskerville',
  'Cambria',
  'Didot',
  'Bodoni MT',
  'Rockwell',
  'Constantia',
  'Hoefler Text',
  // Monospace
  'Courier New',
  'Courier',
  'Lucida Console',
  'Monaco',
  'Consolas',
  'Menlo',
  'Andale Mono',
  'DejaVu Sans Mono',
  'Liberation Mono',
  // Display/Decorative
  'Impact',
  'Comic Sans MS',
  'Brush Script MT',
  'Copperplate',
  'Papyrus',
  'Luminari',
  'Chalkboard',
  'Jazz LET',
  'Marker Felt',
];

/**
 * Detect which fonts from a list are actually available in the browser.
 * Uses canvas text measurement to compare against a baseline font.
 */
function detectAvailableFonts(testFonts: string[]): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';

  const baseWidths = new Map<string, number>();
  for (const baseFont of baseFonts) {
    ctx.font = `${testSize} ${baseFont}`;
    baseWidths.set(baseFont, ctx.measureText(testString).width);
  }

  const available: string[] = [];

  for (const font of testFonts) {
    let isAvailable = false;
    for (const baseFont of baseFonts) {
      ctx.font = `${testSize} "${font}", ${baseFont}`;
      const width = ctx.measureText(testString).width;
      if (width !== baseWidths.get(baseFont)) {
        isAvailable = true;
        break;
      }
    }
    if (isAvailable) {
      available.push(font);
    }
  }

  return available;
}

const AVAILABLE_FONTS = detectAvailableFonts(COMMON_FONTS);

// Theme
const themeToggleBtn = document.getElementById('themeToggle') as HTMLButtonElement;
const savedTheme = localStorage.getItem('theme') ?? 'dark';
document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
themeToggleBtn.textContent = savedTheme === 'light' ? '🌙' : '☀️';

themeToggleBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  themeToggleBtn.textContent = next === 'light' ? '🌙' : '☀️';
  localStorage.setItem('theme', next);
});

// Routing
const mainView = document.getElementById('mainView') as HTMLElement;
const settingsView = document.getElementById('settingsView') as HTMLElement;

function applyRoute() {
  const isSettings = window.location.hash === '#/settings';
  mainView.hidden = isSettings;
  settingsView.hidden = !isSettings;
}

window.addEventListener('hashchange', applyRoute);
applyRoute();
initSettingsPage();

let painter: Painter | null = null;
let currentBitmap: ImageBitmap | null = null;
let activeGeneratedImage: GeneratedImage | null = null;

const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
const recentImagesEl = document.getElementById('recentImages') as HTMLDivElement;
const phraseInput = document.getElementById('phrase') as HTMLInputElement;
const minSizeInput = document.getElementById('minSize') as HTMLInputElement;
const maxSizeInput = document.getElementById('maxSize') as HTMLInputElement;
const maxRotationInput = document.getElementById('maxRotation') as HTMLInputElement;
const coverageInput = document.getElementById('coverage') as HTMLInputElement;
const grayShadeInput = document.getElementById('grayShade') as HTMLInputElement;
const thresholdInput = document.getElementById('threshold') as HTMLInputElement;
const seedInput = document.getElementById('seed') as HTMLInputElement;
const batchSizeInput = document.getElementById('batchSize') as HTMLInputElement;
const canvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const downloadPngBtn = document.getElementById('downloadPngBtn') as HTMLButtonElement;
const downloadGifBtn = document.getElementById('downloadGifBtn') as HTMLButtonElement;
const saveResultBtn = document.getElementById('saveResultBtn') as HTMLButtonElement;
const shareResultBtn = document.getElementById('shareResultBtn') as HTMLButtonElement;
const sharePanel = document.getElementById('sharePanel') as HTMLDivElement;
const shareMastodonBtn = document.getElementById('shareMastodonBtn') as HTMLButtonElement;
const shareXBtn = document.getElementById('shareXBtn') as HTMLButtonElement;
const shareFacebookBtn = document.getElementById('shareFacebookBtn') as HTMLButtonElement;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const placeholder = document.getElementById('placeholder') as HTMLDivElement;
const uploadStatusEl = document.getElementById('uploadStatus') as HTMLDivElement;
const generatedGalleryEl = document.getElementById('generatedGallery') as HTMLDivElement;

// Range label sync
function bindRange(
  inputId: string,
  valId: string,
  transform: (v: number) => string = String,
) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  const val = document.getElementById(valId) as HTMLSpanElement;
  const update = () => (val.textContent = transform(parseFloat(input.value)));
  input.addEventListener('input', update);
  update();
}

bindRange('minSize', 'minSizeVal');
bindRange('maxSize', 'maxSizeVal');
bindRange('maxRotation', 'maxRotationVal');
bindRange('coverage', 'coverageVal');
bindRange('grayShade', 'grayShadeVal');
bindRange('threshold', 'thresholdVal', (v) => (v / 100).toFixed(2));
bindRange('batchSize', 'batchSizeVal');

function getSelectedFonts(): string[] {
  return AVAILABLE_FONTS.length > 0 ? AVAILABLE_FONTS : ['Arial'];
}

function setProgress(coverage: number) {
  const pct = Math.min(100, Math.round(coverage * 100));
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${pct}%`;
}

function setStatus(text: string) {
  statusText.textContent = text;
}

function renderUploadMessage(kind: 'ok' | 'error' | 'pending', text: string): void {
  uploadStatusEl.innerHTML = '';
  const row = document.createElement('div');
  row.className = `upload-row ${kind}`;
  row.textContent = text;
  uploadStatusEl.appendChild(row);
}

function uploadFailureMessage(provider: CloudProvider, error: unknown, itemName: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  const providerName = providerDisplayName(provider);
  const hint = /Failed to fetch|Load failed|NetworkError/i.test(detail)
    ? `Check that the bucket CORS allows PUT from ${window.location.origin}, and verify the account ID, bucket, and credentials.`
    : 'Check the bucket name, credentials, permissions, and CORS settings.';
  return `${providerName} upload failed. ${itemName} was not stored in ${providerName}. ${detail} ${hint}`;
}

function providerStatusName(provider: string): string {
  return provider === 'r2' || provider === 's3' ? providerDisplayName(provider) : provider.toUpperCase();
}

function currentPhrase(): string {
  return phraseInput.value.trim() || 'Untitled';
}

function publicUrlBaseForProvider(provider: CloudProvider, settings: CloudSettings): string {
  return provider === 'r2' ? settings.r2.publicUrlBase.trim() : settings.s3.publicUrlBase.trim();
}

function timestampedFilename(prefix: string, extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `${prefix}-${stamp}.${extension}`;
}

function canvasToBlob(type: string = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export the generated image from the canvas.'));
    }, type);
  });
}

async function makeCanvasThumbnail(): Promise<string> {
  const blob = await canvasToBlob('image/png');
  return await makeThumbnail(blob);
}

function setActiveGeneratedImage(image: GeneratedImage | null): void {
  activeGeneratedImage = image;
  shareResultBtn.disabled = !image;
  if (!image) sharePanel.hidden = true;
}

function showCanvas() {
  placeholder.style.display = 'none';
  canvas.style.display = 'block';
}

async function loadBitmapFromBlob(blob: Blob, previewUrl?: string) {
  if (previewUrl) {
    imagePreview.src = previewUrl;
  } else {
    const url = URL.createObjectURL(blob);
    imagePreview.src = url;
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  imagePreview.style.display = 'block';
  currentBitmap = await createImageBitmap(blob);
}

// Recent images strip — entries can live in IndexedDB (local) or in the cloud bucket
type RecentEntry =
  | { source: 'local'; data: RecentImage }
  | { source: 'cloud'; data: CloudRecentImage };

async function makeThumbnail(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const max = 96;
  const ratio = Math.min(max / bmp.width, max / bmp.height, 1);
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.7);
}

async function listAllRecentEntries(): Promise<RecentEntry[]> {
  const [local, cloud] = await Promise.all([listRecentImages(), Promise.resolve(listCloudRecentImages())]);
  const entries: RecentEntry[] = [
    ...local.map((data) => ({ source: 'local', data }) as RecentEntry),
    ...cloud.map((data) => ({ source: 'cloud', data }) as RecentEntry),
  ];
  entries.sort((a, b) => b.data.addedAt - a.data.addedAt);
  return entries;
}

async function renderRecentImages() {
  const entries = await listAllRecentEntries();
  recentImagesEl.innerHTML = '';
  if (entries.length === 0) {
    recentImagesEl.style.display = 'none';
    return;
  }
  recentImagesEl.style.display = 'flex';
  for (const entry of entries) {
    recentImagesEl.appendChild(createRecentEntryEl(entry));
  }
}

function createRecentEntryEl(entry: RecentEntry): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'recent-image';
  if (entry.source === 'cloud') wrap.classList.add('cloud');
  wrap.title = entry.source === 'cloud'
    ? `${entry.data.name} (${entry.data.provider.toUpperCase()})`
    : entry.data.name;

  const img = document.createElement('img');
  img.src = entry.data.thumbnail;
  img.alt = entry.data.name;
  wrap.appendChild(img);

  if (entry.source === 'cloud') {
    const badge = document.createElement('span');
    badge.className = 'recent-badge';
    badge.textContent = entry.data.provider.toUpperCase();
    wrap.appendChild(badge);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'recent-remove';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removeRecentEntry(entry);
    await renderRecentImages();
  });
  wrap.appendChild(remove);

  wrap.addEventListener('click', () => loadRecentEntry(entry));
  return wrap;
}

async function removeRecentEntry(entry: RecentEntry): Promise<void> {
  if (entry.source === 'local') {
    await deleteRecentImage(entry.data.id);
    return;
  }
  const removed = removeCloudRecentImage(entry.data.id);
  if (!removed) return;
  try {
    await deleteFromCloud(removed.provider, removed.key, loadSettings());
  } catch (e) {
    console.warn('Failed to delete cloud recent image', e);
  }
}

async function loadRecentEntry(entry: RecentEntry): Promise<void> {
  if (entry.source === 'local') {
    const fresh = await getRecentImage(entry.data.id);
    if (!fresh) return;
    await loadBitmapFromBlob(fresh.blob, fresh.thumbnail);
    setStatus(`Loaded "${fresh.name}"`);
    return;
  }
  const meta = getCloudRecentImage(entry.data.id);
  if (!meta) return;
  setStatus(`Fetching "${meta.name}" from ${meta.provider.toUpperCase()}…`);
  try {
    const blob = await downloadFromCloud(meta.provider, meta.key, loadSettings());
    await loadBitmapFromBlob(blob, meta.thumbnail);
    setStatus(`Loaded "${meta.name}"`);
  } catch (e) {
    setStatus(`Failed to load: ${(e as Error).message}`);
  }
}

function shareTextForImage(image: GeneratedImage): string {
  return `Generated with Procedural Image Painter: "${image.phrase}"`;
}

function openShareWindow(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer,width=720,height=640');
}

function requireShareableUrl(image: GeneratedImage): boolean {
  if (!image.url.includes('.r2.cloudflarestorage.com/')) return true;
  const message = 'This R2 result was saved, but sharing needs a public R2 URL. Set Cloudflare R2 Public URL Base in Settings to your r2.dev URL or custom domain, then save the result again.';
  setStatus(message);
  renderUploadMessage('error', message);
  return false;
}

function shareGeneratedImage(platform: 'mastodon' | 'x' | 'facebook'): void {
  const image = activeGeneratedImage;
  if (!image || !requireShareableUrl(image)) return;

  const url = encodeURIComponent(image.url);
  const text = encodeURIComponent(shareTextForImage(image));
  if (platform === 'x') {
    openShareWindow(`https://twitter.com/intent/tweet?text=${text}&url=${url}`);
    return;
  }
  if (platform === 'facebook') {
    openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${url}`);
    return;
  }

  const savedServer = localStorage.getItem('mastodonShareServer') ?? 'mastodon.social';
  const answer = prompt('Mastodon server', savedServer);
  const server = answer?.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!server) return;
  localStorage.setItem('mastodonShareServer', server);
  openShareWindow(`https://${server}/share?text=${encodeURIComponent(`${shareTextForImage(image)}\n${image.url}`)}`);
}

function renderGeneratedGallery(): void {
  const images = listGeneratedImages();
  generatedGalleryEl.innerHTML = '';
  if (images.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'generated-empty';
    empty.textContent = 'Save a generated result to cloud storage and it will appear here.';
    generatedGalleryEl.appendChild(empty);
    setActiveGeneratedImage(null);
    return;
  }

  if (!activeGeneratedImage || !images.some((image) => image.id === activeGeneratedImage?.id)) {
    setActiveGeneratedImage(images[0]);
  }

  for (const image of images) {
    generatedGalleryEl.appendChild(createGeneratedCard(image));
  }
}

function createGeneratedCard(image: GeneratedImage): HTMLElement {
  const card = document.createElement('article');
  card.className = 'generated-card';
  if (activeGeneratedImage?.id === image.id) card.classList.add('selected');

  const img = document.createElement('img');
  img.src = image.thumbnail;
  img.alt = image.name;
  card.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'generated-meta';
  const title = document.createElement('strong');
  title.textContent = image.phrase;
  const details = document.createElement('span');
  details.textContent = `${providerStatusName(image.provider)} · ${image.type.replace('image/', '').toUpperCase()} · ${new Date(image.addedAt).toLocaleString()}`;
  meta.append(title, details);
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'generated-actions';

  const open = document.createElement('a');
  open.className = 'btn small';
  open.href = image.url;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Open';

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'btn small';
  share.textContent = 'Share';
  share.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveGeneratedImage(image);
    sharePanel.hidden = false;
    renderGeneratedGallery();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn small danger';
  remove.textContent = 'Remove';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removeGeneratedEntry(image);
  });

  actions.append(open, share, remove);
  card.appendChild(actions);
  card.addEventListener('click', () => {
    setActiveGeneratedImage(image);
    sharePanel.hidden = true;
    renderGeneratedGallery();
  });
  return card;
}

async function removeGeneratedEntry(image: GeneratedImage): Promise<void> {
  const removed = removeGeneratedImage(image.id);
  if (!removed) return;
  if (activeGeneratedImage?.id === removed.id) setActiveGeneratedImage(null);
  try {
    await deleteFromCloud(removed.provider, removed.key, loadSettings());
  } catch (e) {
    console.warn('Failed to delete generated image from cloud', e);
  }
  renderGeneratedGallery();
}

async function saveGeneratedObject(
  ref: CloudObjectRef,
  name: string,
  type: string,
  thumbnail: string,
  activate: boolean = true,
): Promise<GeneratedImage> {
  const { added, evicted } = addGeneratedImage({
    provider: ref.provider,
    key: ref.key,
    url: ref.url,
    name,
    type,
    phrase: currentPhrase(),
    thumbnail,
  });
  const settings = loadSettings();
  for (const entry of evicted) {
    try { await deleteFromCloud(entry.provider, entry.key, settings); } catch { /* best-effort */ }
  }
  if (activate) {
    setActiveGeneratedImage(added);
    renderGeneratedGallery();
  }
  return added;
}

async function saveUploadedGeneratedResults(
  refs: CloudObjectRef[],
  name: string,
  type: string,
  thumbnail: string,
): Promise<void> {
  let selected: GeneratedImage | null = null;
  for (const ref of refs) {
    const image = await saveGeneratedObject(ref, name, type, thumbnail, false);
    selected ??= image;
  }
  if (selected) {
    setActiveGeneratedImage(selected);
    renderGeneratedGallery();
  }
}

async function uploadGeneratedBlob(
  blob: Blob,
  name: string,
  type: string,
  thumbnail: string,
): Promise<GeneratedImage | null> {
  const settings = loadSettings();
  const provider = primaryProvider(settings);
  if (!provider) {
    const message = 'No cloud provider is enabled. Open Settings and enable Cloudflare R2 or Amazon S3 before saving generated results.';
    setStatus(message);
    renderUploadMessage('error', message);
    return null;
  }

  const configError = providerSettingsError(provider, settings);
  if (configError) {
    const message = `${configError} Generated result was not stored. Open Settings to correct it.`;
    setStatus(message);
    renderUploadMessage('error', message);
    return null;
  }

  try {
    renderUploadMessage('pending', `Uploading generated result to ${providerDisplayName(provider)}…`);
    const ref = await uploadToProvider(provider, blob, name, type, settings);
    const image = await saveGeneratedObject(ref, name, type, thumbnail);
    const shareHint = publicUrlBaseForProvider(provider, settings)
      ? ''
      : ' Configure Public URL Base in Settings before sharing publicly.';
    const message = `Generated result stored on ${providerDisplayName(provider)}.${shareHint}`;
    setStatus(message);
    renderUploadMessage('ok', message);
    return image;
  } catch (e) {
    const message = uploadFailureMessage(provider, e, 'Generated result');
    setStatus(message);
    renderUploadMessage('error', message);
    return null;
  }
}

renderRecentImages();
renderGeneratedGallery();

// Image upload — destination depends on the cloud-storage toggle
imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  await loadBitmapFromBlob(file);
  uploadStatusEl.innerHTML = '';

  const settings = loadSettings();

  if (settings.recentImagesInCloud) {
    const provider = primaryProvider(settings);
    if (!provider) {
      const message = 'Recent template images are set to cloud storage, but no cloud provider is enabled. Template image was not stored. Open Settings and enable Cloudflare R2 or Amazon S3.';
      setStatus(message);
      renderUploadMessage('error', message);
    } else {
      const configError = providerSettingsError(provider, settings);
      if (configError) {
        const message = `${configError} Template image was not stored in ${providerDisplayName(provider)}. Open Settings to correct it.`;
        setStatus(message);
        renderUploadMessage('error', message);
      } else {
        try {
          const filename = `template-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          setStatus(`Uploading template to ${providerDisplayName(provider)}…`);
          renderUploadMessage('pending', `Uploading template image to ${providerDisplayName(provider)}…`);
          const thumbnail = await makeThumbnail(file);
          const ref = await uploadToProvider(provider, file, filename, file.type || 'image/png', settings);
          const { evicted } = addCloudRecentImage({
            provider: ref.provider,
            key: ref.key,
            url: ref.url,
            name: file.name,
            type: file.type || 'image/png',
            thumbnail,
          });
          for (const e of evicted) {
            try { await deleteFromCloud(e.provider, e.key, settings); } catch { /* best-effort */ }
          }
          setStatus(`Template stored on ${providerDisplayName(provider)}`);
          renderUploadMessage('ok', `Template image stored on ${providerDisplayName(provider)}.`);
        } catch (e) {
          const message = uploadFailureMessage(provider, e, 'Template image');
          setStatus(message);
          renderUploadMessage('error', message);
        }
      }
    }
  } else {
    try {
      await addRecentImage(file);
    } catch (e) {
      console.warn('Failed to save recent image', e);
    }
  }

  await renderRecentImages();
});

// Start
startBtn.addEventListener('click', () => {
  if (!currentBitmap) {
    alert('Please select a source image first.');
    return;
  }

  const phrase = phraseInput.value.trim();
  if (!phrase) {
    alert('Please enter a phrase.');
    return;
  }

  painter?.stop();

  const { width, height } = currentBitmap;
  canvas.width = width;
  canvas.height = height;
  showCanvas();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const seed = seedInput.value
    ? parseInt(seedInput.value, 10)
    : Math.floor(Math.random() * 0xffffffff);

  const selectedFonts = getSelectedFonts();

  const config: PainterConfig = {
    phrase,
    fonts: selectedFonts,
    minSize: parseInt(minSizeInput.value, 10),
    maxSize: parseInt(maxSizeInput.value, 10),
    maxRotation: parseFloat(maxRotationInput.value),
    targetCoverage: parseInt(coverageInput.value, 10) / 100,
    grayShade: parseInt(grayShadeInput.value, 10),
    threshold: parseInt(thresholdInput.value, 10) / 100,
    seed,
    batchSize: parseInt(batchSizeInput.value, 10),
  };

  painter = new Painter(currentBitmap, width, height, config, {
    onFrame: (coverage, phraseCount) => {
      ctx.putImageData(painter!.getImageData(), 0, 0);
      setProgress(coverage);
      setStatus(`Painting… (${phraseCount} phrases placed)`);
    },
    onProgress: (coverage) => {
      setProgress(coverage);
    },
    onComplete: (coverage) => {
      ctx.putImageData(painter!.getImageData(), 0, 0);
      setProgress(coverage);
      setStatus(`Done — ${Math.round(coverage * 100)}% coverage, ${painter!.frames.length} frames`);
      startBtn.disabled = false;
      stopBtn.disabled = true;
      downloadPngBtn.disabled = false;
      downloadGifBtn.disabled = painter!.frames.length === 0;
      saveResultBtn.disabled = false;
    },
  });

  uploadStatusEl.innerHTML = '';
  setActiveGeneratedImage(null);
  renderGeneratedGallery();
  startBtn.disabled = true;
  stopBtn.disabled = false;
  downloadPngBtn.disabled = true;
  downloadGifBtn.disabled = true;
  saveResultBtn.disabled = true;
  setProgress(0);
  setStatus('Starting…');

  painter.start();
});

// Stop
stopBtn.addEventListener('click', () => {
  painter?.stop();
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('Stopped.');
  downloadPngBtn.disabled = false;
  downloadGifBtn.disabled = !painter || painter.frames.length === 0;
  saveResultBtn.disabled = !painter;
});

// Download PNG
downloadPngBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'halftone.png';
    a.click();
    URL.revokeObjectURL(url);
  });
});

saveResultBtn.addEventListener('click', async () => {
  if (downloadPngBtn.disabled) return;
  const origText = saveResultBtn.textContent!;
  saveResultBtn.disabled = true;
  saveResultBtn.textContent = 'Saving…';
  try {
    const blob = await canvasToBlob('image/png');
    const thumbnail = await makeThumbnail(blob);
    await uploadGeneratedBlob(blob, timestampedFilename('halftone', 'png'), 'image/png', thumbnail);
  } finally {
    saveResultBtn.disabled = downloadPngBtn.disabled;
    saveResultBtn.textContent = origText;
  }
});

shareResultBtn.addEventListener('click', () => {
  if (!activeGeneratedImage) return;
  sharePanel.hidden = !sharePanel.hidden;
});

shareMastodonBtn.addEventListener('click', () => shareGeneratedImage('mastodon'));
shareXBtn.addEventListener('click', () => shareGeneratedImage('x'));
shareFacebookBtn.addEventListener('click', () => shareGeneratedImage('facebook'));

async function encodeGif(): Promise<Blob | null> {
  if (!painter || painter.frames.length === 0) return null;
  const { frames, width, height } = painter;
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const palette = quantize(frame.data, 256);
    const index = applyPalette(frame.data, palette);
    gif.writeFrame(index, width, height, { palette, delay: 500, repeat: 0 });
    if (i % 3 === 0) {
      downloadGifBtn.textContent = `Encoding… ${Math.round(((i + 1) / frames.length) * 100)}%`;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  gif.finish();
  const bytes = gif.bytes();
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' });
}

function gifFilename(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `halftone-${stamp}.gif`;
}

function renderUploadStatus(
  results: CloudObjectRef[],
  failures: UploadFailure[],
): void {
  uploadStatusEl.innerHTML = '';
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'upload-row ok';
    const label = document.createElement('span');
    label.textContent = `${providerStatusName(r.provider)}: `;
    const link = document.createElement('a');
    link.href = r.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = r.url;
    row.append(label, link);
    uploadStatusEl.appendChild(row);
  }
  for (const f of failures) {
    const row = document.createElement('div');
    row.className = 'upload-row error';
    row.textContent = f.provider === 'r2' || f.provider === 's3'
      ? uploadFailureMessage(f.provider, f.error, 'GIF')
      : `${providerStatusName(f.provider)} upload failed: ${f.error}`;
    uploadStatusEl.appendChild(row);
  }
}

// Download GIF (and auto-upload to enabled cloud providers)
downloadGifBtn.addEventListener('click', async () => {
  if (!painter || painter.frames.length === 0) return;

  const origText = downloadGifBtn.textContent!;
  downloadGifBtn.disabled = true;

  try {
    const blob = await encodeGif();
    if (!blob) return;

    const filename = gifFilename();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    const settings = loadSettings();
    if (hasAnyEnabled(settings)) {
      downloadGifBtn.textContent = 'Uploading…';
      renderUploadMessage('pending', 'Uploading GIF to cloud storage…');
      const thumbnail = await makeCanvasThumbnail();
      const { results, failures } = await uploadToAllEnabled(blob, filename, 'image/gif', settings);
      if (results.length > 0) {
        await saveUploadedGeneratedResults(results, filename, 'image/gif', thumbnail);
      }
      renderUploadStatus(results, failures);
    }
  } finally {
    downloadGifBtn.disabled = false;
    downloadGifBtn.textContent = origText;
  }
});
