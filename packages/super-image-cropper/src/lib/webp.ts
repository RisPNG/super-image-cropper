interface WebPChunk {
  type: string;
  data: Uint8Array;
}

export interface WebPFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
  blend: boolean;
  dispose: boolean;
  blob: Blob;
}

function readWebPChunks(bytes: Uint8Array, container = true): WebPChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let end = bytes.byteLength;
  if (container) {
    if (
      end < 12 ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP'
    ) {
      throw new Error('The WebP container header is invalid.');
    }
    end = view.getUint32(4, true) + 8;
    if (end < 12 || end > bytes.byteLength || end % 2 !== 0)
      throw new Error('The WebP container is truncated.');
    offset = 12;
  }
  const chunks: WebPChunk[] = [];
  while (offset < end) {
    if (offset + 8 > end) throw new Error('The WebP chunk header is truncated.');
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const next = offset + 8 + size + (size % 2);
    if (next > end) throw new Error('The WebP chunk is truncated.');
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + size) });
    offset = next;
  }
  return chunks;
}

function writeWebPContainer(chunks: WebPChunk[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce(
    (total, chunk) => total + 8 + chunk.data.byteLength + (chunk.data.byteLength % 2),
    12
  );
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0);
  view.setUint32(4, size - 8, true);
  bytes.set([87, 69, 66, 80], 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(
      Array.from(chunk.type, letter => letter.charCodeAt(0)),
      offset
    );
    view.setUint32(offset + 4, chunk.data.byteLength, true);
    bytes.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.byteLength + (chunk.data.byteLength % 2);
  }
  return bytes;
}

