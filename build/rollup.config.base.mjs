import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { build } from 'esbuild';

export const generateRollupConfig = ({ input, rootDir }) => {
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  const notices = readFileSync(new URL('../THIRD-PARTY-NOTICES', import.meta.url), 'utf8');

  return ['cjs', 'es'].map((format) => {
    const outputDir = `${rootDir}/${format === 'cjs' ? 'dist' : 'esm'}`;

    return {
      input,
      external: (id) => !id.startsWith('.') && !isAbsolute(id) && id !== 'gif-build-worker-js',
      output: {
        dir: outputDir,
        format,
        entryFileNames: format === 'cjs' ? '[name].cjs' : '[name].js',
        chunkFileNames: format === 'cjs' ? '[name]-[hash].cjs' : '[name]-[hash].js',
        sourcemap: true,
        banner: `/*!\n${license}\n${notices}\n*/`,
      },
      plugins: [
        {
          name: 'inline-worker',
          resolveId(source, importer) {
            if (source.endsWith('?worker') && importer) {
              return resolve(dirname(importer), source.slice(0, -7) + '.ts') + '?worker';
            }
          },
          async load(id) {
            if (!id.endsWith('?worker')) return null;
            const result = await build({
              entryPoints: [id.slice(0, -7)],
              bundle: true,
              write: false,
              platform: 'browser',
              format: 'iife',
              target: 'es2020',
              loader: { '.wasm': 'binary' },
              define: { 'import.meta': '{}' },
              legalComments: 'inline',
            });
            return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
          },
        },
        nodeResolve({ browser: true, resolveOnly: ['gif-build-worker-js'] }),
        commonjs(),
        typescript({
          tsconfigOverride: { compilerOptions: { declarationDir: outputDir } },
          useTsconfigDeclarationDir: true,
        }),
      ],
    };
  });
};
