import { Painter, type PainterConfig } from './painter';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { loadSettings, hasAnyEnabled } from './settings';
import { uploadToAllEnabled } from './cloudUpload';
import {
  addRecentImage,
  deleteRecentImage,
  getRecentImage,
  listRecentImages,
  type RecentImage,
} from './recentImages';
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
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const placeholder = document.getElementById('placeholder') as HTMLDivElement;
const uploadStatusEl = document.getElementById('uploadStatus') as HTMLDivElement;

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

// Recent images strip
async function renderRecentImages() {
  const items = await listRecentImages();
  recentImagesEl.innerHTML = '';
  if (items.length === 0) {
    recentImagesEl.style.display = 'none';
    return;
  }
  recentImagesEl.style.display = 'flex';
  for (const item of items) {
    recentImagesEl.appendChild(createRecentImageEl(item));
  }
}

function createRecentImageEl(item: RecentImage): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'recent-image';
  wrap.title = item.name;

  const img = document.createElement('img');
  img.src = item.thumbnail;
  img.alt = item.name;
  wrap.appendChild(img);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'recent-remove';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteRecentImage(item.id);
    await renderRecentImages();
  });
  wrap.appendChild(remove);

  wrap.addEventListener('click', async () => {
    const fresh = await getRecentImage(item.id);
    if (!fresh) return;
    await loadBitmapFromBlob(fresh.blob, fresh.thumbnail);
    setStatus(`Loaded "${fresh.name}"`);
  });

  return wrap;
}

renderRecentImages();

// Image upload
imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  await loadBitmapFromBlob(file);
  try {
    await addRecentImage(file);
    await renderRecentImages();
  } catch (e) {
    console.warn('Failed to save recent image', e);
  }
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
    },
  });

  uploadStatusEl.innerHTML = '';
  startBtn.disabled = true;
  stopBtn.disabled = false;
  downloadPngBtn.disabled = true;
  downloadGifBtn.disabled = true;
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
  results: { provider: string; url: string }[],
  failures: { provider: string; error: string }[],
): void {
  uploadStatusEl.innerHTML = '';
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'upload-row ok';
    const label = document.createElement('span');
    label.textContent = `${r.provider.toUpperCase()}: `;
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
    row.textContent = `${f.provider.toUpperCase()} upload failed: ${f.error}`;
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
      uploadStatusEl.innerHTML = '<div class="upload-row pending">Uploading to cloud storage…</div>';
      const { results, failures } = await uploadToAllEnabled(blob, filename, 'image/gif', settings);
      renderUploadStatus(results, failures);
    }
  } finally {
    downloadGifBtn.disabled = false;
    downloadGifBtn.textContent = origText;
  }
});
