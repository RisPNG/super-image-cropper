import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';

const require = createRequire(import.meta.url);
const original = Object.fromEntries(['document', 'navigator', 'ImageData', 'Worker', 'createImageBitmap', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
Object.defineProperty(globalThis, 'navigator', {value: {userAgent: 'Mozilla/5.0 Chrome/120.0', platform: 'Linux', appName: 'Netscape'}, configurable: true});
globalThis.__gifuct = require('gifuct-js');
globalThis.__GIF = require('gif.js/dist/gif.js');
globalThis.__imageType = require('image-type');
const {default: workerSource} = await import('../../gif-worker-js/src/lib/gif.worker.js');
const canvases = [];
const workers = [];
const urls = [];
const revoked = [];
URL.createObjectURL = blob => {
  const url = 'blob:processor-' + urls.length;
  urls.push({url, blob});
  return url;
};
URL.revokeObjectURL = url => revoked.push(url);
globalThis.__workerUrl = () => URL.createObjectURL(new Blob([workerSource], {type: 'application/javascript'}));
globalThis.ImageData = class ImageData {
  constructor(data, width, height) { Object.assign(this, {data, width, height}); }
};

class RasterCanvas {
  constructor() {
    this._width = this._height = 0;
    this.pixels = new Uint8ClampedArray();
    this.context = new RasterContext(this);
    canvases.push(this);
  }
  get width() { return this._width; }
  set width(value) { this._width = value; this.pixels = new Uint8ClampedArray(this.width * this.height * 4); }
  get height() { return this._height; }
  set height(value) { this._height = value; this.pixels = new Uint8ClampedArray(this.width * this.height * 4); }
  getContext() { return this.context; }
  toBlob(callback, type) {
    const blob = new Blob([this.pixels.slice()], {type});
    queueMicrotask(() => callback(blob));
  }
  remove() { this.removed = true; }
}

class RasterContext {
  constructor(canvas) { this.canvas = canvas; this.matrix = [1, 0, 0, 1, 0, 0]; this.stack = []; }
  save() { this.stack.push([...this.matrix]); }
  restore() { this.matrix = this.stack.pop(); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  rotate(angle) { this.transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0); }
  transform(a, b, c, d, e, f) {
    const [aa, bb, cc, dd, ee, ff] = this.matrix;
    this.matrix = [aa * a + cc * b, bb * a + dd * b, aa * c + cc * d, bb * c + dd * d, aa * e + cc * f + ee, bb * e + dd * f + ff];
  }
  clearRect(left, top, width, height) {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) this.canvas.pixels.fill(0, (y * this.canvas.width + x) * 4, (y * this.canvas.width + x) * 4 + 4);
  }
  fillRect(left, top, width, height) {
    const color = this.fillStyle.match(/\d+/g).map(Number).concat(255);
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) this.canvas.pixels.set(color, (y * this.canvas.width + x) * 4);
  }
  createImageData(width, height) { return new ImageData(new Uint8ClampedArray(width * height * 4), width, height); }
  getImageData(left, top, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const start = ((top + y) * this.canvas.width + left + x) * 4;
      if (left + x >= 0 && top + y >= 0 && left + x < this.canvas.width && top + y < this.canvas.height) data.set(this.canvas.pixels.subarray(start, start + 4), (y * width + x) * 4);
    }
    return new ImageData(data, width, height);
  }
  putImageData(image, left, top) {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const start = (y * image.width + x) * 4;
      this.canvas.pixels.set(image.data.subarray(start, start + 4), ((top + y) * this.canvas.width + left + x) * 4);
    }
  }
  drawImage(image, left, top) {
    const [a, b, c, d, e, f] = this.matrix;
    const determinant = a * d - b * c;
    for (let y = 0; y < this.canvas.height; y++) for (let x = 0; x < this.canvas.width; x++) {
      const sx = Math.floor((d * (x + 0.5 - e) - c * (y + 0.5 - f)) / determinant - left);
      const sy = Math.floor((-b * (x + 0.5 - e) + a * (y + 0.5 - f)) / determinant - top);
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const offset = (sy * image.width + sx) * 4;
      if (image.pixels[offset + 3]) this.canvas.pixels.set(image.pixels.subarray(offset, offset + 4), (y * this.canvas.width + x) * 4);
    }
  }
}

