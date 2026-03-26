import { Painter, type PainterConfig } from './painter';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

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

  // Baseline fonts that should always be different
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';

  // Measure baseline widths
  const baseWidths = new Map<string, number>();
  for (const baseFont of baseFonts) {
    ctx.font = `${testSize} ${baseFont}`;
    baseWidths.set(baseFont, ctx.measureText(testString).width);
  }

  const available: string[] = [];

  for (const font of testFonts) {
    let isAvailable = false;

    // Test against each baseline font
    for (const baseFont of baseFonts) {
      ctx.font = `${testSize} "${font}", ${baseFont}`;
      const width = ctx.measureText(testString).width;

      // If width differs from baseline, the font is available
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

// Detect available fonts on page load
const AVAILABLE_FONTS = detectAvailableFonts(COMMON_FONTS);

let painter: Painter | null = null;
let currentBitmap: ImageBitmap | null = null;

const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
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
const shareTwitterBtn = document.getElementById('shareTwitterBtn') as HTMLButtonElement;
const shareFacebookBtn = document.getElementById('shareFacebookBtn') as HTMLButtonElement;
const shareMastodonBtn = document.getElementById('shareMastodonBtn') as HTMLButtonElement;
const includeLinkCheck = document.getElementById('includeLinkCheck') as HTMLInputElement;
const mastodonInstanceInput = document.getElementById('mastodonInstance') as HTMLInputElement;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const placeholder = document.getElementById('placeholder') as HTMLDivElement;

const PROJECT_URL = 'https://siredvin.github.io/ProceduralImagePainter/';
const SHARE_TEXT = 'I created typographic halftone art using Procedural Image Painter!';

function openShareWindow(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
}

function enableShareButtons() {
  shareTwitterBtn.disabled = false;
  shareFacebookBtn.disabled = false;
  shareMastodonBtn.disabled = false;
}

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
  // Return all detected fonts, or fallback to Arial if none detected
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

// Image upload
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  imagePreview.src = url;
  imagePreview.style.display = 'block';

  createImageBitmap(file).then((bmp) => {
    currentBitmap = bmp;
    URL.revokeObjectURL(url);
  });
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

  // Fill white while loading
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
      enableShareButtons();
    },
  });

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
  enableShareButtons();
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

// Download GIF
downloadGifBtn.addEventListener('click', async () => {
  if (!painter || painter.frames.length === 0) return;

  const origText = downloadGifBtn.textContent!;
  downloadGifBtn.disabled = true;

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
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'halftone.gif';
  a.click();
  URL.revokeObjectURL(url);

  downloadGifBtn.disabled = false;
  downloadGifBtn.textContent = origText;
});

// Share on Twitter / X
shareTwitterBtn.addEventListener('click', () => {
  const params = new URLSearchParams({ text: SHARE_TEXT });
  if (includeLinkCheck.checked) params.set('url', PROJECT_URL);
  openShareWindow(`https://twitter.com/intent/tweet?${params}`);
});

// Share on Facebook
shareFacebookBtn.addEventListener('click', () => {
  const params = new URLSearchParams({ quote: SHARE_TEXT });
  if (includeLinkCheck.checked) params.set('u', PROJECT_URL);
  openShareWindow(`https://www.facebook.com/sharer/sharer.php?${params}`);
});

// Share on Mastodon
shareMastodonBtn.addEventListener('click', () => {
  const rawInstance = mastodonInstanceInput.value.trim() || 'mastodon.social';
  const instance = rawInstance.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const text = includeLinkCheck.checked ? `${SHARE_TEXT} ${PROJECT_URL}` : SHARE_TEXT;
  const params = new URLSearchParams({ text });
  openShareWindow(`https://${instance}/share?${params}`);
});
