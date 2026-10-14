<div align="center">

# 🖼️ Super Image Cropper

</div>

<div align="center">

A powerful JavaScript image cropping library that supports GIF animations, PNG, JPG and other image formats.

[![npm version](https://img.shields.io/npm/v/super-image-cropper)](https://www.npmjs.com/package/super-image-cropper) [![npm downloads](https://img.shields.io/npm/dw/super-image-cropper)](https://www.npmjs.com/package/super-image-cropper) [![GitHub license](https://img.shields.io/github/license/STDSuperman/super-image-cropper)](https://github.com/STDSuperman/super-image-cropper/blob/master/LICENSE) [![GitHub stars](https://img.shields.io/github/stars/STDSuperman/super-image-cropper)](https://github.com/STDSuperman/super-image-cropper/stargazers) [![GitHub issues](https://img.shields.io/github/issues/STDSuperman/super-image-cropper)](https://github.com/STDSuperman/super-image-cropper/issues) [![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

[🌟 Live Demo](https://gif-cropper-stdsuperman.vercel.app/) | [📖 Documentation](#documentation) | [🇨🇳 中文文档](./docs/README_zh.md)

</div>

## ✨ Features

- 🎬 **GIF Animation Support** - Crop animated GIFs while preserving animation
- 🖼️ **Multiple Formats** - Support for PNG, JPG, JPEG, and GIF formats
- 🔧 **CropperJS Integration** - Seamless integration with popular CropperJS library
- 🎨 **Flexible Output** - Multiple output formats: Base64, Blob, or Blob URL
- ⚡ **High Performance** - Optimized for handling large images and animations
- 🎯 **Precise Control** - Fine-grained control over cropping parameters
- 📱 **Cross-Platform** - Works in all modern browsers
- 🔄 **Transform Support** - Rotation and scaling transformations

## 🎯 Live Demo

- **[Online Demo](https://gif-cropper-stdsuperman.vercel.app/)** - Try it out in your browser
- **[CodeSandbox](https://codesandbox.io/p/github/STDSuperman/codesandbox-super-image-cropper/master?workspaceId=6d860bca-a1bd-4c35-9131-07f0c5450764)** - Interactive example with CropperJS

### Preview

#### GIF Animation Cropping
<img src="https://blog-images-1257398419.cos.ap-nanjing.myqcloud.com/github/gif-transparent.png" width="657" alt="GIF Cropping Preview">

#### Static Image Cropping
<img src="https://s4.ax1x.com/2022/02/23/bPUoIf.png" width="657" alt="Static Image Cropping Preview">

## Fork development

The `ris` branch contains the maintained editor integration. Keep `master` aligned with `STDSuperman/super-image-cropper` without adding fork changes there. Upstream updates are reviewed before incorporating them into `ris`.

The repository root is the installable `super-image-cropper` package. Its exports point directly to the existing processor package, and the build includes the fork's GIF worker. Install and verify the native npm workspaces with:

```sh
mise install
mise exec -- npm ci
mise exec -- npm test
mise exec -- npm run check
```

`crop()` accepts `outputWidth` and `outputHeight` separately from the source crop rectangle, so a selected area can be resized to exact output dimensions. Omit both to retain the crop's source dimensions. It also accepts an `AbortSignal` through `signal`; aborting or calling `destroy()` cancels preparation and releases its canvases, workers, and generated URLs. Source GIF frame delays, loop counts, frame disposal, and transparency are retained during processing. GIF encoding uses the fork's worker with a reserved transparent palette index, keeping opaque black separate from transparent pixels.

Use `outputType: 'blob'` when preparing a file locally for later form submission. For example:

```ts
const cropper = new SuperImageCropper();
const image = await cropper.crop({
  src: localImageUrl,
  cropperInstance,
  outputWidth: 512,
  outputHeight: 512,
  signal: controller.signal,
  outputType: 'blob',
});
cropper.destroy();
```

The package retains the original MIT licence and includes complete third-party notices in its published files and generated bundles.

## 🚀 Quick Start

### Installation

```bash
npm install super-image-cropper
```

```bash
yarn add super-image-cropper
```

```bash
pnpm add super-image-cropper
```

### Basic Usage

#### With CropperJS (Recommended)

```html
<img id="image" src="your-image.gif" alt="Image to crop">
```

```typescript
import { SuperImageCropper } from 'super-image-cropper';
import Cropper from 'cropperjs';

// Initialize CropperJS
const image = document.getElementById('image') as HTMLImageElement;
const cropperInstance = new Cropper(image, {
  aspectRatio: 16 / 9,
  autoCrop: false,
  autoCropArea: 1,
  minCropBoxHeight: 10,
  minCropBoxWidth: 10,
  viewMode: 1,
  initialAspectRatio: 1,
  responsive: false,
  guides: true
});

// Create cropper instance
const imageCropper = new SuperImageCropper();

// Crop the image
imageCropper.crop({
  cropperInstance: cropperInstance,
  src: 'your-image.gif',
  outputType: 'blobURL' // optional, default is blobURL
}).then(blobUrl => {
  const img = document.createElement('img');
  img.src = blobUrl;
  document.body.appendChild(img);
});
```

#### Standalone Usage

```typescript
import { SuperImageCropper } from 'super-image-cropper';

const imageCropper = new SuperImageCropper();

imageCropper.crop({
  src: 'your-image.gif',
  cropperJsOpts: {
    width: 400,
    height: 240,
    rotate: 45,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1
  },
  outputType: 'base64'
}).then(result => {
  console.log('Cropped image:', result);
});
```

## 📖 API Reference

### SuperImageCropper

#### Methods

##### `crop(options: CropOptions): Promise<string | Blob>`

Crops an image based on the provided options.

##### `destroy(): void`

Cancels active processing and releases package-owned image buffers, canvases, GIF workers, and generated URLs. Call it when closing an editor or discarding its cropper instance.

#### CropOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `src` | `string` | Yes | Image URL or path |
| `crossOrigin` | `string` | No | CORS strategy for image loading |
| `cropperInstance` | `Cropper` | No | CropperJS instance (when used with CropperJS) |
| `cropperJsOpts` | `CropperJsOptions` | No | Manual cropping parameters |
| `outputWidth` | `number` | No | Resized output width in pixels |
| `outputHeight` | `number` | No | Resized output height in pixels |
| `signal` | `AbortSignal` | No | Cancel active processing |
| `gifJsOptions` | `object` | No | [gif.js](https://github.com/jnordberg/gif.js) configuration |
| `outputType` | `'base64' \| 'blob' \| 'blobURL'` | No | Output format (default: `'blobURL'`) |

#### CropperJsOptions

| Property | Type | Description |
|----------|------|-------------|
| `x` | `number` | Left offset of the cropped area |
| `y` | `number` | Top offset of the cropped area |
| `width` | `number` | Width of the cropped area |
| `height` | `number` | Height of the cropped area |
| `rotate` | `number` | Rotation angle in degrees |
| `scaleX` | `number` | Horizontal scaling factor |
| `scaleY` | `number` | Vertical scaling factor |
| `background` | `string` | Background color for GIF (optional) |

### Output Types

- **`base64`** - Returns a base64 encoded string
- **`blob`** - Returns a Blob object
- **`blobURL`** - Returns a blob URL (e.g., `blob:http://localhost:3000/8a583ca5...`)

## 🔧 Examples

### React Integration

Check out our [React example](./example/crop-gif-with-cropper) for a complete implementation with React and CropperJS.

### Advanced Usage

```typescript
import { SuperImageCropper } from 'super-image-cropper';

const cropper = new SuperImageCropper();

// Crop with custom GIF options
await cropper.crop({
  src: 'animated.gif',
  cropperJsOpts: {
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    rotate: 90,
    background: '#ffffff'
  },
  gifJsOptions: {
    quality: 10,
    workers: 2,
    workerScript: 'gif.worker.js'
  },
  outputType: 'blob'
});
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone --branch ris https://github.com/RisPNG/super-image-cropper.git
cd super-image-cropper

# Install dependencies
mise exec -- npm ci

# Build the project
mise exec -- npm run build
```

### Project Structure

```
super-image-cropper/
├── packages/
│   ├── super-image-cropper/    # Main library
│   └── gif-worker-js/          # GIF processing worker
├── example/                    # Example applications
├── docs/                       # Documentation
└── scripts/                    # Build and release scripts
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [CropperJS](https://github.com/fengyuanchen/cropperjs) - Excellent image cropping library
- [gif.js](https://github.com/jnordberg/gif.js) - GIF encoding library
- All our [contributors](https://github.com/STDSuperman/super-image-cropper/graphs/contributors)

## 📞 Support

- 🐛 [Report Issues](https://github.com/STDSuperman/super-image-cropper/issues)
- 💬 [Discussions](https://github.com/STDSuperman/super-image-cropper/discussions)
- ⭐ Star this project if it helps you!

---

<div align="center">

Made with ❤️ by [STDSuperman](https://github.com/STDSuperman)

</div>