globalThis.document = {createElement: () => new RasterCanvas(), body: {appendChild() { throw new Error('Processing canvases must not enter the DOM.'); }}};
class TestWorker {
  static hold = false;
  constructor(url) {
    this.url = url;
    workers.push(this);
    this.scope = {self: {postMessage: data => queueMicrotask(() => { if (!this.terminated) this.onmessage({data: structuredClone(data)}); })}};
    runInNewContext(workerSource, this.scope);
  }
  postMessage(task) {
    this.task = structuredClone(task);
    if (!TestWorker.hold) this.scope.self.onmessage({data: this.task});
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = TestWorker;

async function moduleURL(path, imports = []) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of imports) source = source.replace(from, to);
  const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2020'});
  return 'data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64');
}
const helper = await moduleURL('../src/lib/helper.ts', [["import imageType from 'image-type'", 'const imageType = globalThis.__imageType']]);
const decoder = await moduleURL('../src/lib/decoder.ts', [["import { parseGIF } from 'gifuct-js';", 'const {parseGIF} = globalThis.__gifuct;']]);
const cropper = await moduleURL('../src/lib/cropper.ts', [["import { decompressFrame } from 'gifuct-js';", 'const {decompressFrame} = globalThis.__gifuct;']]);
const synthetic = await moduleURL('../src/lib/synthetic-gif.ts', [
  ["import { transformToUrl as gifWorkerTransformToUrl } from 'gif-build-worker-js';", 'const gifWorkerTransformToUrl = globalThis.__workerUrl;'],
  ["import GIF from 'gif.js';", 'const GIF = globalThis.__GIF;'],
]);
const processor = await moduleURL('../src/index.ts', [
  ["'./lib/decoder'", JSON.stringify(decoder)],
  ["'./lib/cropper'", JSON.stringify(cropper)],
  ["'./lib/synthetic-gif'", JSON.stringify(synthetic)],
  ["'./lib/helper'", JSON.stringify(helper)],
]);
const {SuperImageCropper} = await import(processor);
const {FrameCropper} = await import(cropper);
const {Decoder} = await import(decoder);
const {parseGIF, decompressFrame} = globalThis.__gifuct;
const LZWEncoder = require('gif.js/src/LZWEncoder.js');
const red = [255, 0, 0, 255];
const green = [0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const yellow = [255, 255, 0, 255];
const black = [0, 0, 0, 255];
const clear = [0, 0, 0, 0];

function fixture(frames, colors = [yellow, red, green, blue, black], repeat = -1, localPalette = false) {
  const paletteSize = 2 ** Math.ceil(Math.log2(colors.length));
  const tableSize = Math.log2(paletteSize) - 1;
  const colorsTable = Array.from({length: paletteSize}, (_, index) => (colors[index] || black).slice(0, 3)).flat();
  const bytes = [...Buffer.from('GIF89a'), frames[0].width, 0, frames[0].height, 0, localPalette ? 0 : 0xf0 | tableSize, 0, 0];
  if (!localPalette) bytes.push(...colorsTable);
  if (repeat >= 0) bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, repeat & 255, repeat >> 8, 0);
  for (const frame of frames) {
    if (frame.gce !== false) bytes.push(0x21, 0xf9, 4, ((frame.dispose ?? 1) << 2) | (frame.transparent ? 1 : 0), frame.delay ?? 0, 0, 0, 0);
    bytes.push(0x2c, frame.left ?? 0, 0, frame.top ?? 0, 0, frame.width, 0, frame.height, 0, localPalette ? 0x80 | tableSize : 0);
    if (localPalette) bytes.push(...colorsTable);
    const encoder = new LZWEncoder(frame.width, frame.height, new Uint8Array(frame.pixels), Math.log2(paletteSize));
    encoder.encode({
      writeByte: byte => bytes.push(byte),
      writeBytes: (data, offset = 0, length = data.length) => { for (let index = offset; index < offset + length; index++) bytes.push(data[index]); },
    });
  }
  bytes.push(0x3b);
  return new Blob([new Uint8Array(bytes)], {type: 'image/gif'});
}

