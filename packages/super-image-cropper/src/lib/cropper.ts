import { decompressFrame } from 'gifuct-js';
import type { ParsedGif, ParsedFrame } from 'gifuct-js';
import type { ICommonCropOptions } from '../index';
import type { WebPAnimation, WebPFrame } from './webp';

export interface IFrameCropperProps {
  commonCropOptions: ICommonCropOptions;
}

export class FrameCropper {
  public readonly outputCanvas = document.createElement('canvas');
  private readonly compositeCanvas = document.createElement('canvas');
  private readonly patchCanvas = document.createElement('canvas');
  private readonly outputContext = this.outputCanvas.getContext('2d', {willReadFrequently: true})!;
  private readonly compositeContext = this.compositeCanvas.getContext('2d', {willReadFrequently: true})!;
  private readonly patchContext = this.patchCanvas.getContext('2d')!;
  private commonCropOptions!: ICommonCropOptions;
  private imageTransform!: [number, number, number, number, number, number];

  constructor(props: IFrameCropperProps) {
    this.init(props);
  }

  public init({commonCropOptions}: IFrameCropperProps): void {
    this.commonCropOptions = commonCropOptions;
    this.outputCanvas.width = commonCropOptions.outputWidth;
    this.outputCanvas.height = commonCropOptions.outputHeight;
    this.compositeCanvas.width = commonCropOptions.imageData.naturalWidth;
    this.compositeCanvas.height = commonCropOptions.imageData.naturalHeight;
    const {cropperJsOpts: crop, imageData} = commonCropOptions;
    const angle = (crop.rotate * Math.PI) / 180;
    const width = imageData.naturalWidth;
    const height = imageData.naturalHeight;
    this.imageTransform = commonCropOptions.imageTransform || [
      Math.cos(angle) * crop.scaleX,
      Math.sin(angle) * crop.scaleX,
      -Math.sin(angle) * crop.scaleY,
      Math.cos(angle) * crop.scaleY,
      (Math.abs(width * crop.scaleX * Math.cos(angle)) + Math.abs(height * crop.scaleY * Math.sin(angle))) / 2,
      (Math.abs(width * crop.scaleX * Math.sin(angle)) + Math.abs(height * crop.scaleY * Math.cos(angle))) / 2,
    ];
  }

  public async cropGif(gif: ParsedGif, signal: AbortSignal, onFrame: (frame: ImageData, delay: number) => void): Promise<void> {
    const frames = gif.frames.filter((frame): frame is Extract<ParsedGif['frames'][number], {image: unknown}> => 'image' in frame);
    if (!frames.length) throw new Error('The GIF contains no image frames.');
    const background = gif.gct?.[gif.lsd.backgroundColorIndex];
    const first = frames[0].gce;
    const transparentBackground = first?.extras.transparentColorGiven && first.transparentColorIndex === gif.lsd.backgroundColorIndex;
    this.compositeContext.clearRect(0, 0, gif.lsd.width, gif.lsd.height);
    if (background) this.compositeContext.fillStyle = 'rgb(' + background.join(' ') + ')';
    if (background && !transparentBackground) this.compositeContext.fillRect(0, 0, gif.lsd.width, gif.lsd.height);

    let previous: {frame: ParsedFrame; transparentBackground: boolean} | undefined;
    let restorePrevious: ImageData | undefined;
    for (const frame of frames) {
      if (signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
      if (previous?.frame.disposalType === 2) {
        const {left, top, width, height} = previous.frame.dims;
        this.compositeContext.clearRect(left, top, width, height);
        if (background && !previous.transparentBackground) this.compositeContext.fillRect(left, top, width, height);
      } else if (previous?.frame.disposalType === 3 && restorePrevious) {
        this.compositeContext.putImageData(restorePrevious, 0, 0);
      }
      restorePrevious = undefined;
      const parsed = decompressFrame(frame, gif.gct, true);
      if (parsed.disposalType === 3) restorePrevious = this.compositeContext.getImageData(0, 0, gif.lsd.width, gif.lsd.height);
      this.patchCanvas.width = parsed.dims.width;
      this.patchCanvas.height = parsed.dims.height;
      const patch = this.patchContext.createImageData(parsed.dims.width, parsed.dims.height);
      patch.data.set(parsed.patch);
      this.patchContext.putImageData(patch, 0, 0);
      this.compositeContext.drawImage(this.patchCanvas, parsed.dims.left, parsed.dims.top);
      onFrame(this.transformFrame(this.compositeCanvas), (frame.gce?.delay ?? 0) * 10);
      previous = {
        frame: parsed,
        transparentBackground: !!(frame.gce?.extras.transparentColorGiven && frame.gce.transparentColorIndex === gif.lsd.backgroundColorIndex),
      };
      previous.frame.patch = new Uint8ClampedArray(0);
      previous.frame.pixels = [];
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
  }

  public cropStaticImage(image: CanvasImageSource): ImageData {
    return this.transformFrame(image);
  }

  public async cropWebP(animation: WebPAnimation, signal: AbortSignal, onFrame: (frame: ImageData, duration: number) => Promise<void>): Promise<void> {
    this.compositeContext.clearRect(0, 0, animation.width, animation.height);
    let previous: WebPFrame | undefined;
    for (const frame of animation.frames) {
      if (signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
      if (previous?.dispose) this.compositeContext.clearRect(previous.x, previous.y, previous.width, previous.height);
      const image = await createImageBitmap(frame.blob);
      try {
        if (signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
        if (!frame.blend) this.compositeContext.clearRect(frame.x, frame.y, frame.width, frame.height);
        this.compositeContext.drawImage(image, frame.x, frame.y);
        await onFrame(this.transformFrame(this.compositeCanvas), frame.duration);
      } finally {
        image.close();
      }
      previous = frame;
    }
    if (signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
  }

  private transformFrame(image: CanvasImageSource): ImageData {
    const {cropperJsOpts: crop, imageData, outputWidth, outputHeight} = this.commonCropOptions;
    const width = imageData.naturalWidth;
    const height = imageData.naturalHeight;
    this.outputContext.clearRect(0, 0, outputWidth, outputHeight);
    if (crop.background) {
      this.outputContext.fillStyle = crop.background;
      this.outputContext.fillRect(0, 0, outputWidth, outputHeight);
    }
    this.outputContext.save();
    this.outputContext.scale(outputWidth / crop.width, outputHeight / crop.height);
    this.outputContext.translate(-crop.x, -crop.y);
    this.outputContext.transform(...this.imageTransform);
    this.outputContext.drawImage(image, -width / 2, -height / 2);
    this.outputContext.restore();
    return this.outputContext.getImageData(0, 0, outputWidth, outputHeight);
  }

  public destroy(): void {
    for (const canvas of [this.outputCanvas, this.compositeCanvas, this.patchCanvas]) {
      canvas.width = canvas.height = 0;
      canvas.remove();
    }
  }
}
