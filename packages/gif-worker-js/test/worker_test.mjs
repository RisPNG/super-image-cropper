import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { decompressFrames, parseGIF } from 'gifuct-js';
import worker from '../src/lib/gif.worker.js';

function encodeFrames(frames, { width, height, dither = false, globalPalette = false, repeat = -1, quality = 10, transparent = null }) {
  const results = [];
  const context = vm.createContext({ self: { postMessage: (frame) => results.push(frame) } });
  vm.runInContext(worker, context);
  let palette = globalPalette;
  const chunks = frames.map((frame, index) => {
    context.self.onmessage({
      data: {
        index,
        width,
        height,
        data: new Uint8ClampedArray(frame.pixels),
        delay: frame.delay,
        repeat,
        transparent,
        quality,
        dither,
        globalPalette: palette,
        last: index === frames.length - 1,
        canTransfer: false,
      },
    });
    const result = results.at(-1);
    if (globalPalette === true) palette = result.globalPalette;
    return Buffer.concat(result.data.map((page, pageIndex) =>
      Buffer.from(page.subarray(0, pageIndex === result.data.length - 1 ? result.cursor : result.pageSize))
    ));
  });
  return parseGIF(Buffer.concat(chunks));
}

for (const dither of [false, true, 'FloydSteinberg-serpentine', 'Atkinson-serpentine']) {
  test(`opaque black stays opaque beside transparent pixels with dither ${dither}`, () => {
    const gif = encodeFrames([{ delay: 80, pixels: [
      0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 255, 0, 0, 0, 0, 0, 255,
    ] }], { width: 3, height: 2, dither });
    const [frame] = decompressFrames(gif, true);
    assert.deepEqual([frame.patch[3], frame.patch[7], frame.patch[11], frame.patch[15], frame.patch[19], frame.patch[23]], [255, 0, 255, 255, 0, 255]);
    for (const index of [0, 2, 3, 5]) {
      assert.ok(frame.patch[index * 4] < 16);
      assert.ok(frame.patch[index * 4 + 1] < 16);
      assert.ok(frame.patch[index * 4 + 2] < 16);
    }
  });
}

test('GIF alpha is binary without treating an opaque colour as a transparent key', () => {
  const gif = encodeFrames([{ delay: 0, pixels: [0, 0, 0, 127, 0, 0, 0, 128] }], { width: 2, height: 1 });
  const [frame] = decompressFrames(gif, true);
  assert.deepEqual([frame.patch[3], frame.patch[7]], [0, 255]);
  assert.equal(gif.frames.find((frame) => frame.image).gce.delay, 0);
});

test('an explicit RGB key matches source pixels without clearing nearby opaque colours or black', () => {
  const gif = encodeFrames([{ delay: 80, pixels: [
    0, 255, 0, 255, 0, 254, 0, 255, 0, 0, 0, 255,
  ] }], { width: 3, height: 1, transparent: 0x00ff00 });
  const [frame] = decompressFrames(gif, true);
  assert.deepEqual([frame.patch[3], frame.patch[7], frame.patch[11]], [0, 255, 255]);
  assert.ok(frame.patch[8] < 16 && frame.patch[9] < 16 && frame.patch[10] < 16);
});

test('the numeric zero colour key intentionally clears black while null preserves it', () => {
  const pixels = [0, 0, 0, 255, 255, 0, 0, 255];
  for (const transparent of [0, null]) {
    const gif = encodeFrames([{ delay: 80, pixels }], { width: 2, height: 1, transparent });
    const [frame] = decompressFrames(gif, true);
    assert.deepEqual([frame.patch[3], frame.patch[7]], [transparent === 0 ? 0 : 255, 255]);
  }
});

for (const globalPalette of [false, true]) {
  test(`opaque-to-transparent transitions clear the preceding frame with global palette ${globalPalette}`, () => {
    const gif = encodeFrames([
      { delay: 80, pixels: [0, 0, 0, 255, 255, 0, 0, 255] },
      { delay: 120, pixels: [0, 255, 0, 0, 0, 0, 0, 255] },
    ], { width: 2, height: 1, globalPalette, repeat: 3 });
    const frames = decompressFrames(gif, true);
    const screen = new Uint8ClampedArray(8);
    for (const [index, frame] of frames.entries()) {
      if (index > 0 && frames[index - 1].disposalType === 2) screen.fill(0);
      for (let pixel = 0; pixel < 2; pixel++) {
        if (frame.patch[pixel * 4 + 3]) screen.set(frame.patch.subarray(pixel * 4, pixel * 4 + 4), pixel * 4);
      }
      assert.deepEqual([screen[3], screen[7]], index === 0 ? [255, 255] : [0, 255]);
      assert.equal(frame.disposalType, 2);
      assert.equal(frame.transparentIndex, gif.lsd.backgroundColorIndex);
    }
    assert.deepEqual(frames.map((frame) => frame.delay), [80, 120]);
    const app = gif.frames.find((frame) => frame.application)?.application;
    assert.equal(app.id, 'NETSCAPE2.0');
    assert.deepEqual(Array.from(app.blocks), [1, 3, 0]);
  });
}

test('a non-looping GIF omits the application extension', () => {
  const gif = encodeFrames([{ delay: 80, pixels: [0, 0, 0, 255] }], { width: 1, height: 1 });
  assert.equal(gif.frames.some((frame) => frame.application), false);
});