function cropOptions(width, height, changes = {}, outputWidth = width, outputHeight = height) {
  return {
    cropperJsOpts: {x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotate: 0, background: '', ...changes},
    imageData: {width, height, naturalWidth: width, naturalHeight: height},
    cropBoxData: {},
    outputWidth,
    outputHeight,
  };
}
const settled = () => new Promise(resolve => setImmediate(resolve));
after(() => {
  for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  for (const name of ['__gifuct', '__GIF', '__imageType', '__workerUrl']) delete globalThis[name];
});

test('GIF composition applies the preceding disposal rectangle and restores disposal 3 while preserving raw zero delays', async () => {
  const input = fixture([
    {width: 3, height: 1, pixels: [1, 1, 1], delay: 0},
    {width: 1, height: 1, left: 1, pixels: [3], delay: 3, dispose: 2},
    {width: 1, height: 1, left: 2, pixels: [2], delay: 7, dispose: 3},
    {width: 1, height: 1, pixels: [4], delay: 2},
  ]);
  const gif = parseGIF(await input.arrayBuffer());
  const frames = [];
  const delays = [];
  const crop = new FrameCropper({commonCropOptions: cropOptions(3, 1)});
  await crop.cropGif(gif, new AbortController().signal, (frame, delay) => { frames.push(Array.from(frame.data)); delays.push(delay); });
  assert.deepEqual(frames, [[red, red, red], [red, blue, red], [red, yellow, green], [black, yellow, red]].map(colors => colors.flat()));
  assert.deepEqual(delays, [0, 30, 70, 20]);
  crop.destroy();
  assert.equal(crop.outputCanvas.width, 0);
});

test('transparent disposal stays distinct from opaque black and a missing GCE does not inherit the preceding delay', async () => {
  const input = fixture([
    {width: 3, height: 1, pixels: [1, 0, 2], transparent: true, dispose: 2, delay: 4},
    {width: 1, height: 1, left: 1, pixels: [3], gce: false},
  ], [black, red, black, green]);
  const gif = parseGIF(await input.arrayBuffer());
  const frames = [];
  const delays = [];
  const crop = new FrameCropper({commonCropOptions: cropOptions(3, 1)});
  await crop.cropGif(gif, new AbortController().signal, (frame, delay) => { frames.push(Array.from(frame.data)); delays.push(delay); });
  assert.deepEqual(frames, [[red, clear, black], [clear, green, clear]].map(colors => colors.flat()));
  assert.deepEqual(delays, [40, 0]);
  crop.destroy();
});

test('rotation, flip, cropping, and independent dimensions apply to every GIF and static frame', async () => {
  const input = fixture([
    {width: 2, height: 2, pixels: [1, 2, 3, 4]},
    {width: 2, height: 2, pixels: [4, 3, 2, 1]},
  ], [black, red, green, blue, yellow]);
  const frames = [];
  const crop = new FrameCropper({commonCropOptions: cropOptions(2, 2, {rotate: 90, scaleX: -1}, 4, 4)});
  await crop.cropGif(parseGIF(await input.arrayBuffer()), new AbortController().signal, frame => frames.push(frame));
  for (const [index, frame] of frames.entries()) {
    assert.equal(frame.width, 4);
    assert.equal(frame.height, 4);
    const corners = [0, 3, 12, 15].map(pixel => Array.from(frame.data.subarray(pixel * 4, pixel * 4 + 4)));
    assert.deepEqual(corners, index === 0 ? [yellow, green, blue, red] : [red, blue, green, yellow]);
  }
  crop.init({commonCropOptions: cropOptions(2, 2, {x: 1, width: 1}, 2, 4)});
  const frame = crop.cropStaticImage({width: 2, height: 2, pixels: new Uint8ClampedArray([red, green, blue, yellow].flat())});
  assert.deepEqual(Array.from(frame.data), [green, green, green, green, yellow, yellow, yellow, yellow].flat());
  crop.destroy();
});

