import { Painter, type PainterConfig } from './painter';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

const FONTS = [
  'Arial',
  'Georgia',
  'Courier New',
  'Times New Roman',
  'Impact',
  'Trebuchet MS',
  'Verdana',
  'Palatino Linotype',
];

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
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const placeholder = document.getElementById('placeholder') as HTMLDivElement;
const fontGrid = document.getElementById('fontGrid') as HTMLDivElement;

// Build font checkboxes
FONTS.forEach((font, i) => {
  const label = document.createElement('label');
  label.className = 'font-label';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.name = 'font';
  cb.value = font;
  cb.checked = i < 3; // Arial, Georgia, Courier New checked by default
  const span = document.createElement('span');
  span.textContent = font;
  span.style.fontFamily = font;
  label.appendChild(cb);
  label.appendChild(span);
  fontGrid.appendChild(label);
});

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
  const checked = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="font"]:checked'),
  ).map((cb) => cb.value);
  return checked.length > 0 ? checked : ['Arial'];
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

  const config: PainterConfig = {
    phrase,
    fonts: getSelectedFonts(),
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
