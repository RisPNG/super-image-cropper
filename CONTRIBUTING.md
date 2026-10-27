# Contributing to Super Image Cropper

The `ris` branch contains the maintained fork. Keep `master` aligned with upstream and propose fork changes against `ris`.

## Development setup

Install [mise](https://mise.jdx.dev/) and Git, then clone the fork and install the Node.js version declared in `mise.toml`:

```sh
git clone --branch ris https://github.com/RisPNG/super-image-cropper.git
cd super-image-cropper
mise install
mise exec -- npm ci
```

Use the root npm workspace commands and `package-lock.json` for dependency changes.

## Project structure

```text
super-image-cropper/
|-- packages/
|   |-- super-image-cropper/    Main processor package
|   `-- gif-worker-js/          GIF encoding worker
|-- build/                     Shared build configuration
|-- docs/                      Documentation
`-- scripts/                   Release utilities
```

## Making changes

Follow the existing implementation and keep shared image transforms in the processor's rendering pipeline. Update the English and Chinese documentation when behaviour or the public API changes. Keep usage snippets focused on the library API.

Run the canonical checks from the repository root:

```sh
mise exec -- npm test
mise exec -- npm run check
mise exec -- npm run lint
```

`npm test` builds the packages before running the worker, processor, and release tests, including real WebP encoding. `npm run check` verifies both packages and the release scripts. The lint command reports source issues without changing files.

Use `mise exec -- npm run build` for a build without tests. Apply formatting with `mise exec -- npm run format:fix` when needed.

## Commit messages and pull requests

Write a concise, single-line, lowercase imperative subject without a Conventional Commit prefix or trailing full stop:

```text
preserve animated webp when cropping images
fix transparent pixels in gif exports
update cropper usage examples
```

Keep the subject alone for self-explanatory changes. When a body is needed, follow the subject with exactly one blank line, explain the existing problem and why the change resolves it, and do not hard-wrap. Have commit messages reviewed before pushing commits to a remote.

Describe the problem, the resulting behaviour, and the checks that ran in the pull request. Call out breaking changes and any verification limits. For bug reports, include the package and browser versions, reproduction steps, expected behaviour, actual behaviour, and a minimal code sample.

## Releases

Preview a release from the repository root:

```sh
mise exec -- npm run release -- --dry-run
```

Run an interactive release with:

```sh
mise exec -- npm run release
```

The release command selects the package and version, builds and checks the packages, and asks before Git changes or npm publication. Review the proposed commit message before any remote push. Declining Git changes skips the commit, tag, and push steps.

To resume a partially completed release, select the current version or supply the same package and exact version:

```sh
mise exec -- npm run release -- --project super-image-cropper --version 1.0.27
```

The command recognises an existing matching tag and published version, so completed release steps are not repeated.

Releasing the GIF worker also updates the processor's dependency pin and the lockfile. The processor's package version stays unchanged until its own release.
