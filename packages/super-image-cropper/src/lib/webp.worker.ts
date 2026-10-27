import createWebPModule from '@jsquash/webp/codec/enc/webp_enc.js';
import wasmBinary from '@jsquash/webp/codec/enc/webp_enc.wasm';
import { defaultOptions } from '@jsquash/webp/meta.js';

const scope = self as unknown as {
  addEventListener(
    type: 'message',
    listener: (
      event: MessageEvent<{ data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }>
    ) => void
  ): void;
  postMessage(message: { bytes: Uint8Array } | { error: string }, transfer?: Transferable[]): void;
};
let encoder: ReturnType<typeof createWebPModule> | undefined;

scope.addEventListener('message', async ({ data }) => {
  try {
    const options = { wasmBinary, noInitialRun: true, locateFile: (path: string) => path };
    encoder ||= createWebPModule(options);
    const module = await encoder;
    const bytes = module.encode(data.data, data.width, data.height, {
      ...defaultOptions,
      lossless: 1,
      exact: 1
    });
    if (!bytes) throw new Error('The WebP frame could not be encoded.');
    scope.postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : 'The WebP frame could not be encoded.'
    });
  }
});
