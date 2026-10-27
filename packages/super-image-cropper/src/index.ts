import type Cropper from 'cropperjs';
import type { ParsedGif } from 'gifuct-js';
import { Decoder } from './lib/decoder';
import { SyntheticGIF } from './lib/synthetic-gif';
import { FrameCropper } from './lib/cropper';
import { getImageType } from './lib/helper';
import { WebPAnimation } from './lib/webp';
import { WebPEncoder } from './lib/webp-encoder';

export interface CustomCropper {
  url?: string;
  getData(): ICropOpts;
  getCropBoxData?(): ICropOpts;
  cropBoxData?: IImageData;
  canvasData?: IImageData;
  cropper?: HTMLDivElement;
}

export enum OutputType {
  BASE64 = 'base64',
  BLOB = 'blob',
  BLOB_URL = 'blobURL',
}

export type IOutputTypeUnion = `${OutputType}`;
export interface ICropperOptions {
  cropperInstance?: CustomCropper | Cropper;
  src?: string;
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  cropperJsOpts?: ICropOpts;
  gifJsOptions?: IGifOpts;
  outputType?: IOutputTypeUnion;
  outputWidth?: number;
  outputHeight?: number;
  signal?: AbortSignal;
}

export interface IGifOpts {
  repeat?: number;
  quality?: number;
  workers?: number;
  workerScript?: string;
  background?: string;
  width?: number;
  height?: number;
  transparent?: number | null;
  dither?: boolean;
  debug?: boolean;
}

export interface ICropOpts {
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  x?: number;
  y?: number;
  background?: string;
  rotate?: number;
  left?: number;
  top?: number;
}

export interface IImageData {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface ICommonCropOptions {
  cropperJsOpts: Required<ICropOpts>;
  imageData: IImageData;
  cropBoxData: ICropOpts;
  imageTransform?: [number, number, number, number, number, number];
  outputWidth: number;
  outputHeight: number;
}

interface CropOperation {
  controller: AbortController;
  sourceSignal?: AbortSignal;
  onAbort: () => void;
  frameCropper?: FrameCropper;
  decoder?: Decoder;
  syntheticGIF?: SyntheticGIF;
  webp?: WebPAnimation;
  webpEncoder?: WebPEncoder;
  image?: ImageBitmap;
  reader?: FileReader;
}

export class SuperImageCropper {
  private operation?: CropOperation;
  private outputUrls = new Set<string>();

  public async crop(options: ICropperOptions): Promise<string | Blob> {
    const cropper = options.cropperInstance;
    const cropperImage = cropper && 'getCropperImage' in cropper ? cropper.getCropperImage() : null;
    const legacyCropper = cropper && 'getData' in cropper ? cropper : null;
    const src = options.src || legacyCropper?.url || cropperImage?.getAttribute('src');
    if (!src || (!cropper && !options.cropperJsOpts)) {
      throw new Error('Specify an image source and crop options or a Cropper instance.');
    }
    for (const dimension of [options.outputWidth, options.outputHeight]) {
      if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) {
        throw new Error('Output dimensions must be positive integers.');
      }
    }

    if (this.operation) this.releaseOperation(this.operation);
    const controller = new AbortController();
    const operation: CropOperation = {
      controller,
      sourceSignal: options.signal,
      onAbort: () => controller.abort(),
    };
    this.operation = operation;
    options.signal?.addEventListener('abort', operation.onAbort, {once: true});
    if (options.signal?.aborted) controller.abort();