test('local-palette-only GIF cleanup does not require a global color table', async () => {
  const decoder = new Decoder(await fixture([{width: 1, height: 1, pixels: [1]}], [black, red], -1, true).arrayBuffer());
  const gif = decoder.decode();
  assert.equal(gif.gct, undefined);
  const crop = new FrameCropper({commonCropOptions: cropOptions(1, 1)});
  const frames = [];
  await crop.cropGif(gif, new AbortController().signal, frame => frames.push(Array.from(frame.data)));
  assert.deepEqual(frames, [red]);
  crop.destroy();
  decoder.destroy();
  assert.deepEqual(gif.frames, []);
});

test('the full GIF pipeline preserves finite and absent loops, zero delays, exact sizes, transparency, and opaque black', async () => {
  for (const repeat of [3, -1]) {
    const source = fixture([
      {width: 3, height: 1, pixels: [1, 0, 2], transparent: true, dispose: 2, delay: 0},
      {width: 1, height: 1, left: 1, pixels: [3], transparent: true, delay: 7},
    ], [black, red, black, green], repeat);
    globalThis.fetch = async () => ({ok: true, blob: async () => source});
    const crop = new SuperImageCropper();
    const output = await crop.crop({src: 'blob:original', cropperJsOpts: {x: 0, y: 0, width: 3, height: 1}, outputWidth: 6, outputHeight: 2, outputType: 'blob'});
    assert.equal(output.type, 'image/gif');
    const gif = parseGIF(await output.arrayBuffer());
    assert.equal(gif.lsd.width, 6);
    assert.equal(gif.lsd.height, 2);
    const application = gif.frames.find(frame => frame.application);
    assert.deepEqual(application?.application.blocks, repeat < 0 ? undefined : new Uint8Array([1, repeat, 0]));
    const frames = gif.frames.filter(frame => frame.image);
    assert.deepEqual(frames.map(frame => frame.gce.delay), [0, 7]);
    const first = decompressFrame(frames[0], gif.gct, true).patch;
    assert.equal(first[2 * 4 + 3], 0);
    assert.equal(first[5 * 4 + 3], 255);
    assert.deepEqual(Array.from(first.subarray(5 * 4, 5 * 4 + 3)), [0, 0, 0]);
    assert.ok(workers.every(worker => worker.terminated));
    assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    assert.ok(urls.every(({url}) => revoked.includes(url)));
    assert.equal(revoked.includes('blob:original'), false);
    crop.destroy();
  }
});

test('static preparation preserves explicit source and MIME with a Cropper instance and closes its decoded bitmap', async () => {
  let closed = 0;
  const pixels = new Uint8ClampedArray([red, blue].flat());
  globalThis.createImageBitmap = async () => ({width: 2, height: 1, pixels, close() { closed++; }});
  const requested = [];
  globalThis.fetch = async src => { requested.push(src); return {ok: true, blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {type: 'image/jpeg'})}; };
  const crop = new SuperImageCropper();
  const output = await crop.crop({
    src: 'blob:original-jpeg',
    cropperInstance: {url: 'blob:cropper-derived', getData: () => ({x: 1, y: 0, width: 1, height: 1}), getCropBoxData: () => ({})},
    outputWidth: 2,
    outputHeight: 3,
    outputType: 'blob',
  });
  assert.deepEqual(requested, ['blob:original-jpeg']);
  assert.equal(output.type, 'image/jpeg');
  assert.deepEqual(Array.from(new Uint8Array(await output.arrayBuffer())), [blue, blue, blue, blue, blue, blue].flat());
  assert.equal(closed, 1);
  assert.ok(canvases.every(canvas => canvas.width === 0));
  crop.destroy();
});

