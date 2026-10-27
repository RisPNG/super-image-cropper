import workerSource from './webp.worker?worker';

export class WebPEncoder {
  private worker?: Worker;
  private workerUrl?: string;
  private reject?: (reason: Error) => void;
  private readonly onAbort = () => this.destroy();

  constructor(private readonly signal: AbortSignal) {
    this.workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: 'application/javascript' })
    );
    try {
      this.worker = new Worker(this.workerUrl);
    } catch (error) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = undefined;
      throw error;
    }
    this.worker.onerror = () => {
      this.reject?.(new Error('The WebP encoding worker failed.'));
      this.destroy();
    };
    signal.addEventListener('abort', this.onAbort, { once: true });
  }

  public encode(frame: ImageData): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (this.signal.aborted || !this.worker) {
        reject(new DOMException('The image operation was aborted.', 'AbortError'));
        return;
      }
      this.reject = reject;
      this.worker.onmessage = ({ data }: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => {
        this.reject = undefined;
        if (data.error) reject(new Error(data.error));
        else resolve(data.bytes!);
      };
      this.worker.postMessage({ data: frame.data, width: frame.width, height: frame.height }, [
        frame.data.buffer
      ]);
    });
  }

  public destroy(): void {
    this.signal.removeEventListener('abort', this.onAbort);
    this.reject?.(new DOMException('The image operation was aborted.', 'AbortError'));
    this.reject = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = undefined;
  }
}
