import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { release } from '../release/release.ts';

async function createProject(t, version = '1.0.0') {
  const rootDir = await mkdtemp(join(tmpdir(), 'cropper release fixture '));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(join(rootDir, 'packages', 'super-image-cropper'), { recursive: true });
  await mkdir(join(rootDir, 'packages', 'gif-worker-js'), { recursive: true });
  const manifest = {
    name: 'super-image-cropper',
    version,
    private: false,
    workspaces: ['packages/*']
  };
  await writeFile(join(rootDir, 'package.json'), JSON.stringify(manifest));
  await writeFile(
    join(rootDir, 'packages', 'super-image-cropper', 'package.json'),
    JSON.stringify({
      name: 'super-image-cropper',
      version,
      dependencies: { 'gif-build-worker-js': '1.0.3' }
    })
  );
  await writeFile(
    join(rootDir, 'packages', 'gif-worker-js', 'package.json'),
    JSON.stringify({ name: 'gif-build-worker-js', version: '1.0.3' })
  );
  await writeFile(
    join(rootDir, 'package-lock.json'),
    JSON.stringify({
      name: manifest.name,
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': manifest,
        'packages/super-image-cropper': {
          version,
          dependencies: { 'gif-build-worker-js': '1.0.3' }
        },
        'packages/gif-worker-js': { name: 'gif-build-worker-js', version: '1.0.3' },
        'node_modules/super-image-cropper': {
          resolved: 'packages/super-image-cropper',
          link: true
        },
        'node_modules/gif-build-worker-js': { resolved: 'packages/gif-worker-js', link: true }
      }
    })
  );
  return rootDir;
}

