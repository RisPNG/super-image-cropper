import { parseGIF } from 'gifuct-js';
import type { ParsedGif } from 'gifuct-js';

export type IFrames = ParsedGif['frames'];
export type IFrame = IFrames[number];

export class Decoder {
  private gif?: ParsedGif;

  constructor(private bytes: ArrayBuffer) {}

  public decode(): ParsedGif {
    this.gif = parseGIF(this.bytes);
    return this.gif;
  }

  public destroy(): void {
    if (this.gif) {
      this.gif.frames.length = 0;
      if (this.gif.gct) this.gif.gct.length = 0;
    }
    this.gif = undefined;
    this.bytes = new ArrayBuffer(0);
  }
}
