import { transformToUrl as gifWorkerTransformToUrl } from 'gif-build-worker-js';
import GIF from 'gif.js';
import type { ICommonCropOptions, IGifOpts } from '../index';

type NativeGIF = GIF & {
  frames: {delay: number; data?: Uint8ClampedArray}[];
  freeWorkers: Worker[];
  activeWorkers: Worker[];
  imageParts?: unknown[];
  running: boolean;
};

export interface IFrameCropperProps {
  commonCropOptions: ICommonCropOptions;
  repeat: number;
  gifJsOptions?: IGifOpts;
  signal: AbortSignal;
}

export class SyntheticGIF {
  public readonly gif: NativeGIF;
  private workerUrl?: string;
  private reject?: (reason: Error) => void;
  private readonly signal: AbortSignal;
  private readonly onAbort = () => this.destroy();

  constructor({commonCropOptions, repeat, gifJsOptions = {}, signal}: IFrameCropperProps) {
    this.signal = signal;
    if (!gifJsOptions.workerScript) this.workerUrl = gifWorkerTransformToUrl();
    this.gif = new GIF({
      workers: 2,
      quality: 10,
      ...gifJsOptions,
      workerScript: gifJsOptions.workerScript || this.workerUrl,
      width: commonCropOptions.outputWidth,
      height: commonCropOptions.outputHeight,
      repeat: gifJsOptions.repeat ?? repeat,
      transparent: gifJsOptions.transparent ?? null,
    } as GIF.Options) as NativeGIF;
    signal.addEventListener('abort', this.onAbort, {once: true});
  }

  public bootstrap(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.reject = reject;
      if (this.signal.aborted) {
        this.destroy();
        return;
      }
      this.gif.once('finished', (blob: Blob) => resolve(blob));
      this.gif.once('abort', () => reject(new DOMException('The image operation was aborted.', 'AbortError')));
      this.gif.render();
      for (const worker of [...this.gif.activeWorkers, ...this.gif.freeWorkers]) {
        worker.onerror = () => {
          reject(new Error('The GIF encoding worker failed.'));
          this.destroy();
        };
      }
    });
  }

  public destroy(): void {
    this.signal.removeEventListener('abort', this.onAbort);
    this.reject?.(new DOMException('The image operation was aborted.', 'AbortError'));
    this.reject = undefined;
    this.gif.abort();
    for (const worker of this.gif.freeWorkers) worker.terminate();
    this.gif.freeWorkers.length = this.gif.activeWorkers.length = this.gif.frames.length = 0;
    if (this.gif.imageParts) this.gif.imageParts.length = 0;
    this.gif.removeAllListeners();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = undefined;
  }
}