test('a v1 normalized JPEG raster receives its recorded EXIF rotation exactly once', async () => {
  const originalJPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {type: 'image/jpeg'});
  const normalizedJPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], {type: 'image/jpeg'});
  const normalizedURL = 'data:image/jpeg;base64,normalized-with-orientation-one';
  const requests = [];
  let closed = 0;
  globalThis.fetch = async (src, options) => {
    requests.push({src, signal: options.signal});
    return {ok: true, blob: async () => src === normalizedURL ? normalizedJPEG : originalJPEG};
  };
  globalThis.createImageBitmap = async blob => {
    assert.equal(blob, normalizedJPEG);
    return {width: 2, height: 1, pixels: new Uint8ClampedArray([red, blue].flat()), close() { closed++; }};
  };
  const crop = new SuperImageCropper();
  const output = await crop.crop({
    src: 'blob:original-oriented-jpeg',
    cropperInstance: {url: normalizedURL, getData: () => ({x: 0, y: 0, width: 1, height: 2, rotate: 90}), getCropBoxData: () => ({})},
    outputType: 'blob',
  });
  assert.deepEqual(requests.map(request => request.src), ['blob:original-oriented-jpeg', normalizedURL]);
  assert.equal(requests[0].signal, requests[1].signal);
  assert.equal(output.type, 'image/jpeg');
  assert.deepEqual(Array.from(new Uint8Array(await output.arrayBuffer())), [red, blue].flat());
  assert.equal(closed, 1);
  assert.ok(canvases.every(canvas => canvas.width === 0));
  crop.destroy();
});

test('the GIF pipeline applies explicit numeric RGB keys before palette mapping and keeps near colors opaque', async () => {
  const source = fixture([{width: 4, height: 1, pixels: [1, 2, 3, 4]}], [black, green, black, red, [0, 254, 0, 255]]);
  globalThis.fetch = async () => ({ok: true, blob: async () => source});
  const crop = new SuperImageCropper();
  for (const [transparent, expected] of [[0x00ff00, [0, 255, 255, 255]], [0, [255, 0, 255, 255]], [null, [255, 255, 255, 255]]]) {
    const output = await crop.crop({src: 'blob:original', cropperJsOpts: {width: 4, height: 1}, outputType: 'blob', gifJsOptions: {transparent}});
    const gif = parseGIF(await output.arrayBuffer());
    const patch = decompressFrame(gif.frames.find(frame => frame.image), gif.gct, true).patch;
    assert.deepEqual([0, 1, 2, 3].map(index => patch[index * 4 + 3]), expected);
  }
  crop.destroy();
});

test('source-resolution defaults and one independent output dimension retain the crop aspect ratio', async () => {
  globalThis.fetch = async () => ({ok: true, blob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {type: 'image/png'})});
  globalThis.createImageBitmap = async () => ({width: 2, height: 1, pixels: new Uint8ClampedArray([red, blue].flat()), close() {}});
  const crop = new SuperImageCropper();
  const source = await crop.crop({src: 'blob:source', cropperJsOpts: {width: 2, height: 1}, outputType: 'blob'});
  assert.equal(source.size, 8);
  const resized = await crop.crop({src: 'blob:source', cropperJsOpts: {width: 2, height: 1}, outputWidth: 4, outputType: 'blob'});
  assert.equal(resized.size, 4 * 2 * 4);
  crop.destroy();
});

test('successful Blob URL exports remain valid across processor reuse until explicit destruction', async () => {
  globalThis.fetch = async () => ({ok: true, blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {type: 'image/jpeg'})});
  globalThis.createImageBitmap = async () => ({width: 2, height: 1, pixels: new Uint8ClampedArray([red, blue].flat()), close() {}});
  const crop = new SuperImageCropper();
  const options = {src: 'blob:source', cropperJsOpts: {width: 2, height: 1}};
  const url = await crop.crop(options);
  const nextURL = await crop.crop(options);
  assert.notEqual(nextURL, url);
  assert.equal(revoked.includes(url), false);
  assert.equal(revoked.includes(nextURL), false);
  crop.destroy();
  assert.equal(revoked.includes(url), true);
  assert.equal(revoked.includes(nextURL), true);
});

