import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build, transform} from 'esbuild';
import createWebPDecoder from '@jsquash/webp/codec/dec/webp_dec.js';

const require = createRequire(import.meta.url);
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
const originalImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const urls = new Map();
const revoked = [];
const workers = [];
URL.createObjectURL = blob => {
  const url = 'blob:webp-encoder-' + urls.size;
  urls.set(url, blob);
  return url;
};
URL.revokeObjectURL = url => revoked.push(url);
globalThis.ImageData = class ImageData {
  constructor(data, width, height) { Object.assign(this, {data, width, height}); }
};

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/webp.worker.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  loader: {'.wasm': 'binary'},
  define: {'import.meta': '{}'},
});
globalThis.__webpEncoderWorker = compiled.outputFiles[0].text;
const ownerSource = (await readFile(new URL('../src/lib/webp-encoder.ts', import.meta.url), 'utf8'))
  .replace("import workerSource from './webp.worker?worker';", 'const workerSource = globalThis.__webpEncoderWorker;');
const owner = await transform(ownerSource, {loader: 'ts', format: 'esm', target: 'es2020'});
const {WebPEncoder} = await import('data:text/javascript;base64,' + Buffer.from(owner.code).toString('base64'));
const decoder = await createWebPDecoder({
  wasmBinary: await readFile(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')),
  noInitialRun: true,
  locateFile: path => path,
});

class BrowserWorker {
  static hold = false;
  constructor(url) {
    this.url = url;
    workers.push(this);
    const self = {
      location: {href: url},
      addEventListener: (_type, listener) => { this.receive = listener; },
      postMessage: (data, transfer) => {
        const result = structuredClone(data, {transfer});
        queueMicrotask(() => { if (!this.terminated) this.onmessage?.({data: result}); });
      },
    };
    this.ready = urls.get(url).text().then(source => {
      if (this.terminated) return;
      runInNewContext(source, {self, WebAssembly, ArrayBuffer, Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, TextDecoder, TextEncoder, URL, console, setTimeout, clearTimeout, importScripts() {}});
    });
  }
  postMessage(data, transfer) {
    this.task = structuredClone(data, {transfer});
    if (!BrowserWorker.hold) this.ready.then(() => {
      if (!this.terminated) return this.receive({data: this.task});
    }).catch(error => this.onerror?.(error));
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = BrowserWorker;

after(() => {
  if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
  else delete globalThis.Worker;
  if (originalImageData) Object.defineProperty(globalThis, 'ImageData', originalImageData);
  else delete globalThis.ImageData;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  delete globalThis.__webpEncoderWorker;
});

test('the bundled WebP worker encodes independent lossless RGBA frames and releases its worker URL', {timeout: 10000}, async t => {
  const encoder = new WebPEncoder(new AbortController().signal);
  t.after(() => encoder.destroy());
  const worker = workers.at(-1);
  const original = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 0, 0, 0, 255];
  for (const pixels of [original, [...original].reverse()]) {
    const frame = new ImageData(new Uint8ClampedArray(pixels), 2, 2);
    const bytes = await encoder.encode(frame);
    assert.equal(frame.data.byteLength, 0);
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF');
    assert.equal(Buffer.from(bytes.subarray(8, 12)).toString(), 'WEBP');
    const image = decoder.decode(bytes);
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.deepEqual(Array.from(image.data), pixels);
    assert.equal(workers.at(-1), worker);
  }
  encoder.destroy();
  assert.equal(worker.terminated, true);
  assert.equal(revoked.filter(url => url === worker.url).length, 1);
  await assert.rejects(encoder.encode(new ImageData(new Uint8ClampedArray(4), 1, 1)), {name: 'AbortError'});
});

test('abort and explicit destruction reject pending WebP encoding and prevent late replies', async t => {
  BrowserWorker.hold = true;
  t.after(() => { BrowserWorker.hold = false; });
  for (const abort of [true, false]) {
    const controller = new AbortController();
    const encoder = new WebPEncoder(controller.signal);
    t.after(() => encoder.destroy());
    const worker = workers.at(-1);
    const pending = encoder.encode(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1));
    const rejected = assert.rejects(pending, {name: 'AbortError'});
    if (abort) controller.abort();
    else encoder.destroy();
    await rejected;
    assert.equal(worker.terminated, true);
    assert.equal(revoked.filter(url => url === worker.url).length, 1);
    worker.onmessage({data: {bytes: new Uint8Array([1, 2, 3])}});
    await assert.rejects(encoder.encode(new ImageData(new Uint8ClampedArray(4), 1, 1)), {name: 'AbortError'});
  }
});

test('worker failures reject the pending frame and release the encoding resources', async t => {
  BrowserWorker.hold = true;
  t.after(() => { BrowserWorker.hold = false; });
  const encoder = new WebPEncoder(new AbortController().signal);
  t.after(() => encoder.destroy());
  const worker = workers.at(-1);
  const rejected = assert.rejects(encoder.encode(new ImageData(new Uint8ClampedArray(4), 1, 1)), /WebP encoding worker failed/);
  worker.onerror({});
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(revoked.filter(url => url === worker.url).length, 1);
});

test('an actual libwebp encoding failure reaches the caller instead of leaving a pending frame', {timeout: 10000}, async t => {
  const encoder = new WebPEncoder(new AbortController().signal);
  t.after(() => encoder.destroy());
  await assert.rejects(encoder.encode(new ImageData(new Uint8ClampedArray(), 0, 1)), /WebP frame could not be encoded/);
  encoder.destroy();
  assert.equal(workers.at(-1).terminated, true);
});

test('a blocked worker constructor releases its source URL before reporting the policy error', t => {
  globalThis.Worker = class {
    constructor() { throw new DOMException('Worker blocked by policy.', 'SecurityError'); }
  };
  t.after(() => { globalThis.Worker = BrowserWorker; });
  const count = urls.size;
  assert.throws(() => new WebPEncoder(new AbortController().signal), {name: 'SecurityError'});
  assert.equal(urls.size, count + 1);
  const url = [...urls.keys()].at(-1);
  assert.equal(revoked.filter(value => value === url).length, 1);
});
