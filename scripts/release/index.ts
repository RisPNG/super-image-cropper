import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import enquirer from 'enquirer';
import { execa } from 'execa';
import { release } from './release.js';

try {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      version: { type: 'string' },
      dry: { type: 'boolean' },
      'dry-run': { type: 'boolean' }
    }
  });
  const npmPath = process.env.npm_execpath;
  if (!npmPath) throw new Error('Run releases through mise exec -- npm run release.');

  await release({
    rootDir: fileURLToPath(new URL('../../', import.meta.url)),
    project: values.project,
    version: values.version,
    dryRun: values.dry || values['dry-run'],
    async prompt(question) {
      const answer = await enquirer.prompt<Record<string, string | boolean>>(question);
      return answer[question.name];
    },
    async run(command, args, options) {
      const result = await execa(
        command === 'npm' ? process.execPath : command,
        command === 'npm' ? [npmPath, ...args] : args,
        {
          ...options,
          stdio: command === 'npm' && ['test', 'run'].includes(args[0]) ? 'inherit' : 'pipe'
        }
      );
      return {
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      };
    },
    log(message) {
      console.log(message);
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
