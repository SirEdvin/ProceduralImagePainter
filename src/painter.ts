export interface PainterConfig {
  phrase: string;
  fonts: string[];
  minSize: number;
  maxSize: number;
  maxRotation: number;
  targetCoverage: number;
  grayShade: number;
  threshold: number;
  seed: number;
  batchSize: number;
}

export interface PainterCallbacks {
  onFrame: (coverage: number, phraseCount: number) => void;
  onComplete: (coverage: number) => void;
  onProgress: (coverage: number, iterations: number) => void;
}

interface TextMask {
  pixels: Int16Array;
  count: number;
}

// Mulberry32 seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

function renderTextMask(phrase: string, font: string, size: number, angle: number): TextMask {
  const measureCanvas = new OffscreenCanvas(1, 1);
  const measureCtx = measureCanvas.getContext('2d')!;
  measureCtx.font = `${size}px ${font}`;
  const metrics = measureCtx.measureText(phrase);

  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(size * 1.5);
  const diagonal = Math.ceil(Math.sqrt(textWidth * textWidth + textHeight * textHeight)) + 4;
  const canvasSize = diagonal * 2;

  const canvas = new OffscreenCanvas(canvasSize, canvasSize);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(diagonal, diagonal);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(phrase, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
  const data = imageData.data;

  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 128) count++;
  }

  const pixels = new Int16Array(count * 2);
  let idx = 0;
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      if (data[(y * canvasSize + x) * 4 + 3] > 128) {
        pixels[idx++] = x - diagonal;
        pixels[idx++] = y - diagonal;
      }
    }
  }

  return { pixels, count };
}

export class Painter {
  readonly width: number;
  readonly height: number;
  readonly frames: ImageData[] = [];

  private sourceLum: Float32Array;
  private canvasData: Uint8ClampedArray;
  private coverageMask: Uint8Array;
  private coverageCount = 0;
  private iteration = 0;
  private phraseCount = 0;
  private stallCounter = 0;
  private nextFrameThreshold = 1;
  private lastCaptured = -1;
  private rng: () => number;
  private running = false;
  private rafId = 0;

  constructor(
    source: ImageBitmap,
    width: number,
    height: number,
    private config: PainterConfig,
    private callbacks: PainterCallbacks,
  ) {
    this.width = width;
    this.height = height;

    const tempCanvas = new OffscreenCanvas(width, height);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(source, 0, 0, width, height);
    const imgData = tempCtx.getImageData(0, 0, width, height);

    this.sourceLum = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = imgData.data[i * 4];
      const g = imgData.data[i * 4 + 1];
      const b = imgData.data[i * 4 + 2];
      this.sourceLum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    this.canvasData = new Uint8ClampedArray(width * height * 4).fill(255);
    this.coverageMask = new Uint8Array(width * height);
    this.rng = mulberry32(config.seed);
  }

  getImageData(): ImageData {
    return new ImageData(this.canvasData.slice(), this.width, this.height);
  }

  getCurrentCoverage(): number {
    return this.coverageCount / (this.width * this.height);
  }

  private paintMask(cx: number, cy: number, mask: TextMask): number {
    const { pixels, count } = mask;
    const { grayShade, threshold } = this.config;
    let newPixels = 0;

    for (let i = 0; i < count; i++) {
      const px = cx + pixels[i * 2];
      const py = cy + pixels[i * 2 + 1];

      if (px < 0 || px >= this.width || py < 0 || py >= this.height) continue;

      const pixelIdx = py * this.width + px;
      const color = this.sourceLum[pixelIdx] < threshold ? 0 : grayShade;

      const dataIdx = pixelIdx * 4;
      this.canvasData[dataIdx] = color;
      this.canvasData[dataIdx + 1] = color;
      this.canvasData[dataIdx + 2] = color;
      this.canvasData[dataIdx + 3] = 255;

      if (!this.coverageMask[pixelIdx]) {
        this.coverageMask[pixelIdx] = 1;
        newPixels++;
      }
    }

    return newPixels;
  }

  start(): void {
    this.running = true;
    this.rafId = requestAnimationFrame(() => this.step());
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private step(): void {
    if (!this.running) return;

    const totalPixels = this.width * this.height;
    const maxStall = 5000;

    for (let b = 0; b < this.config.batchSize; b++) {
      const coverage = this.coverageCount / totalPixels;

      if (coverage >= this.config.targetCoverage || this.stallCounter >= maxStall) {
        if (this.phraseCount > this.lastCaptured) {
          this.frames.push(this.getImageData());
        }
        this.running = false;
        this.callbacks.onComplete(coverage);
        return;
      }

      this.iteration++;

      const angle = randFloat(this.rng, -this.config.maxRotation, this.config.maxRotation);
      const size = randInt(this.rng, this.config.minSize, this.config.maxSize);
      const font = this.config.fonts[Math.floor(this.rng() * this.config.fonts.length)];

      const mask = renderTextMask(this.config.phrase, font, size, angle);
      if (mask.count === 0) continue;

      // Compute half-extents to constrain placement within canvas
      let minX = 0, maxX = 0, minY = 0, maxY = 0;
      for (let i = 0; i < mask.count; i++) {
        const px = mask.pixels[i * 2];
        const py = mask.pixels[i * 2 + 1];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const halfW = Math.max(-minX, maxX);
      const halfH = Math.max(-minY, maxY);

      const cx = randInt(this.rng, halfW, Math.max(halfW, this.width - 1 - halfW));
      const cy = randInt(this.rng, halfH, Math.max(halfH, this.height - 1 - halfH));

      const newPixels = this.paintMask(cx, cy, mask);
      this.coverageCount += newPixels;
      this.phraseCount++;

      if (this.phraseCount >= this.nextFrameThreshold) {
        this.frames.push(this.getImageData());
        this.lastCaptured = this.phraseCount;
        this.nextFrameThreshold =
          this.phraseCount + Math.max(1, Math.floor(this.phraseCount / 4));
        this.callbacks.onFrame(this.coverageCount / totalPixels, this.phraseCount);
      }

      if (newPixels === 0) {
        this.stallCounter++;
      } else {
        this.stallCounter = 0;
      }
    }

    this.callbacks.onProgress(this.coverageCount / totalPixels, this.iteration);
    this.rafId = requestAnimationFrame(() => this.step());
  }
}
