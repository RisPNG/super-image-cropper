import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('built root package types support ESM and CommonJS consumers with native and legacy Cropper instances', async t => {
  const cache = join(root, '.cache');
  await mkdir(cache, {recursive: true});
  const directory = await mkdtemp(join(cache, 'package-types-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await mkdir(join(directory, 'node_modules'));
  await symlink(root, join(directory, 'node_modules', 'super-image-cropper'), 'junction');
  await writeFile(join(directory, 'package.json'), JSON.stringify({private: true, type: 'module'}));
  const source = `import {SuperImageCropper, OutputType, type ICropperOptions} from 'super-image-cropper';
import {Cropper} from 'cropperjs';
const nativeCropper = new Cropper(document.createElement('img'));
const legacyCropper = {getData() { return {width: 32, height: 32}; }};
const options: ICropperOptions[] = [
  {cropperInstance: nativeCropper, outputType: OutputType.BLOB},
  {cropperInstance: legacyCropper, outputWidth: 128, outputHeight: 128},
  {src: 'image.webp', cropperJsOpts: {width: 32, height: 32}, signal: new AbortController().signal}
];
const processor = new SuperImageCropper();
const result: Promise<string | Blob> = processor.crop(options[0]);
void result;
processor.destroy();
`;
  for (const extension of ['mts', 'cts']) {
    await writeFile(join(directory, `consumer.${extension}`), source);
  }
  const compiler = spawnSync(process.execPath, [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM',
    join(directory, 'consumer.mts'), join(directory, 'consumer.cts')
  ], {cwd: directory, encoding: 'utf8'});
  assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr);
  await symlink(join(root, 'node_modules', 'cropperjs-v1'), join(directory, 'node_modules', 'cropperjs'), 'junction');
  await writeFile(join(directory, 'legacy.mts'), `import Cropper from 'cropperjs';
import {SuperImageCropper, type ICropperOptions} from 'super-image-cropper';
const cropper = new Cropper(document.createElement('img'));
const options: ICropperOptions = {cropperInstance: cropper, outputType: 'blob'};
const result: Promise<string | Blob> = new SuperImageCropper().crop(options);
void result;
`);
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'Bundler']]) {
    const legacyCompiler = spawnSync(process.execPath, [
      join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit', '--strict', '--target', 'ES2022', '--module', module,
      '--moduleResolution', resolution, '--lib', 'ES2022,DOM',
      join(directory, 'legacy.mts')
    ], {cwd: directory, encoding: 'utf8'});
    assert.equal(legacyCompiler.status, 0, legacyCompiler.stdout + legacyCompiler.stderr);
  }
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const branch of ['import', 'require']) {
    const entry = manifest.exports['.'][branch];
    await readFile(join(root, entry.default));
    await readFile(join(root, entry.types));
  }
});
