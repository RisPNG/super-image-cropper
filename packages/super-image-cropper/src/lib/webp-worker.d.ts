/// <reference types="@jsquash/webp/emscripten-types" />

declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}

declare module '*?worker' {
  const source: string;
  export default source;
}
