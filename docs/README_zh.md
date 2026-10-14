<div align="center">

# 🖼️ Super Image Cropper

</div>

<div align="center">

一个强大的JavaScript图像裁剪库，支持GIF动画、PNG、JPG等多种格式的图像裁剪。

[![npm version](https://img.shields.io/npm/v/super-image-cropper)](https://www.npmjs.com/package/super-image-cropper) [![npm downloads](https://img.shields.io/npm/dw/super-image-cropper)](https://www.npmjs.com/package/super-image-cropper) [![GitHub license](https://img.shields.io/github/license/STDSuperman/super-image-cropper)](https://github.com/STDSuperman/super-image-cropper/blob/master/LICENSE) [![GitHub stars](https://img.shields.io/github/stars/STDSuperman/super-image-cropper)](https://github.com/STDSuperman/super-image-cropper/stargazers) [![GitHub issues](https://img.shields.io/github/issues/STDSuperman/super-image-cropper)](https://github.com/STDSuperman/super-image-cropper/issues) [![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

[🌟 在线演示](https://gif-cropper-stdsuperman.vercel.app/) | [📖 文档](#文档) | [🇺🇸 English](../README.md)

</div>

## ✨ 特性

- 🎬 **GIF动画支持** - 裁剪GIF动画的同时保持动画效果
- 🖼️ **多格式支持** - 支持PNG、JPG、JPEG和GIF格式
- 🔧 **CropperJS集成** - 与流行的CropperJS库无缝集成
- 🎨 **灵活输出** - 多种输出格式：Base64、Blob或Blob URL
- ⚡ **高性能** - 针对大图像和动画进行了优化
- 🎯 **精确控制** - 对裁剪参数进行细粒度控制
- 📱 **跨平台** - 在所有现代浏览器中工作
- 🔄 **变换支持** - 支持旋转和缩放变换

## 🎯 在线体验

- **[在线演示](https://gif-cropper-stdsuperman.vercel.app/)** - 在浏览器中试用
- **[CodeSandbox](https://codesandbox.io/p/github/STDSuperman/codesandbox-super-image-cropper/master?workspaceId=6d860bca-a1bd-4c35-9131-07f0c5450764)** - 与CropperJS的交互式示例

### 预览

#### GIF动画裁剪
<img src="https://blog-images-1257398419.cos.ap-nanjing.myqcloud.com/github/gif-transparent.png" width="657" alt="GIF裁剪预览">

#### 静态图像裁剪
<img src="https://s4.ax1x.com/2022/02/23/bPUoIf.png" width="657" alt="静态图像裁剪预览">

## 🚀 快速开始

### 安装

```bash
mise exec -- npm install git+https://github.com/RisPNG/super-image-cropper.git#ris
```

```bash
mise exec -- yarn add git+https://github.com/RisPNG/super-image-cropper.git#ris
```

```bash
mise exec -- pnpm add git+https://github.com/RisPNG/super-image-cropper.git#ris
```

### 基础用法

#### 与原生Cropper.js 2配合使用（推荐）

当前集成直接使用Cropper.js 2的图像元素变换矩阵和选区。将实际的Cropper实例传入`cropperInstance`即可。已有的Cropper.js 1实例通过`getData()`提供裁剪参数，手动`cropperJsOpts`也使用同一套渲染流程，无需替换实例或添加包装器。

```html
<img id="image" src="your-image.gif" alt="要裁剪的图像">
```

```typescript
import { SuperImageCropper } from 'super-image-cropper';
import Cropper from 'cropperjs';

const image = document.getElementById('image') as HTMLImageElement;
const cropperInstance = new Cropper(image);
const cropperImage = cropperInstance.getCropperImage()!;
const selection = cropperInstance.getCropperSelection()!;
selection.aspectRatio = 16 / 9;
selection.initialCoverage = 0.8;
selection.precise = true;

await cropperImage.$ready();
selection.$reset();

const imageCropper = new SuperImageCropper();
const blobUrl = await imageCropper.crop({
  cropperInstance,
  src: image.src,
  outputWidth: 640,
  outputHeight: 360,
  outputType: 'blobURL',
}) as string;
const preview = document.createElement('img');
preview.src = blobUrl;
preview.alt = 'Cropped image';
document.body.appendChild(preview);
```

默认的Cropper.js 2模板提供图像和选区元素。在选区元素上设置比例和初始覆盖范围，并等待图像就绪后导出。在交互式编辑器中，应在用户确认选区时调用`crop()`。相同的图像变换和选区会应用到GIF的每一帧。

显示返回的Blob URL期间，请保留处理器实例。丢弃预览时调用`imageCropper.destroy()`，即可撤销这些URL并取消正在执行的导出。通过`URL.createObjectURL(file)`创建的源URL由调用方管理；编辑器仍可导出时应保留它，关闭编辑器后再撤销。需要稍后上传文件时，使用`outputType: 'blob'`；销毁处理器不会使返回的Blob失效。

#### 独立使用

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
  console.log('裁剪后的图像:', result);
});
```

## 📖 API参考

### SuperImageCropper

#### 方法

##### `crop(options: CropOptions): Promise<string | Blob>`

根据提供的选项裁剪图像。

##### `destroy(): void`

取消正在执行的处理，并释放处理器持有的图像缓冲区、画布、GIF工作线程和返回的Blob URL。

#### CropOptions

| 属性 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `src` | `string` | 否 | 图像URL或路径；省略时从传入的Cropper实例读取 |
| `crossOrigin` | `string` | 否 | 图像加载的CORS策略 |
| `cropperInstance` | `Cropper` | 否 | 原生Cropper.js 2实例，或提供`getData()`的已有Cropper.js 1实例 |
| `cropperJsOpts` | `CropperJsOptions` | 否 | 手动裁剪参数 |
| `outputWidth` | `number` | 否 | 调整后的输出宽度，单位为像素 |
| `outputHeight` | `number` | 否 | 调整后的输出高度，单位为像素 |
| `signal` | `AbortSignal` | 否 | 取消正在执行的处理 |
| `gifJsOptions` | `object` | 否 | [gif.js](https://github.com/jnordberg/gif.js) 配置 |
| `outputType` | `'base64' \| 'blob' \| 'blobURL'` | 否 | 输出格式（默认：`'blobURL'`） |

必须提供`cropperInstance`或`cropperJsOpts`。手动裁剪还需要提供`src`，Cropper实例则可以提供自身的图像源。手动偏移和尺寸描述源图像中的裁剪区域，`outputWidth`和`outputHeight`描述调整后的输出尺寸。处理器会应用源GIF的帧处置规则，并保留动画延迟、循环次数和透明度。

#### CropperJsOptions

| 属性 | 类型 | 描述 |
|------|------|------|
| `x` | `number` | 裁剪区域的左偏移 |
| `y` | `number` | 裁剪区域的顶偏移 |
| `width` | `number` | 裁剪区域的宽度 |
| `height` | `number` | 裁剪区域的高度 |
| `rotate` | `number` | 旋转角度（度） |
| `scaleX` | `number` | 水平缩放因子 |
| `scaleY` | `number` | 垂直缩放因子 |
| `background` | `string` | GIF背景色（可选） |

### 输出类型

- **`base64`** - 返回base64编码字符串
- **`blob`** - 返回Blob对象
- **`blobURL`** - 返回blob URL（例如：`blob:http://localhost:3000/8a583ca5...`）

## 🔧 示例

### React集成

查看我们的[React示例](../example/crop-gif-with-cropper)，了解与React和CropperJS的完整实现。

### 高级用法

```typescript
import { SuperImageCropper } from 'super-image-cropper';

const cropper = new SuperImageCropper();

// 使用自定义GIF选项进行裁剪
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
    workers: 2
  },
  outputType: 'blob'
});
```

## 🤝 贡献指南

我们欢迎贡献！请查看我们的[贡献指南](../CONTRIBUTING.md)了解详情。

### 开发环境设置

```bash
# 克隆仓库
git clone --branch ris https://github.com/RisPNG/super-image-cropper.git
cd super-image-cropper

# 安装依赖
mise exec -- npm ci

# 构建项目
mise exec -- npm run build
```

### 项目结构

```
super-image-cropper/
├── packages/
│   ├── super-image-cropper/    # 主库
│   └── gif-worker-js/          # GIF处理worker
├── example/                    # 示例应用
├── docs/                       # 文档
└── scripts/                    # 构建和发布脚本
```

## 📄 许可证

本项目采用MIT许可证 - 查看[LICENSE](../LICENSE)文件了解详情。

## 🙏 致谢

- [CropperJS](https://github.com/fengyuanchen/cropperjs) - 优秀的图像裁剪库
- [gif.js](https://github.com/jnordberg/gif.js) - GIF编码库
- 所有我们的[贡献者](https://github.com/STDSuperman/super-image-cropper/graphs/contributors)

## 📞 支持

- 🐛 [报告问题](https://github.com/STDSuperman/super-image-cropper/issues)
- 💬 [讨论](https://github.com/STDSuperman/super-image-cropper/discussions)
- ⭐ 如果这个项目对你有帮助，请给它一个星标！

---

<div align="center">

由 [STDSuperman](https://github.com/STDSuperman) 用 ❤️ 制作

</div>