test('aborting during GIF composition stops before the next frame and releases the raster buffers', async () => {
  const gif = parseGIF(await fixture([{width: 1, height: 1, pixels: [1]}, {width: 1, height: 1, pixels: [2]}]).arrayBuffer());
  const signal = new AbortController();
  const crop = new FrameCropper({commonCropOptions: cropOptions(1, 1)});
  let frames = 0;
  await assert.rejects(crop.cropGif(gif, signal.signal, () => { frames++; signal.abort(); }), {name: 'AbortError'});
  assert.equal(frames, 1);
  crop.destroy();
  assert.ok(canvases.every(canvas => canvas.width === 0));
});

test('abort and destroy reject pending native encoding and terminate active and idle workers', async () => {
  const source = fixture([{width: 2, height: 1, pixels: [1, 2]}, {width: 2, height: 1, pixels: [2, 1]}]);
  globalThis.fetch = async () => ({ok: true, blob: async () => source});
  for (const useDestroy of [false, true]) {
    TestWorker.hold = true;
    const controller = new AbortController();
    const crop = new SuperImageCropper();
    const pending = crop.crop({src: 'blob:original', cropperJsOpts: {width: 2, height: 1}, signal: controller.signal, outputType: 'blob'});
    const assertion = assert.rejects(pending, {name: 'AbortError'});
    while (!workers.some(worker => !worker.terminated && worker.task)) await new Promise(resolve => setTimeout(resolve, 1));
    if (useDestroy) crop.destroy();
    else controller.abort();
    await assertion;
    assert.ok(workers.every(worker => worker.terminated));
    assert.ok(canvases.every(canvas => canvas.width === 0));
    assert.ok(urls.every(({url}) => revoked.includes(url)));
    TestWorker.hold = false;
  }
});

test('worker errors reject the crop with its encoding error and free all buffers and URLs', async () => {
  globalThis.fetch = async () => ({ok: true, blob: async () => fixture([{width: 1, height: 1, pixels: [1]}])});
  TestWorker.hold = true;
  const crop = new SuperImageCropper();
  const pending = crop.crop({src: 'blob:original', cropperJsOpts: {width: 1, height: 1}, outputType: 'blob'});
  const assertion = assert.rejects(pending, /encoding worker failed/);
  while (!workers.some(worker => !worker.terminated && worker.task)) await settled();
  workers.find(worker => !worker.terminated).onerror({});
  await assertion;
  assert.ok(workers.every(worker => worker.terminated));
  assert.ok(canvases.every(canvas => canvas.width === 0));
  TestWorker.hold = false;
});

test('abort during static toBlob rejects immediately and a later callback cannot produce an output URL', async () => {
  globalThis.fetch = async () => ({ok: true, blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {type: 'image/jpeg'})});
  let closed = 0;
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, pixels: new Uint8ClampedArray(red), close() { closed++; }});
  const toBlob = RasterCanvas.prototype.toBlob;
  let callback;
  RasterCanvas.prototype.toBlob = function (value) { callback = value; };
  try {
    const controller = new AbortController();
    const crop = new SuperImageCropper();
    const count = urls.length;
    const pending = crop.crop({src: 'blob:original', cropperJsOpts: {width: 1, height: 1}, signal: controller.signal});
    const assertion = assert.rejects(pending, {name: 'AbortError'});
    while (!callback) await settled();
    controller.abort();
    await assertion;
    callback(new Blob(['encoded'], {type: 'image/jpeg'}));
    await settled();
    assert.equal(urls.length, count);
    assert.equal(closed, 1);
    assert.ok(canvases.every(canvas => canvas.width === 0));
  } finally { RasterCanvas.prototype.toBlob = toBlob; }
});
