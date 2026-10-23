// On-device OCR for the Scan view (options page only: the popup and background never import this).
// tesseract.js runs in a Web Worker from files bundled under ocr/ (worker, WASM core, English model);
// every path is passed explicitly so nothing can fall back to a CDN. No DOM writes.
import { createWorker, OEM, PSM, type Worker as TessWorker } from 'tesseract.js';
import { replaceWords, retryTargets } from '../domain/scan';

/** One recognised word. Coordinates are SOURCE-image pixels (before any upscaling). */
export interface OcrWord { text: string; conf: number; x0: number; y0: number; x1: number; y1: number; line: number }
export interface OcrPage { width: number; height: number; words: OcrWord[]; name?: string }

export interface PreprocessOptions {
  grayscale: boolean;
  /** Invert when the central 60% x 60% region has a mean luminance below 128 (dark-mode email). */
  invertIfDark: boolean;
  /** Upscale so glyphs are about this tall (px); null = never resize. */
  targetGlyphHeight: number | null;
  /** Erase horizontal dark runs longer than 1.5x the glyph height (link underlines). */
  whitenUnderlines: boolean;
  /** Absolute upscale factor; when set it replaces the targetGlyphHeight rule (and its 3x ceiling). */
  scale?: number;
}
export const DEFAULT_PREPROCESS: PreprocessOptions = {
  grayscale: true, invertIfDark: true, targetGlyphHeight: 30, whitenUnderlines: false,
};

/** processed = source * scale + (dx, dy). */
export interface Transform { scale: number; dx: number; dy: number }
type Canvas = HTMLCanvasElement | OffscreenCanvas;

export const MAX_PIXELS = 25_000_000;
export const MAX_FILES = 4;
const MAX_PROCESSED_PIXELS = 40_000_000;
const MAX_SCALE = 3;

/** First approximation of glyph height: a phone screenshot of this email has about 60 text rows of full
 *  height, so image.height / 60. Cheap and good enough to pick an upscale; a second pass could measure it. */
export const estimateGlyphHeight = (imageHeight: number) => Math.max(1, imageHeight / 60);

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The upscale factor preprocess() applies to an image of this size. */
export function scaleFor(width: number, height: number, opts: Pick<PreprocessOptions, 'targetGlyphHeight' | 'scale'>): number {
  const glyph = estimateGlyphHeight(height);
  const wanted = opts.scale ?? (opts.targetGlyphHeight ? Math.min(MAX_SCALE, Math.max(1, opts.targetGlyphHeight / glyph)) : 1);
  return Math.min(wanted, Math.max(1, Math.sqrt(MAX_PROCESSED_PIXELS / (width * height))));
}

export function preprocess(bitmap: ImageBitmap, opts: PreprocessOptions): { canvas: Canvas; transform: Transform } {
  const glyph = estimateGlyphHeight(bitmap.height);
  const scale = scaleFor(bitmap.width, bitmap.height, opts);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const transform = { scale: w / bitmap.width, dx: 0, dy: 0 };
  if (!opts.grayscale && !opts.invertIfDark && !opts.whitenUnderlines) return { canvas, transform };

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let invert = false;
  if (opts.invertIfDark) {
    const x0 = Math.floor(w * 0.2), x1 = Math.ceil(w * 0.8), y0 = Math.floor(h * 0.2), y1 = Math.ceil(h * 0.8);
    let sum = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      sum += luminance(d[i]!, d[i + 1]!, d[i + 2]!);
    }
    invert = sum / ((x1 - x0) * (y1 - y0)) < 128;
  }
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    if (opts.grayscale) r = g = b = luminance(r, g, b);
    if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  if (opts.whitenUnderlines) whitenRuns(d, w, h, Math.round(1.5 * glyph * transform.scale));
  ctx.putImageData(img, 0, 0);
  return { canvas, transform };
}

