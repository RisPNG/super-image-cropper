import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import semver from 'semver';

interface ReleaseOptions {
  rootDir: string;
  project?: string;
  version?: string;
  dryRun?: boolean;
  prompt: (question: {
    type: 'select' | 'input' | 'confirm';
    name: string;
    message: string;
    choices?: { name: string; message: string }[];
    initial?: boolean;
  }) => Promise<string | boolean>;
  run: (
    command: 'npm' | 'git',
    args: string[],
    options: { cwd: string; reject?: boolean }
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  log: (message: string) => void;
}

export async function release({
  rootDir,
  project,
  version,
  dryRun,
  prompt,
  run,
  log
}: ReleaseOptions): Promise<void> {
  const rootPackage = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  const workspacePackages = await Promise.all(
    (
      await readdir(join(rootDir, 'packages'), { withFileTypes: true })
    )
      .filter(entry => entry.isDirectory())
      .map(async entry => ({
        directory: join(rootDir, 'packages', entry.name),
        manifest: JSON.parse(
          await readFile(join(rootDir, 'packages', entry.name, 'package.json'), 'utf8')
        )
      }))
  );
  const projects = [
    { directory: rootDir, manifest: rootPackage },
    ...workspacePackages.filter(workspace => workspace.manifest.name !== rootPackage.name)
  ];
  const projectName =
    project ??
    (await prompt({
      type: 'select',
      name: 'project',
      message: 'Select package',
      choices: projects.map(item => ({
        name: item.manifest.name,
        message: item.manifest.name
      }))
    }));
  const selected = projects.find(
    item => item.manifest.name === projectName || basename(item.directory) === projectName
  );
  if (!selected) throw new Error(`Unknown release package: ${projectName}`);

  const currentVersion = selected.manifest.version;
  let targetVersion = version;
  if (!targetVersion) {
    targetVersion = String(
      await prompt({
        type: 'select',
        name: 'version',
        message: 'Select release version',
        choices: [
          { name: currentVersion, message: `current (${currentVersion}), resume a release` },
          ...(['patch', 'minor', 'major'] as const).map(type => ({
            name: semver.inc(currentVersion, type)!,
            message: `${type} (${semver.inc(currentVersion, type)})`
          })),
          {
            name: semver.inc(currentVersion, 'prerelease', 'beta')!,
            message: `beta (${semver.inc(currentVersion, 'prerelease', 'beta')})`
          },
          { name: 'custom', message: 'custom' }
        ]
      })
    );
    if (targetVersion === 'custom') {
      targetVersion = String(
        await prompt({ type: 'input', name: 'version', message: 'Enter release version' })
      );
    }
  }
  const normalizedVersion = semver.valid(targetVersion);
  if (!normalizedVersion) throw new Error(`Invalid release version: ${targetVersion}`);
  targetVersion = normalizedVersion;

  const packageName = selected.manifest.name;
  const releaseTag = `${packageName}@${targetVersion}`;
  const subject = `release ${packageName} ${targetVersion}`;
  const publishTag = semver.prerelease(targetVersion) ? 'beta' : 'latest';
  const versionPackages =
    selected.directory === rootDir
      ? [selected, ...workspacePackages.filter(item => item.manifest.name === packageName)]
      : [selected];
  const dependentPackages = [
    { directory: rootDir, manifest: rootPackage },
    ...workspacePackages
  ].filter(item => item.manifest.dependencies?.[packageName] !== undefined);
  const releaseFiles = [
    ...[...versionPackages, ...dependentPackages].map(item =>
      relative(rootDir, join(item.directory, 'package.json')).split(sep).join('/')
    ),
    'package-lock.json'
  ];

  log(`Release ${releaseTag} from ${selected.directory}`);
  log(
    `Set ${versionPackages
      .map(item => relative(rootDir, join(item.directory, 'package.json')).split(sep).join('/'))
      .join(', ')} to ${targetVersion} using npm version.`
  );
  if (dependentPackages.length) {
    log(
      `Set the ${packageName} dependency to ${targetVersion} in ${dependentPackages
        .map(item => relative(rootDir, join(item.directory, 'package.json')).split(sep).join('/'))
        .join(', ')} using npm pkg set. Their package versions stay unchanged.`
    );
  }
  log('Refresh package-lock.json offline.');
  log('Run npm test (including the build), npm run check, and npm run lint.');
  log(
    `Git, if approved: commit "${subject}", tag ${releaseTag}, and push the branch and tag to origin.`
  );
  log(`Publish ${packageName}@${targetVersion} to npm with the ${publishTag} tag.`);
  log('Reuse matching Git tags and published npm versions when resuming the same version.');
  if (dryRun) {
    log('Dry run complete. No commands or file changes were made.');
    return;
  }

  const useGit = await prompt({
    type: 'confirm',
    name: 'git',
    message: 'Include Git commit, tag, and push actions?',
    initial: false
  });
  let head = '';
  let branch = '';
  let localTag = '';
  let remoteTag = '';
  let remoteBranch = '';
  if (useGit) {
    branch = (await run('git', ['branch', '--show-current'], { cwd: rootDir })).stdout.trim();
    if (!branch) throw new Error('Check out a branch before creating a Git release.');
    head = (await run('git', ['rev-parse', 'HEAD'], { cwd: rootDir })).stdout.trim();
    const tagResult = await run(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/tags/${releaseTag}`],
      { cwd: rootDir, reject: false }
    );
    if (tagResult.exitCode === 0) {
      localTag = (
        await run('git', ['rev-parse', `${releaseTag}^{commit}`], { cwd: rootDir })
      ).stdout.trim();
    } else if (tagResult.exitCode !== 1) {
      throw new Error(tagResult.stderr || 'Unable to inspect the local release tag.');
    }
    const remote = await run(
      'git',
      [
        'ls-remote',
        'origin',
        `refs/heads/${branch}`,
        `refs/tags/${releaseTag}`,
        `refs/tags/${releaseTag}^{}`
      ],
      { cwd: rootDir }
    );
    const remoteRefs = new Map(
      remote.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [hash, ref] = line.split('\t');
          return [ref, hash];
        })
    );
    remoteTag =
      remoteRefs.get(`refs/tags/${releaseTag}^{}`) ||
      remoteRefs.get(`refs/tags/${releaseTag}`) ||
      '';
    remoteBranch = remoteRefs.get(`refs/heads/${branch}`) || '';
    if ((localTag && localTag !== head) || (remoteTag && remoteTag !== head)) {
      throw new Error(
        `Release tag ${releaseTag} points to a different commit. Check out its commit or choose a new version.`
      );
    }
    const status = await run('git', ['status', '--porcelain=v1', '-z'], { cwd: rootDir });
    const changedFiles = status.stdout
      .split('\0')
      .filter(Boolean)
      .map(entry => entry.slice(3));
    if (changedFiles.some(file => !releaseFiles.includes(file))) {
      throw new Error(
        'Commit unrelated changes before releasing. Only release manifests and package-lock.json may be pending.'
      );
    }
    if (localTag || remoteTag) {
      if (
        changedFiles.length ||
        versionPackages.some(item => item.manifest.version !== targetVersion) ||
        dependentPackages.some(item => item.manifest.dependencies[packageName] !== targetVersion)
      ) {
        throw new Error(`Restore a clean checkout of ${releaseTag} before resuming its release.`);
      }
      log(`Reuse ${releaseTag} at ${head}.`);
    }
  } else {
    log('Git actions skipped. No Git commits, tags, or pushes will run.');
  }

  if (!localTag && !remoteTag) {
    for (const item of versionPackages) {
      await run(
        'npm',
        [
          'version',
          targetVersion,
          '--no-git-tag-version',
          '--ignore-scripts',
          '--allow-same-version',
          '--workspaces=false',
          '--prefix',
          item.directory
        ],
        { cwd: rootDir }
      );
    }
    for (const item of dependentPackages) {
      await run(
        'npm',
        [
          'pkg',
          'set',
          `dependencies[${packageName}]=${targetVersion}`,
          '--workspaces=false',
          '--prefix',
          item.directory
        ],
        { cwd: rootDir }
      );
    }
    await run(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--offline',
        '--no-audit',
        '--no-fund'
      ],
      { cwd: rootDir }
    );
  }
  await run('npm', ['test'], { cwd: rootDir });
  await run('npm', ['run', 'check'], { cwd: rootDir });
  await run('npm', ['run', 'lint'], { cwd: rootDir });

  const registry = await run(
    'npm',
    [
      'view',
      `${packageName}@${targetVersion}`,
      'version',
      '--json',
      '--registry=https://registry.npmjs.org/',
      '--loglevel=silent'
    ],
    { cwd: rootDir, reject: false }
  );
  let registryResponse;
  try {
    registryResponse = JSON.parse(registry.stdout || '{}');
  } catch {
    throw new Error(
      `Unable to read the npm response for ${releaseTag}: ${registry.stderr || registry.stdout}`
    );
  }
  const alreadyPublished = registry.exitCode === 0 && registryResponse === targetVersion;
  if (!alreadyPublished && (registry.exitCode === 0 || registryResponse.error?.code !== 'E404')) {
    throw new Error(registry.stderr || `Unable to check npm publication of ${releaseTag}.`);
  }

  if (useGit) {
    const status = await run('git', ['status', '--porcelain=v1', '-z'], { cwd: rootDir });
    const changedFiles = status.stdout
      .split('\0')
      .filter(Boolean)
      .map(entry => entry.slice(3));
    if (changedFiles.some(file => !releaseFiles.includes(file))) {
      throw new Error(
        'Checks changed files outside the release manifests. Review and commit them before releasing.'
      );
    }
    if ((localTag || remoteTag) && changedFiles.length) {
      throw new Error(`Checks changed the tagged checkout. Restore ${releaseTag} before resuming.`);
    }
    if (changedFiles.length) {
      log(
        (await run('git', ['diff', '--stat', 'HEAD', '--', ...releaseFiles], { cwd: rootDir }))
          .stdout
      );
      log(`Proposed commit: ${subject}`);
    } else {
      const currentSubject = (
        await run('git', ['log', '-1', '--format=%s'], { cwd: rootDir })
      ).stdout.trim();
      log(`Reuse commit ${head}: ${currentSubject}`);
    }
    const confirmGit = await prompt({
      type: 'confirm',
      name: 'push',
      message: changedFiles.length
        ? `Commit "${subject}", tag ${releaseTag}, and push to origin/${branch}?`
        : `Use commit ${head} for ${releaseTag} and push to origin/${branch}?`,
      initial: false
    });
    if (confirmGit) {
      if (changedFiles.length) {
        await run('git', ['add', '--', ...releaseFiles], { cwd: rootDir });
        await run('git', ['commit', '-m', subject], { cwd: rootDir });
        head = (await run('git', ['rev-parse', 'HEAD'], { cwd: rootDir })).stdout.trim();
      }
      if (!localTag && !remoteTag) {
        await run('git', ['tag', releaseTag, head], { cwd: rootDir });
      }
      if (remoteBranch !== head) {
        await run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: rootDir });
      }
      if (!remoteTag) {
        await run('git', ['push', 'origin', `refs/tags/${releaseTag}`], { cwd: rootDir });
      }
    } else {
      log('Git actions skipped. No commits, tags, or pushes were made.');
    }
  }

  if (alreadyPublished) {
    log(`${releaseTag} is already published. No duplicate publication was attempted.`);
    return;
  }
  const confirmPublish = await prompt({
    type: 'confirm',
    name: 'publish',
    message: `Publish ${releaseTag} to npm with the ${publishTag} tag?`,
    initial: false
  });
  if (!confirmPublish) {
    log('Publication skipped. Resume with the same project and version when ready.');
    return;
  }
  await run(
    'npm',
    ['publish', '--registry=https://registry.npmjs.org/', '--access=public', '--tag', publishTag],
    { cwd: selected.directory }
  );
  log(`Published ${releaseTag}.`);
}