function createRelease(rootDir, overrides = {}) {
  const state = {
    head: 'before-release',
    localTag: '',
    remoteTag: '',
    remoteBranch: 'before-release',
    dirty: '',
    published: false,
    git: true,
    push: true,
    publish: true,
    ...overrides
  };
  const events = [];
  const logs = [];
  const options = {
    rootDir,
    project: 'super-image-cropper',
    version: '1.0.1',
    log(message) {
      logs.push(message);
    },
    async prompt(question) {
      events.push({ prompt: question.name, message: question.message });
      assert.ok(
        ['git', 'push', 'publish'].includes(question.name),
        `Unexpected prompt ${question.name}`
      );
      return state[question.name];
    },
    async run(command, args, options) {
      events.push({ command, args, ...options });
      let stdout = '';
      if (command === 'git') {
        if (args[0] === 'branch') stdout = 'ris\n';
        else if (args[0] === 'rev-parse') {
          stdout = args[1] === 'HEAD' ? state.head : state.localTag;
        } else if (args[0] === 'show-ref') {
          return { exitCode: state.localTag ? 0 : 1, stdout: state.localTag, stderr: '' };
        } else if (args[0] === 'ls-remote') {
          stdout = `${state.remoteBranch}\trefs/heads/ris\n`;
          if (state.remoteTag) {
            stdout += `annotated-tag-object\trefs/tags/super-image-cropper@1.0.1\n`;
            stdout += `${state.remoteTag}\trefs/tags/super-image-cropper@1.0.1^{}\n`;
          }
        } else if (args[0] === 'status') stdout = state.dirty;
        else if (args[0] === 'diff') stdout = 'release manifest changes';
        else if (args[0] === 'log') stdout = 'release super-image-cropper 1.0.1';
        else if (args[0] === 'add') assert.equal(args[1], '--');
        else if (args[0] === 'commit') {
          state.head = 'release-commit';
          state.dirty = '';
        } else if (args[0] === 'tag') {
          assert.equal(state.localTag, '');
          state.localTag = args[2];
        } else if (args[0] === 'push') {
          if (state.failBranchOnce && args[2].startsWith('HEAD:')) {
            state.failBranchOnce = false;
            throw new Error('Branch push interrupted');
          }
          if (args[2].startsWith('HEAD:')) state.remoteBranch = state.head;
          else state.remoteTag = state.localTag;
        } else assert.fail(`Unexpected Git command: ${args.join(' ')}`);
      } else if (args[0] === 'version') {
        const directory = args[args.indexOf('--prefix') + 1];
        const manifestPath = join(directory, 'package.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        manifest.version = args[1];
        await writeFile(manifestPath, JSON.stringify(manifest));
        state.dirty += ` M ${relative(rootDir, manifestPath).split(sep).join('/')}\0`;
      } else if (args[0] === 'pkg') {
        assert.equal(args[1], 'set');
        const directory = args[args.indexOf('--prefix') + 1];
        const manifestPath = join(directory, 'package.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const [key, value] = args[2].split('=');
        assert.equal(key, 'dependencies[gif-build-worker-js]');
        manifest.dependencies['gif-build-worker-js'] = value;
        await writeFile(manifestPath, JSON.stringify(manifest));
        state.dirty += ` M ${relative(rootDir, manifestPath).split(sep).join('/')}\0`;
      } else if (args[0] === 'view') {
        if (state.registryInvalidJson) {
          return {
            exitCode: 1,
            stdout: '<html>Bad gateway</html>',
            stderr: 'Registry returned invalid JSON'
          };
        }
        if (state.registryError) {
          return {
            exitCode: 1,
            stdout: JSON.stringify({ error: { code: state.registryError } }),
            stderr: 'Registry unavailable'
          };
        }
        return state.published
          ? { exitCode: 0, stdout: JSON.stringify(options.version || '1.0.1'), stderr: '' }
          : { exitCode: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' };
      } else if (args[0] === 'publish') {
        if (state.failPublishAfterUploadOnce) {
          state.failPublishAfterUploadOnce = false;
          state.published = true;
          throw new Error('Publication response interrupted');
        }
        state.published = true;
      } else {
        assert.ok(
          ['install', 'test', 'run'].includes(args[0]),
          `Unexpected npm command ${args[0]}`
        );
        if (args[0] === 'install') state.dirty += ' M package-lock.json\0';
      }
      return { exitCode: 0, stdout, stderr: '' };
    }
  };
  return { options, state, events, logs };
}

test('dry run previews a release without prompts, commands, or file changes', async t => {
  const rootDir = await createProject(t);
  const { options, events, logs } = createRelease(rootDir);
  const manifestBefore = await readFile(join(rootDir, 'package.json'), 'utf8');
  const lockBefore = await readFile(join(rootDir, 'package-lock.json'), 'utf8');
  await release({ ...options, dryRun: true });
  assert.deepEqual(events, []);
  assert.equal(await readFile(join(rootDir, 'package.json'), 'utf8'), manifestBefore);
  assert.equal(await readFile(join(rootDir, 'package-lock.json'), 'utf8'), lockBefore);
  assert.ok(logs.some(message => message.includes('release super-image-cropper 1.0.1')));
  assert.ok(logs.some(message => message.includes('Dry run complete')));
});

test('declining Git performs no Git commands while still allowing publication', async t => {
  const rootDir = await createProject(t);
  const { options, events, state } = createRelease(rootDir, { git: false });
  await release(options);
  assert.equal(
    events.some(event => event.command === 'git'),
    false
  );
  assert.equal(
    events.some(event => event.prompt === 'push'),
    false
  );
  assert.equal(state.published, true);
  assert.equal(events.find(event => event.args?.[0] === 'publish').cwd, rootDir);
});

test('declining the final Git approval skips commits, tags, and pushes', async t => {
  const rootDir = await createProject(t);
  const { options, events, state } = createRelease(rootDir, { push: false });
  await release(options);
  assert.equal(
    events.some(
      event => event.command === 'git' && ['add', 'commit', 'tag', 'push'].includes(event.args[0])
    ),
    false
  );
  assert.equal(state.localTag, '');
  assert.equal(state.published, true);
});

test('release checks and approved commit precede pushes and npm publication', async t => {
  const rootDir = await createProject(t);
  const { options, events } = createRelease(rootDir);
  await release(options);
  const commands = events.filter(event => event.command);
  const commit = commands.find(event => event.args[0] === 'commit');
  assert.deepEqual(commit.args, ['commit', '-m', 'release super-image-cropper 1.0.1']);
  assert.deepEqual(commands.find(event => event.args[0] === 'add').args, [
    'add',
    '--',
    'package.json',
    'packages/super-image-cropper/package.json',
    'package-lock.json'
  ]);
  const checkIndex = events.findIndex(event => event.command === 'npm' && event.args[1] === 'lint');
  const approvalIndex = events.findIndex(event => event.prompt === 'push');
  const commitIndex = events.indexOf(commit);
  const pushIndex = events.findIndex(event => event.args?.[0] === 'push');
  const publishApproval = events.findIndex(event => event.prompt === 'publish');
  const publication = events.findIndex(event => event.args?.[0] === 'publish');
  assert.ok(checkIndex < approvalIndex && approvalIndex < commitIndex);
  assert.ok(
    commitIndex < pushIndex && pushIndex < publishApproval && publishApproval < publication
  );
  assert.match(events[approvalIndex].message, /release super-image-cropper 1\.0\.1/);
  assert.equal(
    commands.some(event => event.args.some(arg => arg.includes('pnpm'))),
    false
  );
});

test('a retry after a branch push failure reuses the release commit and local tag', async t => {
  const rootDir = await createProject(t);
  const { options, events, state } = createRelease(rootDir, { failBranchOnce: true });
  await assert.rejects(release(options), /Branch push interrupted/);
  assert.equal(state.localTag, 'release-commit');
  await release(options);
  assert.equal(events.filter(event => event.args?.[0] === 'commit').length, 1);
  assert.equal(events.filter(event => event.args?.[0] === 'tag').length, 1);
  assert.equal(events.filter(event => event.args?.[0] === 'version').length, 2);
  assert.equal(events.filter(event => event.args?.[0] === 'publish').length, 1);
  assert.equal(state.remoteTag, 'release-commit');
});

test('an interrupted publication is recovered from registry state without duplicate artifacts', async t => {
  const rootDir = await createProject(t);
  const { options, events, state } = createRelease(rootDir, { failPublishAfterUploadOnce: true });
  await assert.rejects(release(options), /Publication response interrupted/);
  assert.equal(state.remoteTag, state.head);
  const checkpoint = events.length;
  await release(options);
  const retry = events.slice(checkpoint);
  assert.equal(
    retry.some(
      event => event.command === 'git' && ['add', 'commit', 'tag', 'push'].includes(event.args[0])
    ),
    false
  );
  assert.equal(
    retry.some(event => event.args?.[0] === 'version'),
    false
  );
  assert.equal(
    retry.some(event => event.args?.[0] === 'publish'),
    false
  );
  assert.equal(
    retry.some(event => event.prompt === 'publish'),
    false
  );
});

for (const tagLocation of ['localTag', 'remoteTag']) {
  test(`a ${tagLocation} at a different commit stops the release before changes`, async t => {
    const rootDir = await createProject(t);
    const { options, events } = createRelease(rootDir, { [tagLocation]: 'different-commit' });
    await assert.rejects(release(options), /points to a different commit/);
    assert.equal(
      events.some(event => event.command === 'npm'),
      false
    );
    assert.equal(
      events.some(
        event => event.command === 'git' && ['add', 'commit', 'tag', 'push'].includes(event.args[0])
      ),
      false
    );
  });
}

test('a remote annotated tag is compared using its peeled commit', async t => {
  const rootDir = await createProject(t, '1.0.1');
  const { options, events } = createRelease(rootDir, {
    head: 'release-commit',
    remoteTag: 'release-commit',
    remoteBranch: 'release-commit',
    published: true
  });
  await release(options);
  assert.equal(
    events.some(
      event => event.command === 'git' && ['add', 'commit', 'tag', 'push'].includes(event.args[0])
    ),
    false
  );
});

test('registry authentication and network failures never become a publication attempt', async t => {
  for (const registryError of ['E401', 'ECONNRESET']) {
    const rootDir = await createProject(t);
    const { options, events } = createRelease(rootDir, { registryError });
    await assert.rejects(release(options), /Registry unavailable/);
    assert.equal(
      events.some(
        event => event.command === 'git' && ['add', 'commit', 'tag', 'push'].includes(event.args[0])
      ),
      false
    );
    assert.equal(
      events.some(event => event.args?.[0] === 'publish'),
      false
    );
  }
});

test('invalid registry JSON stops before Git mutations or publication and reports the response', async t => {
  const rootDir = await createProject(t);
  const { options, events } = createRelease(rootDir, { registryInvalidJson: true });
  await assert.rejects(
    release(options),
    /Unable to read the npm response.*Registry returned invalid JSON/
  );
  assert.equal(
    events.some(
      event => event.command === 'git' && ['add', 'commit', 'tag', 'push'].includes(event.args[0])
    ),
    false
  );
  assert.equal(
    events.some(event => event.args?.[0] === 'publish'),
    false
  );
});

test('unrelated pending changes are not swept into a release commit', async t => {
  const rootDir = await createProject(t);
  const { options, events } = createRelease(rootDir, { dirty: ' M src/unrelated.ts\0' });
  await assert.rejects(release(options), /Commit unrelated changes/);
  assert.equal(
    events.some(event => event.command === 'npm'),
    false
  );
});

test('a tagged checkout with the wrong package version cannot be resumed', async t => {
  const rootDir = await createProject(t);
  const { options } = createRelease(rootDir, { localTag: 'before-release' });
  await assert.rejects(release(options), /clean checkout/);
});

test('invalid package or version stops before commands or approvals', async t => {
  const rootDir = await createProject(t);
  const { options, events } = createRelease(rootDir);
  await assert.rejects(release({ ...options, version: 'invalid' }), /Invalid release version/);
  await assert.rejects(release({ ...options, project: 'unknown' }), /Unknown release package/);
  assert.deepEqual(events, []);
});

test('native npm updates the root, processor, and lockfile without changing the GIF worker', async t => {
  const rootDir = await createProject(t);
  const { options } = createRelease(rootDir, { git: false, publish: false });
  const run = options.run;
  const npmPath =
    process.env.npm_execpath ||
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  await release({
    ...options,
    async run(command, args, options) {
      if (command === 'npm' && ['version', 'install'].includes(args[0])) {
        const result = await promisify(execFile)(process.execPath, [npmPath, ...args], {
          cwd: options.cwd
        });
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
      }
      return run(command, args, options);
    }
  });
  assert.equal(JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')).version, '1.0.1');
  assert.equal(
    JSON.parse(
      await readFile(join(rootDir, 'packages', 'super-image-cropper', 'package.json'), 'utf8')
    ).version,
    '1.0.1'
  );
  assert.equal(
    JSON.parse(await readFile(join(rootDir, 'packages', 'gif-worker-js', 'package.json'), 'utf8'))
      .version,
    '1.0.3'
  );
  const lock = JSON.parse(await readFile(join(rootDir, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '1.0.1');
  assert.equal(lock.packages[''].version, '1.0.1');
  assert.equal(lock.packages['packages/super-image-cropper'].version, '1.0.1');
  assert.equal(lock.packages['packages/gif-worker-js'].version, '1.0.3');
});

test('the GIF workspace can be selected by folder and publishes from its own directory', async t => {
  const rootDir = await createProject(t);
  const { options, events } = createRelease(rootDir, { git: false });
  await release({ ...options, project: 'gif-worker-js', version: '1.0.4' });
  const versionCommands = events.filter(event => event.args?.[0] === 'version');
  assert.equal(versionCommands.length, 1);
  assert.equal(versionCommands[0].args.at(-1), join(rootDir, 'packages', 'gif-worker-js'));
  assert.equal(
    events.find(event => event.args?.[0] === 'publish').cwd,
    join(rootDir, 'packages', 'gif-worker-js')
  );
  assert.equal(JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')).version, '1.0.0');
  const processor = JSON.parse(
    await readFile(join(rootDir, 'packages', 'super-image-cropper', 'package.json'), 'utf8')
  );
  assert.equal(processor.version, '1.0.0');
  assert.equal(processor.dependencies['gif-build-worker-js'], '1.0.4');
});

test('a worker release includes the dependent processor pin in its plan and commit', async t => {
  const rootDir = await createProject(t);
  const { options, events, logs } = createRelease(rootDir);
  await release({ ...options, project: 'gif-worker-js', version: '1.0.4' });
  assert.deepEqual(events.find(event => event.args?.[0] === 'add').args, [
    'add',
    '--',
    'packages/gif-worker-js/package.json',
    'packages/super-image-cropper/package.json',
    'package-lock.json'
  ]);
  assert.ok(
    logs.some(
      message =>
        message.includes('packages/super-image-cropper/package.json') &&
        message.includes('gif-build-worker-js') &&
        message.includes('1.0.4')
    )
  );
  assert.deepEqual(events.find(event => event.args?.[0] === 'commit').args, [
    'commit',
    '-m',
    'release gif-build-worker-js 1.0.4'
  ]);
});

test('a tagged worker release with a stale processor pin cannot be resumed', async t => {
  const rootDir = await createProject(t);
  await writeFile(
    join(rootDir, 'packages', 'gif-worker-js', 'package.json'),
    JSON.stringify({ name: 'gif-build-worker-js', version: '1.0.4' })
  );
  const { options, events } = createRelease(rootDir, { localTag: 'before-release' });
  await assert.rejects(
    release({ ...options, project: 'gif-worker-js', version: '1.0.4' }),
    /clean checkout/
  );
  assert.equal(
    events.some(event => event.command === 'npm'),
    false
  );
});

test('native npm releases the worker with its real dependent pin and an empty offline cache', async t => {
  const rootDir = await createProject(t);
  const { options } = createRelease(rootDir, { git: false, publish: false });
  const run = options.run;
  const npmPath =
    process.env.npm_execpath ||
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const cacheDir = join(rootDir, 'empty npm cache');
  await release({
    ...options,
    project: 'gif-worker-js',
    version: '1.0.4',
    async run(command, args, options) {
      if (command === 'npm' && ['version', 'pkg', 'install'].includes(args[0])) {
        const result = await promisify(execFile)(
          process.execPath,
          [npmPath, ...args, '--cache', cacheDir],
          { cwd: options.cwd }
        );
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
      }
      return run(command, args, options);
    }
  });
  const rootPackage = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  const processor = JSON.parse(
    await readFile(join(rootDir, 'packages', 'super-image-cropper', 'package.json'), 'utf8')
  );
  const worker = JSON.parse(
    await readFile(join(rootDir, 'packages', 'gif-worker-js', 'package.json'), 'utf8')
  );
  const lock = JSON.parse(await readFile(join(rootDir, 'package-lock.json'), 'utf8'));
  assert.equal(rootPackage.version, '1.0.0');
  assert.equal(processor.version, '1.0.0');
  assert.equal(processor.dependencies['gif-build-worker-js'], '1.0.4');
  assert.equal(worker.version, '1.0.4');
  assert.equal(lock.version, '1.0.0');
  assert.equal(lock.packages[''].version, '1.0.0');
  assert.equal(lock.packages['packages/super-image-cropper'].version, '1.0.0');
  assert.equal(
    lock.packages['packages/super-image-cropper'].dependencies['gif-build-worker-js'],
    '1.0.4'
  );
  assert.equal(lock.packages['packages/gif-worker-js'].version, '1.0.4');
  assert.equal(lock.packages['node_modules/gif-build-worker-js'].link, true);
  assert.equal(
    lock.packages['node_modules/gif-build-worker-js'].resolved,
    'packages/gif-worker-js'
  );
});

test('native Git resumes a failed push using its existing local tag', async t => {
  const rootDir = await createProject(t);
  const remoteDir = await mkdtemp(join(tmpdir(), 'cropper release remote '));
  t.after(() => rm(remoteDir, { recursive: true, force: true }));
  const exec = promisify(execFile);
  await exec('git', ['init', '--initial-branch=ris', rootDir]);
  await exec('git', ['init', '--bare', remoteDir]);
  await exec('git', ['config', 'user.name', 'Release Fixture'], { cwd: rootDir });
  await exec('git', ['config', 'user.email', 'release-fixture@example.invalid'], { cwd: rootDir });
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: rootDir });
  await exec('git', ['config', 'tag.gpgsign', 'false'], { cwd: rootDir });
  await exec('git', ['add', '.'], { cwd: rootDir });
  await exec('git', ['commit', '-m', 'prepare release fixture'], { cwd: rootDir });
  await exec('git', ['remote', 'add', 'origin', remoteDir], { cwd: rootDir });
  const { options, state } = createRelease(rootDir);
  const run = options.run;
  const gitCommands = [];
  let failPush = true;
  const nativeOptions = {
    ...options,
    async run(command, args, options) {
      if (command !== 'git') return run(command, args, options);
      gitCommands.push(args);
      if (args[0] === 'push' && failPush) {
        failPush = false;
        throw new Error('Push interrupted before transfer');
      }
      try {
        const result = await exec('git', args, { cwd: options.cwd });
        return { exitCode: 0, ...result };
      } catch (error) {
        if (options.reject !== false) throw error;
        return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
      }
    }
  };
  await assert.rejects(release(nativeOptions), /Push interrupted/);
  const localTag = await exec('git', ['rev-parse', 'super-image-cropper@1.0.1^{commit}'], {
    cwd: rootDir
  });
  state.dirty = '';
  await release(nativeOptions);
  const remoteTag = await exec(
    'git',
    ['rev-parse', 'refs/tags/super-image-cropper@1.0.1^{commit}'],
    { cwd: remoteDir }
  );
  assert.equal(localTag.stdout, remoteTag.stdout);
  assert.equal(gitCommands.filter(args => args[0] === 'commit').length, 1);
  assert.equal(gitCommands.filter(args => args[0] === 'tag').length, 1);
  assert.equal(state.published, true);
});