export class WebPAnimation {
  private constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly loop: number,
    public readonly background: [number, number, number, number],
    public readonly frames: WebPFrame[]
  ) {}

  public static decode(bytes: ArrayBuffer): WebPAnimation | undefined {
    const chunks = readWebPChunks(new Uint8Array(bytes));
    const extended = chunks[0];
    if (extended?.type !== 'VP8X') return undefined;
    if (extended.data.byteLength < 10) throw new Error('The WebP canvas header is truncated.');
    if (!(extended.data[0] & 2)) return undefined;
    const width = 1 + extended.data[4] + (extended.data[5] << 8) + (extended.data[6] << 16);
    const height = 1 + extended.data[7] + (extended.data[8] << 8) + (extended.data[9] << 16);
    if (width * height > 0xffffffff) throw new Error('The WebP canvas dimensions are invalid.');
    let animation: WebPAnimation | undefined;
    let profile: WebPChunk | undefined;
    const frames: WebPFrame[] = [];
    for (const chunk of chunks.slice(1)) {
      if (chunk.type === 'ICCP' && !profile) {
        if (frames.length) throw new Error('The WebP color profile follows its image frames.');
        profile = chunk;
      } else if (chunk.type === 'ANIM') {
        if (animation || chunk.data.byteLength < 6)
          throw new Error('The WebP animation header is invalid.');
        const data = chunk.data;
        animation = new WebPAnimation(
          width,
          height,
          data[4] | (data[5] << 8),
          [data[2], data[1], data[0], data[3]],
          frames
        );
      } else if (chunk.type === 'ANMF') {
        if (!animation || chunk.data.byteLength < 16)
          throw new Error('The WebP animation frame header is invalid.');
        const data = chunk.data;
        const x = (data[0] + (data[1] << 8) + (data[2] << 16)) * 2;
        const y = (data[3] + (data[4] << 8) + (data[5] << 16)) * 2;
        const frameWidth = 1 + data[6] + (data[7] << 8) + (data[8] << 16);
        const frameHeight = 1 + data[9] + (data[10] << 8) + (data[11] << 16);
        if (x + frameWidth > width || y + frameHeight > height)
          throw new Error('The WebP animation frame exceeds its canvas.');
        const imageChunks = readWebPChunks(data.subarray(16), false).filter(child =>
          ['ALPH', 'VP8 ', 'VP8L'].includes(child.type)
        );
        const images = imageChunks.filter(child => child.type !== 'ALPH');
        if (
          images.length !== 1 ||
          (imageChunks.some(child => child.type === 'ALPH') &&
            (images[0].type !== 'VP8 ' || imageChunks[0].type !== 'ALPH'))
        ) {
          throw new Error('The WebP animation frame image is invalid.');
        }
        const alpha = imageChunks.some(
          child => child.type === 'ALPH' || (child.type === 'VP8L' && !!(child.data[4] & 16))
        );
        const header = new Uint8Array([
          (alpha ? 16 : 0) | (profile ? 32 : 0),
          0,
          0,
          0,
          (frameWidth - 1) & 255,
          ((frameWidth - 1) >>> 8) & 255,
          (frameWidth - 1) >>> 16,
          (frameHeight - 1) & 255,
          ((frameHeight - 1) >>> 8) & 255,
          (frameHeight - 1) >>> 16
        ]);
        frames.push({
          x,
          y,
          width: frameWidth,
          height: frameHeight,
          duration: data[12] + (data[13] << 8) + (data[14] << 16),
          blend: !(data[15] & 2),
          dispose: !!(data[15] & 1),
          get blob() {
            return new Blob(
              [
                writeWebPContainer([
                  { type: 'VP8X', data: header },
                  ...(profile ? [profile] : []),
                  ...imageChunks
                ]).buffer
              ],
              { type: 'image/webp' }
            );
          }
        });
      }
    }
    if (!animation || !frames.length)
      throw new Error('The WebP animation contains no image frames.');
    return animation;
  }

  public createBlob(
    frames: { bytes: Uint8Array; duration: number }[],
    width: number,
    height: number
  ): Blob {
    if (
      ![width, height].every(
        dimension => Number.isInteger(dimension) && dimension > 0 && dimension <= 0x1000000
      ) ||
      width * height > 0xffffffff
    ) {
      throw new Error('The WebP output dimensions are invalid.');
    }
    if (!frames.length) throw new Error('The WebP animation contains no output frames.');
    const header = new Uint8Array([
      2,
      0,
      0,
      0,
      (width - 1) & 255,
      ((width - 1) >>> 8) & 255,
      (width - 1) >>> 16,
      (height - 1) & 255,
      ((height - 1) >>> 8) & 255,
      (height - 1) >>> 16
    ]);
    const chunks: WebPChunk[] = [
      { type: 'VP8X', data: header },
      { type: 'ANIM', data: new Uint8Array([0, 0, 0, 0, this.loop & 255, this.loop >>> 8]) }
    ];
    for (const frame of frames) {
      const imageChunks = readWebPChunks(frame.bytes).filter(chunk =>
        ['ALPH', 'VP8 ', 'VP8L'].includes(chunk.type)
      );
      if (imageChunks.filter(chunk => chunk.type !== 'ALPH').length !== 1)
        throw new Error('The encoded WebP frame image is invalid.');
      if (
        imageChunks.some(
          chunk => chunk.type === 'ALPH' || (chunk.type === 'VP8L' && !!(chunk.data[4] & 16))
        )
      )
        header[0] |= 16;
      const image = writeWebPContainer(imageChunks);
      const data = new Uint8Array(16 + image.byteLength - 12);
      data.set([
        0,
        0,
        0,
        0,
        0,
        0,
        (width - 1) & 255,
        ((width - 1) >>> 8) & 255,
        (width - 1) >>> 16,
        (height - 1) & 255,
        ((height - 1) >>> 8) & 255,
        (height - 1) >>> 16,
        frame.duration & 255,
        (frame.duration >>> 8) & 255,
        frame.duration >>> 16,
        2
      ]);
      data.set(image.subarray(12), 16);
      chunks.push({ type: 'ANMF', data });
    }
    return new Blob([writeWebPContainer(chunks).buffer], { type: 'image/webp' });
  }
}