/** Paint over horizontal runs of dark pixels at least `minRun` long (text on a light ground by now). */
function whitenRuns(d: Uint8ClampedArray, w: number, h: number, minRun: number): void {
  const dark = 150;
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const isDark = x < w && luminance(d[(y * w + x) * 4]!, d[(y * w + x) * 4 + 1]!, d[(y * w + x) * 4 + 2]!) < dark;
      if (isDark && start < 0) start = x;
      else if (!isDark && start >= 0) {
        if (x - start >= minRun) for (let k = start; k < x; k++) { const i = (y * w + k) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
        start = -1;
      }
    }
  }
}

/** Worker-space bbox -> source-image bbox. */
export function mapToSource<T extends { x0: number; y0: number; x1: number; y1: number }>(word: T, t: Transform): T {
  return {
    ...word,
    x0: Math.round((word.x0 - t.dx) / t.scale), y0: Math.round((word.y0 - t.dy) / t.scale),
    x1: Math.round((word.x1 - t.dx) / t.scale), y1: Math.round((word.y1 - t.dy) / t.scale),
  };
}

// ---- Worker singleton -----------------------------------------------------------------------

let workerPromise: Promise<TessWorker> | null = null;
let progressListener: ((p: number) => void) | undefined;
let stageListener: ((stage: string) => void) | undefined;
let appliedPsm: string = PSM.SINGLE_BLOCK;
let queue: Promise<unknown> = Promise.resolve();

/** How long the engine may take to start before we give up and say so (first start compiles 4 MB of WASM). */
export const WORKER_START_TIMEOUT_MS = 45_000;

/** Receives the engine's start-up stages ("loading tesseract core", "loading language traineddata", …). */
export function onOcrStage(listener: ((stage: string) => void) | undefined): void {
  stageListener = listener;
}

/** The shared worker, created on first use. `onProgress` (0..1) receives recognition progress. */
export function getWorker(onProgress?: (p: number) => void): Promise<TessWorker> {
  if (onProgress) progressListener = onProgress;
  workerPromise ??= (async () => {
    let lastStage = 'starting';
    const create = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: chrome.runtime.getURL('ocr/worker.min.js'),
      corePath: chrome.runtime.getURL('ocr/tesseract-core-simd-lstm.wasm.js'),
      langPath: chrome.runtime.getURL('ocr'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text') progressListener?.(m.progress);
        else if (m.status && m.status !== lastStage) {
          lastStage = m.status;
          stageListener?.(m.status);
        }
      },
    });
    // tesseract.js waits for the worker's first message forever; a worker that failed to load or
    // crashed would leave the page on "Loading…" with no error, so we give it a deadline.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The OCR engine did not start within ${WORKER_START_TIMEOUT_MS / 1000} s (last stage: ${lastStage}). Reload the extension at chrome://extensions and try again.`)),
        WORKER_START_TIMEOUT_MS,
      );
    });
    try {
      const worker = await Promise.race([create, deadline]);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1', user_defined_dpi: '300' });
      appliedPsm = PSM.SINGLE_BLOCK;
      return worker;
    } catch (e) {
      // A worker that eventually does start after the deadline must not linger.
      create.then((w) => w.terminate()).catch(() => undefined);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  })();
  const mine = workerPromise;
  mine.catch(() => { if (workerPromise === mine) workerPromise = null; });
  return mine;
}

/** Terminate the worker; the next getWorker() builds a fresh one. */
export function disposeWorker(): void {
  const p = workerPromise;
  workerPromise = null;
  progressListener = undefined;
  queue = Promise.resolve(); // a job on the terminated worker never settles; don't let it block the next one
  p?.then((w) => w.terminate()).catch(() => undefined);
}

const abortError = () => new DOMException('OCR cancelled', 'AbortError');
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// ---- Recognition ----------------------------------------------------------------------------

export interface RecognizeOptions {
  preprocess?: Partial<PreprocessOptions>;
  psm?: number;
  /** In SOURCE pixels. */
  rectangle?: { left: number; top: number; width: number; height: number };
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
}