    try {
      const response = await fetch(src, {signal: controller.signal, credentials: options.crossOrigin === 'use-credentials' ? 'include' : 'same-origin'});
      if (!response.ok) throw new Error('The image source could not be loaded.');
      const sourceBlob = await response.blob();
      const bytes = await sourceBlob.arrayBuffer();
      const imageType = await getImageType(bytes);
      if (controller.signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');

      const isGIF = imageType?.mime === 'image/gif';
      operation.webp = imageType?.mime === 'image/webp' ? WebPAnimation.decode(bytes) : undefined;
      let width: number;
      let height: number;
      let gif: ParsedGif | undefined;
      if (isGIF) {
        operation.decoder = new Decoder(bytes);
        gif = operation.decoder.decode();
        width = gif.lsd.width;
        height = gif.lsd.height;
      } else if (operation.webp) {
        width = operation.webp.width;
        height = operation.webp.height;
      } else {
        let rasterBlob = sourceBlob;
        if (imageType?.mime === 'image/jpeg' && legacyCropper?.url !== src && legacyCropper?.url?.startsWith('data:image/jpeg;')) {
          const rasterResponse = await fetch(legacyCropper.url, {signal: controller.signal});
          if (!rasterResponse.ok) throw new Error('The normalized JPEG source could not be loaded.');
          rasterBlob = await rasterResponse.blob();
        }
        operation.image = await createImageBitmap(rasterBlob);
        if (controller.signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
        width = operation.image.width;
        height = operation.image.height;
      }
      let data = {...options.cropperJsOpts, ...legacyCropper?.getData()};
      let imageTransform: ICommonCropOptions['imageTransform'];
      let sourceScale = 1;
      if (cropperImage && cropper && 'getCropperSelection' in cropper) {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const onAbort = () => reject(new DOMException('The image operation was aborted.', 'AbortError'));
          controller.signal.addEventListener('abort', onAbort, {once: true});
          cropperImage.$ready().then(result => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(result);
          }, error => {
            controller.signal.removeEventListener('abort', onAbort);
            reject(error);
          });
        });
        if (controller.signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');
        const selection = cropper.getCropperSelection();
        if (!selection || !selection.width || !selection.height) throw new Error('Select an image area before cropping.');
        const [a, b, c, d, e, f] = cropperImage.$getTransform();
        imageTransform = [a, b, c, d, e + image.naturalWidth / 2, f + image.naturalHeight / 2];
        sourceScale = Math.sqrt(Math.abs(a * d - b * c));
        data = {...data, x: selection.x, y: selection.y, width: selection.width, height: selection.height};
      }
      const angle = ((data.rotate || 0) * Math.PI) / 180;
      const scaleX = data.scaleX ?? 1;
      const scaleY = data.scaleY ?? 1;
      const cropWidth = data.width ?? Math.abs(width * scaleX * Math.cos(angle)) + Math.abs(height * scaleY * Math.sin(angle));
      const cropHeight = data.height ?? Math.abs(width * scaleX * Math.sin(angle)) + Math.abs(height * scaleY * Math.cos(angle));
      const outputWidth = options.outputWidth ?? Math.max(1, Math.round(options.outputHeight ? options.outputHeight * cropWidth / cropHeight : cropWidth / sourceScale));
      const outputHeight = options.outputHeight ?? Math.max(1, Math.round(options.outputWidth ? options.outputWidth * cropHeight / cropWidth : cropHeight / sourceScale));
      const commonCropOptions: ICommonCropOptions = {
        cropperJsOpts: {
          width: cropWidth,
          height: cropHeight,
          x: data.x ?? 0,
          y: data.y ?? 0,
          left: data.x ?? 0,
          top: data.y ?? 0,
          scaleX,
          scaleY,
          rotate: data.rotate ?? 0,
          background: data.background ?? '',
        },
        imageData: {width, height, naturalWidth: width, naturalHeight: height},
        cropBoxData: legacyCropper?.getCropBoxData?.() || data,
        imageTransform,
        outputWidth,
        outputHeight,
      };
      operation.frameCropper = new FrameCropper({commonCropOptions});

      let blob: Blob;
      if (gif) {
        const application = gif.frames.find(frame => 'application' in frame && ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(frame.application.id));
        const loop = application && 'application' in application ? application.application.blocks : undefined;
        const repeat = loop?.[0] === 1 ? loop[1] | (loop[2] << 8) : -1;
        operation.syntheticGIF = new SyntheticGIF({
          commonCropOptions,
          repeat,
          gifJsOptions: options.gifJsOptions,
          signal: controller.signal,
        });
        const encoder = operation.syntheticGIF.gif;
        await operation.frameCropper.cropGif(gif, controller.signal, (frame, delay) => {
          encoder.addFrame(frame, {delay, copy: false});
          encoder.frames[encoder.frames.length - 1].delay = delay;
        });
        operation.frameCropper.destroy();
        operation.frameCropper = undefined;
        operation.decoder!.destroy();
        operation.decoder = undefined;
        blob = await operation.syntheticGIF.bootstrap();
      } else if (operation.webp) {
        operation.webpEncoder = new WebPEncoder(controller.signal);
        const frames: {bytes: Uint8Array; duration: number}[] = [];
        await operation.frameCropper.cropWebP(operation.webp, controller.signal, async (frame, duration) => {
          frames.push({bytes: await operation.webpEncoder!.encode(frame), duration});
        });
        blob = operation.webp.createBlob(frames, outputWidth, outputHeight);
      } else {
        operation.frameCropper.cropStaticImage(operation.image!);
        const canvas = operation.frameCropper.outputCanvas;
        blob = await new Promise<Blob>((resolve, reject) => {
          const onAbort = () => reject(new DOMException('The image operation was aborted.', 'AbortError'));
          controller.signal.addEventListener('abort', onAbort, {once: true});
          canvas.toBlob(result => {
            controller.signal.removeEventListener('abort', onAbort);
            if (controller.signal.aborted) onAbort();
            else if (result) resolve(result);
            else reject(new Error('The cropped image could not be encoded.'));
          }, imageType?.mime || sourceBlob.type || 'image/png');
        });
      }
      if (controller.signal.aborted) throw new DOMException('The image operation was aborted.', 'AbortError');

      if (options.outputType === OutputType.BLOB) return blob;
      if (options.outputType === OutputType.BASE64) {
        operation.reader = new FileReader();
        return await new Promise<string>((resolve, reject) => {
          const reader = operation.reader!;
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.onabort = () => reject(new DOMException('The image operation was aborted.', 'AbortError'));
          controller.signal.addEventListener('abort', () => reader.abort(), {once: true});
          reader.readAsDataURL(blob);
        });
      }
      const url = URL.createObjectURL(blob);
      this.outputUrls.add(url);
      return url;
    } finally {
      this.releaseOperation(operation);
      if (this.operation === operation) this.operation = undefined;
    }
  }

  public destroy(): void {
    if (this.operation) this.releaseOperation(this.operation);
    this.operation = undefined;
    for (const url of this.outputUrls) URL.revokeObjectURL(url);
    this.outputUrls.clear();
  }

  private releaseOperation(operation: CropOperation): void {
    operation.controller.abort();
    operation.sourceSignal?.removeEventListener('abort', operation.onAbort);
    operation.reader?.abort();
    operation.syntheticGIF?.destroy();
    operation.webpEncoder?.destroy();
    if (operation.webp) operation.webp.frames.length = 0;
    operation.frameCropper?.destroy();
    operation.decoder?.destroy();
    operation.image?.close();
    operation.reader = operation.syntheticGIF = operation.frameCropper = operation.decoder = operation.image = undefined;
    operation.webpEncoder = operation.webp = undefined;
  }
}
