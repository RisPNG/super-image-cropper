import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

const source = await readFile(new URL('../src/lib/webp.ts', import.meta.url), 'utf8');
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2020'});
const {WebPAnimation} = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'));
const still = new Uint8Array(Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64'));
const lossless = still.subarray(20, 37);

function chunk(type, data) {
  const bytes = new Uint8Array(8 + data.length + (data.length % 2));
  bytes.set(Buffer.from(type));
  new DataView(bytes.buffer).setUint32(4, data.length, true);
  bytes.set(data, 8);
  return bytes;
}

function container(chunks) {
  const bytes = new Uint8Array(12 + chunks.reduce((size, value) => size + value.length, 0));
  bytes.set(Buffer.from('RIFF'));
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(Buffer.from('WEBP'), 8);
  let offset = 12;
  for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
  return bytes;
}

function frame({x = 0, y = 0, width = 1, height = 1, duration = 0, flags = 0, image = chunk('VP8L', lossless)} = {}) {
  const bytes = new Uint8Array(16 + image.length);
  bytes.set([
    (x / 2) & 255, ((x / 2) >>> 8) & 255, (x / 2) >>> 16,
    (y / 2) & 255, ((y / 2) >>> 8) & 255, (y / 2) >>> 16,
    (width - 1) & 255, ((width - 1) >>> 8) & 255, (width - 1) >>> 16,
    (height - 1) & 255, ((height - 1) >>> 8) & 255, (height - 1) >>> 16,
    duration & 255, (duration >>> 8) & 255, duration >>> 16, flags,
  ]);
  bytes.set(image, 16);
  return chunk('ANMF', bytes);
}

function animation(frames, {width = 1, height = 1, loop = 0, background = [11, 22, 33, 44], profile} = {}) {
  return container([
    chunk('VP8X', new Uint8Array([2 | (profile ? 32 : 0), 0, 0, 0, (width - 1) & 255, ((width - 1) >>> 8) & 255, (width - 1) >>> 16, (height - 1) & 255, ((height - 1) >>> 8) & 255, (height - 1) >>> 16])),
    ...(profile ? [chunk('ICCP', profile)] : []),
    chunk('ANIM', new Uint8Array([background[2], background[1], background[0], background[3], loop & 255, loop >>> 8])),
    ...frames,
  ]);
}

function inspect(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    chunks.push({type: Buffer.from(bytes.subarray(offset, offset + 4)).toString(), data: bytes.subarray(offset + 8, offset + 8 + size), size});
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

test('still WebP remains on the static processing path', () => {
  assert.equal(WebPAnimation.decode(still.buffer), undefined);
  const extendedStill = container([chunk('VP8X', new Uint8Array(10)), chunk('VP8L', lossless)]);
  assert.equal(WebPAnimation.decode(extendedStill.buffer), undefined);
});

test('animated WebP reads canvas, doubled offsets, zero and maximum durations, blending, disposal, and finite loops', () => {
  const bytes = animation([frame({x: 65536, y: 2, duration: 0, flags: 3}), frame({duration: 0xffffff})], {width: 65537, height: 3, loop: 65535});
  const decoded = WebPAnimation.decode(bytes.buffer);
  assert.equal(decoded.width, 65537);
  assert.equal(decoded.height, 3);
  assert.equal(decoded.loop, 65535);
  assert.deepEqual(decoded.background, [11, 22, 33, 44]);
  assert.deepEqual(decoded.frames.map(({x, y, width, height, duration, blend, dispose}) => ({x, y, width, height, duration, blend, dispose})), [
    {x: 65536, y: 2, width: 1, height: 1, duration: 0, blend: false, dispose: true},
    {x: 0, y: 0, width: 1, height: 1, duration: 0xffffff, blend: true, dispose: false},
  ]);
});

test('frame reconstruction preserves its encoded image, odd chunk padding, and source color profile', async () => {
  const profile = new Uint8Array([1, 2, 3]);
  const decoded = WebPAnimation.decode(animation([frame()], {profile}).buffer);
  const blob = decoded.frames[0].blob;
  assert.equal(blob.type, 'image/webp');
  const chunks = inspect(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(chunks.map(value => value.type), ['VP8X', 'ICCP', 'VP8L']);
  assert.equal(chunks[0].data[0] & 32, 32);
  assert.equal(chunks[0].data[0] & 2, 0);
  assert.deepEqual(chunks[1].data, profile);
  assert.deepEqual(chunks[2].data, lossless);
  assert.equal(chunks[2].size, 17);
});

test('reconstructed frame containers retain ALPH before their lossy bitstream', async () => {
  const alpha = chunk('ALPH', new Uint8Array([0, 128]));
  const lossy = chunk('VP8 ', new Uint8Array([0, 0, 0, 157, 1, 42, 1, 0, 1, 0]));
  const payload = new Uint8Array(alpha.length + lossy.length);
  payload.set(alpha);
  payload.set(lossy, alpha.length);
  const decoded = WebPAnimation.decode(animation([frame({image: payload})]).buffer);
  const chunks = inspect(new Uint8Array(await decoded.frames[0].blob.arrayBuffer()));
  assert.deepEqual(chunks.map(value => value.type), ['VP8X', 'ALPH', 'VP8 ']);
  assert.equal(chunks[0].data[0], 16);
  assert.deepEqual(chunks[1].data, new Uint8Array([0, 128]));
});

test('muxing fully composed frames preserves timing and loops with no blending, no disposal, and a transparent background', async () => {
  const original = WebPAnimation.decode(animation([frame(), frame({duration: 123})], {loop: 42}).buffer);
  const output = original.createBlob([{bytes: still, duration: 0}, {bytes: still, duration: 123}], 1, 1);
  assert.equal(output.type, 'image/webp');
  const bytes = new Uint8Array(await output.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(4, true), bytes.length - 8);
  const chunks = inspect(bytes);
  assert.deepEqual(chunks.map(value => value.type), ['VP8X', 'ANIM', 'ANMF', 'ANMF']);
  assert.equal(chunks[0].data[0], 2);
  const decoded = WebPAnimation.decode(bytes.buffer);
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  assert.equal(decoded.loop, 42);
  assert.deepEqual(decoded.background, [0, 0, 0, 0]);
  assert.deepEqual(decoded.frames.map(({x, y, duration, blend, dispose}) => ({x, y, duration, blend, dispose})), [
    {x: 0, y: 0, duration: 0, blend: false, dispose: false},
    {x: 0, y: 0, duration: 123, blend: false, dispose: false},
  ]);
});

test('muxing signals alpha for transparent lossless frames and accepts mixed lossy and lossless frame data', async () => {
  const original = WebPAnimation.decode(animation([frame()]).buffer);
  const transparent = still.slice();
  transparent[24] |= 16;
  const lossy = container([chunk('ALPH', new Uint8Array([0, 128])), chunk('VP8 ', new Uint8Array([0, 0, 0, 157, 1, 42, 1, 0, 1, 0]))]);
  const output = new Uint8Array(await original.createBlob([{bytes: transparent, duration: 5}, {bytes: lossy, duration: 7}], 1, 1).arrayBuffer());
  assert.equal(inspect(output)[0].data[0], 18);
  const decoded = WebPAnimation.decode(output.buffer);
  assert.deepEqual(decoded.frames.map(value => value.duration), [5, 7]);
  assert.deepEqual(await Promise.all(decoded.frames.map(async value => inspect(new Uint8Array(await value.blob.arrayBuffer())).map(child => child.type))), [
    ['VP8X', 'VP8L'], ['VP8X', 'ALPH', 'VP8 '],
  ]);
});

test('truncated containers, missing animation headers, empty animations, and invalid frame bounds fail before native decoding', () => {
  const valid = animation([frame()]);
  assert.throws(() => WebPAnimation.decode(valid.buffer.slice(0, -1)), /truncated/);
  const chunks = inspect(valid);
  assert.throws(() => WebPAnimation.decode(container([chunk('VP8X', chunks[0].data), frame()]).buffer), /frame header/);
  assert.throws(() => WebPAnimation.decode(animation([]).buffer), /no image frames/);
  assert.throws(() => WebPAnimation.decode(animation([frame({x: 2})]).buffer), /exceeds its canvas/);
  assert.throws(() => WebPAnimation.decode(animation([chunk('ANMF', new Uint8Array(15))]).buffer), /frame header/);
  assert.throws(() => WebPAnimation.decode(animation([frame({image: chunk('EXIF', new Uint8Array([1]))})]).buffer), /frame image/);
  const brokenFrame = frame();
  new DataView(brokenFrame.buffer).setUint32(28, 1000, true);
  assert.throws(() => WebPAnimation.decode(animation([brokenFrame]).buffer), /truncated/);
});

test('output dimensions must fit the WebP canvas fields and an animation needs an encoded image', () => {
  const original = WebPAnimation.decode(animation([frame()]).buffer);
  for (const [width, height] of [[0, 1], [1.5, 1], [0x1000001, 1], [65536, 65536]]) {
    assert.throws(() => original.createBlob([{bytes: still, duration: 1}], width, height), /dimensions/);
  }
  assert.throws(() => original.createBlob([], 1, 1), /no output frames/);
  assert.throws(() => original.createBlob([{bytes: container([]), duration: 1}], 1, 1), /frame image/);
});