export async function recognizePage(file: Blob | ImageBitmap, opts: RecognizeOptions = {}): Promise<OcrPage> {
  const { signal } = opts;
  if (signal?.aborted) throw abortError();
  const owned = !(typeof ImageBitmap !== 'undefined' && file instanceof ImageBitmap);
  const bitmap = owned ? await createImageBitmap(file as Blob) : (file as ImageBitmap);
  let canvas: Canvas | undefined;
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('Image is too large (over 25 megapixels)');
    if (signal?.aborted) throw abortError();
    const pre = preprocess(bitmap, { ...DEFAULT_PREPROCESS, ...opts.preprocess });
    canvas = pre.canvas;
    const t = pre.transform;
    const r = opts.rectangle;
    const rectangle = r && {
      left: Math.round(r.left * t.scale + t.dx), top: Math.round(r.top * t.scale + t.dy),
      width: Math.round(r.width * t.scale), height: Math.round(r.height * t.scale),
    };
    const job = queue.then(async () => {
      if (signal?.aborted) throw abortError();
      const worker = await getWorker(opts.onProgress);
      progressListener = opts.onProgress;
      const psm = String(opts.psm ?? PSM.SINGLE_BLOCK);
      if (psm !== appliedPsm) { await worker.setParameters({ tessedit_pageseg_mode: psm as PSM }); appliedPsm = psm; }
      return worker.recognize(canvas!, rectangle ? { rectangle } : {}, { blocks: true });
    });
    queue = job.catch(() => undefined);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    let result;
    try {
      result = await Promise.race([job, aborted]);
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      job.catch(() => undefined); // a late result or failure after an abort is ignored
    }
    if (signal?.aborted) throw abortError();
    const words: OcrWord[] = [];
    let line = 0;
    for (const block of result.data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const ln of para.lines) {
          for (const w of ln.words) {
            if (!w.text.trim()) continue;
            words.push(mapToSource({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line }, t));
          }
          line++;
        }
    return { width: bitmap.width, height: bitmap.height, words, ...(file instanceof File ? { name: file.name } : {}) };
  } catch (e) {
    if (!isAbort(e) && canvas) disposeWorker(); // a worker that threw is not trusted again
    throw e;
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (owned) bitmap.close();
  }
}

// ---- Controller -----------------------------------------------------------------------------

/** At most this many unclear value lines get a second, zoomed read. */
export const MAX_RETRIES = 16;

export function createScanController() {
  let current: AbortController | null = null;
  return {
    /**
     * Sequential. A newer scan() cancels an older one that is still running. With `onRetry`, value lines the first
     * pass read with low confidence are re-read zoomed in as single lines (reported as done/total) and swapped in
     * when the second reading is better; the retry phase is cancelled and disposed like the first pass.
     */
    async scan(files: File[], onProgress: (index: number, p: number) => void, onRetry?: (done: number, total: number) => void): Promise<OcrPage[]> {
      if (files.length > MAX_FILES) throw new RangeError(`At most ${MAX_FILES} screenshots per scan`);
      current?.abort();
      const ctl = (current = new AbortController());
      const pages: OcrPage[] = [];
      try {
        for (const [i, file] of files.entries()) pages.push(await recognizePage(file, { signal: ctl.signal, onProgress: (p) => onProgress(i, p) }));
        if (onRetry) {
          const targets = retryTargets(pages).slice(0, MAX_RETRIES);
          for (const [n, target] of targets.entries()) {
            onRetry(n, targets.length);
            const page = pages[target.page]!;
            const { box } = target;
            try {
              const again = await recognizePage(files[target.page]!, {
                signal: ctl.signal,
                psm: Number(PSM.SINGLE_LINE),
                rectangle: { left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 },
                preprocess: { scale: 2 * scaleFor(page.width, page.height, DEFAULT_PREPROCESS) },
              });
              pages[target.page] = replaceWords(page, box, again.words) as OcrPage;
            } catch (e) {
              if (isAbort(e)) throw e; // a failed second look never fails the scan; the first reading stands
            }
          }
          if (targets.length) onRetry(targets.length, targets.length);
        }
      } finally {
        if (current === ctl) current = null;
      }
      return pages;
    },
    /** Abort the running scan. Recognition cannot be interrupted, so the worker is dropped too. */
    cancel(): void {
      if (!current) return;
      current.abort();
      current = null;
      disposeWorker();
    },
    dispose(): void {
      current?.abort();
      current = null;
      disposeWorker();
    },
  };
}
