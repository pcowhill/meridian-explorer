import type { Entity, Relation, StateMachine } from '../../types';
import { CI_YML, DEPLOY, DEPLOY_DOC, RESET_YML, rel, src } from './helpers';

/**
 * Delivery & hosting: the CI workflow, the release pipeline scripts in
 * `scripts/deploy/`, and the hosting pieces that live OUTSIDE the Meridian
 * repository (kind `external`, described from Meridian's own contract docs).
 */

const REMOTE = `${DEPLOY}/remote/meridian-release.sh`;
const DEPLOY_SH = `${DEPLOY}/deploy-release.sh`;
const BUILD_SH = `${DEPLOY}/build-release.sh`;
const SMOKE_SH = `${DEPLOY}/smoke-release.sh`;
const VERIFY_MJS = `${DEPLOY}/verify-public.mjs`;
const ARCH = 'TECHNICAL_ARCHITECTURE.md';
const OUTSIDE =
  'This is NOT implemented in the Meridian repository. It belongs to the separate infrastructure repository `pcowhill/cowhill-infrastructure`; what is stated here is the contract Meridian’s own documentation and deployment scripts rely on.';

export const infraEntities: Entity[] = [
  // ---- GitHub Actions -------------------------------------------------------
  {
    id: 'infra:ci',
    kind: 'infra',
    name: 'CI workflow (ci.yml)',
    parent: 'infra',
    summary: 'The one GitHub Actions workflow that tests every change and, for commits on `main`, packages and deploys them.',
    description:
      'Triggers: push to `main`, every pull request, and manual “Run workflow” (`workflow_dispatch`). `pull_request_target` is never used. Permissions are `contents: read`.\n\nFour jobs: `verify` and `e2e` run in parallel for every event; `package-release` needs both to succeed; `deploy` needs all three and additionally requires the ref to be `refs/heads/main` and the event to be a push or a manual run.\n\nConcurrency: pull-request runs share one group per PR and a newer run cancels the older one. Every other run gets a group per commit SHA and is never cancelled — so a new push cannot kill a deployment that is in the middle of switching the server. Because deploy lives in the same workflow as the tests, it cannot run ahead of them.\n\nAll jobs use Node.js 22, the version the server runs.',
    audience: {
      executive: 'The automatic quality gate and delivery line: nothing reaches the public demo unless every test passed for that exact change.',
      systems: 'GitHub Actions, ubuntu-latest, Node 22. verify ∥ e2e → package-release → deploy (main only). Deploy is serialised in the `meridian-production` concurrency group.',
    },
    tech: ['GitHub Actions'],
    tags: ['ci', 'deployment', 'security'],
    aliases: ['pipeline', 'GitHub Actions', 'continuous integration', 'ci.yml'],
    sources: [
      src(CI_YML, 1, 28, 'package-release ──> deploy', 'Header: job graph and rules'),
      src(CI_YML, 30, 42, 'cancel-in-progress', 'Permissions, concurrency, Node version'),
      src(DEPLOY_DOC, 333, 355, 'Deployment is **automatic after a successful CI run on `main`**'),
    ],
  },
  {
    id: 'infra:ci#verify',
    kind: 'infra',
    name: 'Job: verify',
    parent: 'infra:ci',
    summary: 'Lint, type-check, run every unit and integration test (including the deployment-script tests) and build all workspaces.',
    description:
      'Steps: checkout (credentials not persisted) → Node 22 → `npm ci` (its postinstall generates the Prisma client) → `npm run db:reset` (migrate + seed a local SQLite database for the integration tests) → `npm run lint:deploy` (shellcheck over the deployment scripts) → `npm run verify` with `REQUIRE_DEPLOY_TESTS=1`.\n\n`npm run verify` is `lint && typecheck && test && build`. `REQUIRE_DEPLOY_TESTS=1` turns a missing POSIX tool (flock, rsync, ssh-keygen…) into an error instead of a skipped deployment test. Runs for every event; uses no secrets; 30-minute timeout.',
    detail: 4,
    tags: ['ci', 'tests'],
    sources: [
      src(CI_YML, 45, 75, 'Lint, typecheck, test, build'),
      src('package.json', 41, 41, '"verify": "npm run lint && npm run typecheck && npm run test && npm run build"'),
    ],
  },
  {
    id: 'infra:ci#e2e',
    kind: 'infra',
    name: 'Job: e2e (Playwright)',
    parent: 'infra:ci',
    summary: 'Starts the whole stack on the runner and drives both apps in a real Chromium browser.',
    description:
      'Steps: checkout → Node 22 → `npm ci` → `npm run db:reset` → `npx playwright install --with-deps chromium` → `npm run test:e2e`. Playwright’s own config starts the backend (`:3000`), the customer app (`:5173`) and the operations app (`:5174`) with their dev servers and waits for them. On failure the HTML report is uploaded as an artifact for 7 days. Runs for every event, in parallel with `verify`; no secrets.',
    detail: 4,
    tags: ['ci', 'tests'],
    sources: [
      src(CI_YML, 77, 109, 'Playwright smoke tests'),
      src('playwright.config.ts', 42, 66, 'npm run dev:backend', 'The stack Playwright starts'),
    ],
  },
  {
    id: 'infra:ci#package-release',
    kind: 'infra',
    name: 'Job: package-release',
    parent: 'infra:ci',
    summary: 'Builds the release directory for the exact commit, boots it as a smoke test, validates it and archives it.',
    description:
      'Runs for EVERY event once `verify` and `e2e` have both succeeded, so a pull request proves its release still packages and boots. Steps: confirm the checkout is `GITHUB_SHA` → `npm ci` → `build-release.sh --sha <sha> --out $RUNNER_TEMP/meridian/release` → `smoke-release.sh` → `validate-release.sh` again → `archive-release.sh` (tarball + SHA-256).\n\nThe job publishes three outputs — `sha`, `archive`, `archive_sha256` — and uploads the artifact only when the ref is `main` and the event is a push or manual run (3-day retention, `if-no-files-found: error`). No secrets are available to this job.',
    detail: 4,
    tags: ['ci', 'deployment'],
    sources: [
      src(CI_YML, 111, 123, 'needs: [verify, e2e]', 'Gate + outputs'),
      src(CI_YML, 134, 174, 'scripts/deploy/build-release.sh', 'Build → smoke → validate → archive'),
      src(CI_YML, 176, 184, 'Upload the release artifact (main only)'),
    ],
  },
  {
    id: 'infra:ci#deploy',
    kind: 'infra',
    name: 'Job: deploy',
    parent: 'infra:ci',
    summary: 'For `main` only: downloads the packaged release, checks its hash, and runs the deployment script over a pinned SSH connection.',
    description:
      'Condition: `github.ref == "refs/heads/main"` AND event is `push` or `workflow_dispatch` AND `verify`, `e2e` and `package-release` each have result `success` (a skipped or failed prerequisite never deploys).\n\nIt runs in the concurrency group `meridian-production` with `cancel-in-progress: false`, shared with the manual reset workflow — one production operation at a time, queued, never cancelled.\n\nSteps: sanity-check the target (40-hex SHA equal to `GITHUB_SHA`, expected archive name, 64-hex hash) → checkout the target commit → download the artifact → `extract-release.sh` with the hash from the package job’s OUTPUT, then `validate-release.sh` → `ssh-setup.sh` (the only step that receives `LIGHTSAIL_SSH_PRIVATE_KEY` and `LIGHTSAIL_KNOWN_HOSTS`, as environment variables) → `deploy-release.sh --sha … --release …` → `ssh-cleanup.sh` in an `always()` step.',
    detail: 4,
    tags: ['ci', 'deployment', 'security'],
    sources: [
      src(CI_YML, 186, 208, 'group: meridian-production', 'Gate, concurrency group, env'),
      src(CI_YML, 209, 239, 'scripts/deploy/extract-release.sh', 'Target check, download, checksum, validate'),
      src(CI_YML, 241, 257, 'scripts/deploy/deploy-release.sh', 'Secrets step, deploy, cleanup'),
    ],
  },
  {
    id: 'infra:reset-demo',
    kind: 'infra',
    name: 'Reset workflow (reset-demo.yml)',
    parent: 'infra',
    summary: 'A manual workflow that resets the public demo’s data to the current release’s pristine baseline without deploying any code.',
    description:
      'Trigger: `workflow_dispatch` only, no inputs, and the job runs only when the ref is `main`. It shares the `meridian-production` concurrency group with the deploy job, so a reset and a deployment never overlap.\n\nSteps: checkout → Node 22 → `ssh-setup.sh` (the only step with secrets) → SSH preflight (`id -un` must be `deploy-meridian`; `sudo -n /usr/local/sbin/cowhill-meridian-service status` must work) → `sudo -n /usr/local/sbin/cowhill-meridian-service reset` (15-minute timeout) → `node scripts/deploy/verify-public.mjs live` (no expected revision) → `ssh-cleanup.sh` always.\n\nThe only state-changing command is the infrastructure’s root-owned helper, which takes the server lock itself. The scheduled daily reset is not this workflow — it is a systemd timer owned by the infrastructure.',
    tech: ['GitHub Actions'],
    tags: ['deployment', 'data', 'public-demo'],
    aliases: ['reset demo data', 'manual reset'],
    sources: [
      src(RESET_YML, 1, 22, 'Reset the shared Meridian public demo'),
      src(RESET_YML, 24, 73, 'cowhill-meridian-service reset'),
      src(DEPLOY_DOC, 578, 590, 'On demand'),
    ],
  },

  // ---- The release and the scripts that make it -----------------------------
  {
    id: 'infra:release',
    kind: 'infra',
    name: 'Immutable release directory',
    parent: 'infra',
    summary: 'The self-contained folder that is deployed: both built apps, the bundled backend with its exact runtime dependencies, a pristine database and the commit id.',
    description:
      'One release exists per commit and is named by the full commit SHA (`/srv/apps/meridian/releases/<sha>/` on the server). It is built entirely on the GitHub runner; the server never runs npm, Vite, TypeScript or Prisma. Once the server has marked it ready it is never modified — a re-deploy of the same commit reuses it, and the backend runs it read-only.\n\n`REVISION` is the link between the running process and the commit: the backend reads `../REVISION` relative to its own bundle at start-up and reports it as `revision` on `GET /status`, which is what the public verification compares against the commit it just deployed.',
    fields: [
      { name: 'customer/', type: 'directory', description: 'The built customer SPA (`apps/customer/dist`): `index.html`, `assets/`, `robots.txt`… Served as static files.' },
      { name: 'operations/', type: 'directory', description: 'The built operations SPA (`apps/operations/dist`). Served as static files.' },
      { name: 'backend/', type: 'directory', description: '`index.js` + `index.js.map` only — the tsup bundle with `@simbank/shared` inlined.' },
      { name: 'node_modules/', type: 'directory', description: 'The backend’s production dependency closure plus the generated Prisma client and its query engine.' },
      { name: 'baseline/meridian-baseline.db', type: 'SQLite file', description: 'Migrated + seeded pristine database; the server copies it over the live database on every reset.' },
      { name: 'package.json', type: 'file', description: '`{"type":"module"}` so Node treats `backend/index.js` as ESM.' },
      { name: 'REVISION', type: 'file', description: 'The full commit SHA — exactly 40 bytes, no newline.' },
      { name: '.release-ready', type: 'marker file', description: 'NOT in the artifact. Created last by the server after its own validation; a release without it is never switched to.' },
    ],
    example: {
      path: '/srv/apps/meridian/releases/53bb9ab38559c7f1e4ed7b9532145d28bf62959c',
      REVISION: '53bb9ab38559c7f1e4ed7b9532145d28bf62959c',
    },
    tags: ['deployment', 'data'],
    aliases: ['release', 'release bundle', 'artifact', 'REVISION'],
    sources: [
      src(BUILD_SH, 14, 23, 'REVISION       the full commit SHA (exactly 40 bytes)', 'Release layout'),
      src(DEPLOY_DOC, 385, 407, 'meridian-baseline.db   migrated + seeded pristine SQLite database'),
      src('apps/backend/src/revision.ts', 21, 32, 'RELEASE_REVISION', 'How the backend reads REVISION'),
    ],
  },
  {
    id: 'infra:release-build',
    kind: 'infra',
    name: 'build-release.sh',
    parent: 'infra',
    summary: 'Builds the release directory for one commit: production builds, the baseline database, runtime dependencies and the REVISION file.',
    description:
      'Usage: `build-release.sh --sha <full-sha> --out <dir> [--allow-dirty]`.\n\nPreconditions (each fails the build): the SHA is 40 lowercase hex; Node is 22; `HEAD` equals the SHA; no uncommitted changes to tracked files (unless `--allow-dirty`); `npm ci` has run; `--out` is empty, OUTSIDE the repository, and no ancestor directory contains `node_modules` (so a later smoke test cannot silently resolve packages from the checkout).\n\nSteps: (1) refuse any `apps/*/.env*` file Vite would read, unset `VITE_API_URL`, `VITE_WS_URL` and `DATABASE_URL`, then `VITE_PUBLIC_DEMO=true npm run build`; check each SPA bundle contains “This is a shared public simulation” and each `index.html` still has its `noindex` robots tag. (2) `SEED_NOW=<committer timestamp> npm run db:baseline -- --out <out>/baseline/meridian-baseline.db`. (3) Copy `customer/`, `operations/`, `backend/*.js(.map)`; run `collect-runtime-deps.mjs`; write `package.json` and `REVISION` (`printf "%s"`, no newline); `chmod -R u=rwX,go=rX`. (4) `check-baseline.mjs`, then `validate-release.sh`.',
    tech: ['bash'],
    tags: ['deployment', 'public-demo'],
    aliases: ['package release', 'build the release'],
    sources: [
      src(BUILD_SH, 1, 29, 'Build the Meridian public-demo release directory'),
      src(BUILD_SH, 46, 67, 'refusing to build a release from it', 'Preconditions'),
      src(BUILD_SH, 69, 93, 'VITE_PUBLIC_DEMO=true npm run build', 'Frontend build + baseline'),
      src(BUILD_SH, 96, 129, "printf '%s' \"${sha}\" > \"${out}/REVISION\"", 'Assemble, REVISION, checks'),
    ],
  },
  {
    id: 'infra:runtime-deps',
    kind: 'infra',
    name: 'collect-runtime-deps.mjs',
    parent: 'infra',
    summary: 'Copies exactly the packages the bundled backend needs at runtime — and nothing else — into the release’s `node_modules`.',
    description:
      'Walks `@simbank/backend`’s `dependencies`, `optionalDependencies` and non-optional peers transitively through the node_modules tree `npm ci` installed (the tree every CI test ran against), resolving each package the way Node does, and copies that closure preserving the nested layout and file modes.\n\nRules that fail the build: a required dependency is missing; a copied package is marked `dev` in `package-lock.json`; a symlink, socket or device is encountered; the bundle imports an `@simbank/*` workspace package (tsup must have inlined it); any bare import of `backend/index.js` does not resolve inside the new tree. The generated Prisma client (`node_modules/.prisma/client`: JS client, `schema.prisma`, the `libquery_engine-*.so.node` engine) is copied whole. It exists because `npm prune --omit=dev` in a workspace monorepo would keep the frontends’ React dependencies, workspace symlinks and `.bin` links.',
    tech: ['Node.js'],
    detail: 4,
    tags: ['deployment'],
    sources: [
      src(`${DEPLOY}/collect-runtime-deps.mjs`, 1, 38, 'production runtime dependencies for the backend'),
      src(`${DEPLOY}/collect-runtime-deps.mjs`, 229, 256, 'it must be bundled', 'Bundle import check'),
    ],
  },
  {
    id: 'infra:baseline-check',
    kind: 'infra',
    name: 'check-baseline.mjs',
    parent: 'infra',
    summary: 'Opens a copy of the release’s baseline database through the release’s own Prisma client and checks the seeded content.',
    description:
      'Resolves `@prisma/client` exactly as `release/backend/index.js` would and fails if it resolves outside the release — so the check also proves the packaged client and query engine can open the packaged database. The baseline itself is never opened: it is copied to a temp file first so the shipped bytes stay untouched.\n\nRequires: the SQLite header; the four showcase users present, `active`, with their expected roles; at least one account and one ledger entry; ZERO sessions; the `SimulationClock` singleton at exactly `SEED_NOW`; at least one applied migration and none unfinished or rolled back.',
    tech: ['Node.js', 'Prisma'],
    detail: 4,
    tags: ['deployment', 'data'],
    sources: [
      src(`${DEPLOY}/check-baseline.mjs`, 1, 9, "THROUGH THE RELEASE'S OWN"),
      src(`${DEPLOY}/check-baseline.mjs`, 61, 106, 'a pristine baseline must hold no sessions', 'Content checks'),
    ],
  },
  {
    id: 'infra:release-validate',
    kind: 'infra',
    name: 'Release validation',
    parent: 'infra',
    summary: 'The structural checks a release must pass — run on the runner and again on the server by the very same shell function.',
    description:
      '`validate-release.sh <dir> <sha>` simply runs `remote/meridian-release.sh validate`, so the runner and the server apply identical rules. It is run after building, after the smoke test, after downloading the artifact, and by the server on the upload and again after publishing.\n\n`validate_release` requires: only the seven expected top-level entries; `REVISION` exactly the 40-character SHA; `package.json` with `"type": "module"`; `customer/index.html`, `operations/index.html`, `backend/index.js` (and only `*.js` / `*.js.map` in `backend/`); `node_modules` containing fastify, socket.io, bcryptjs, `@prisma/client`, `.prisma/client`, the query engine and `schema.prisma`, and NOT containing `.bin`, Playwright or `@simbank`; the baseline as the only file in `baseline/`, non-empty, starting with “SQLite format 3”; no symlinks or special files anywhere; nothing group/world-writable or setuid/setgid; no dotfiles under the static roots; no `.env*`, `.npmrc`, SSH keys, `*.pem`, `*.key`, other databases, or `PRIVATE KEY` blocks anywhere.',
    tech: ['bash'],
    detail: 4,
    tags: ['deployment', 'security', 'validation'],
    sources: [
      src(`${DEPLOY}/validate-release.sh`, 1, 18, 'validate "${release_dir}" "${sha}"'),
      src(REMOTE, 111, 150, 'validate_release()', 'Structure, REVISION, backend, node_modules'),
      src(REMOTE, 151, 185, 'secret-like or database file in the release', 'Baseline, file types, modes, secrets'),
    ],
  },
  {
    id: 'infra:release-smoke',
    kind: 'infra',
    name: 'smoke-release.sh',
    parent: 'infra',
    summary: 'Boots the packaged backend from the release directory, exactly as production would, and checks it answers before anything is shipped.',
    description:
      'Copies the packaged baseline to a temporary database, picks a free port, and starts `node backend/index.js` from inside the release under `env -i` with only: `NODE_ENV=production`, `PUBLIC_DEMO=true`, `HOST=127.0.0.1`, `PORT`, `DATABASE_URL=file:<temp>`, `CORS_ORIGINS` (the two public origins), `OPERATIONS_ORIGINS`, `LOG_LEVEL=info`. Nothing from the runner’s environment can leak in, and the script refuses to run if an ancestor directory has a `node_modules`.\n\nIt then runs `verify-public.mjs backend --url http://127.0.0.1:<port> --expect-revision <sha>` (30 attempts, 1 s apart): `/health` 200, `/status` with `status: "ok"`, `database.connected: true`, `publicDemo: true`, `revision` equal to the SHA, and an anonymous Engine.IO polling handshake. It also requires the server log to show the public-demo posture and the temporary `DATABASE_URL`, a clean exit code 0 within 20 s of SIGTERM with the shutdown handler logged, and that no file in the release directory was modified while the backend ran.',
    tech: ['bash'],
    tags: ['deployment', 'tests'],
    aliases: ['smoke test'],
    sources: [
      src(SMOKE_SH, 1, 13, 'Smoke-test the EXACT packaged release'),
      src(SMOKE_SH, 43, 71, 'exec env -i', 'Boot under a minimal environment + probe'),
      src(SMOKE_SH, 73, 97, 'the running backend modified its release directory', 'Posture, SIGTERM, read-only checks'),
    ],
  },
  {
    id: 'infra:release-archive',
    kind: 'infra',
    name: 'archive-release.sh / extract-release.sh',
    parent: 'infra',
    summary: 'Packs the release into a reproducible tarball with a SHA-256, and on the other side refuses to unpack anything whose hash or contents look wrong.',
    description:
      '`archive-release.sh` refuses a release that already has `.release-ready`, then writes `meridian-release-<sha>.tar.gz` with sorted entries, owner 0:0, the commit time as every mtime and `gzip -n` (so the same input gives the same bytes), plus a `.sha256` file.\n\n`extract-release.sh <archive> <expected-sha256> <dest>` takes the expected hash from the package job’s OUTPUT — a channel separate from the artifact store — and refuses the archive if the hash differs, if any entry is not a regular file or directory, or if any path is absolute or contains `..`. It extracts into a directory that must not already exist.',
    tech: ['bash', 'tar'],
    detail: 4,
    tags: ['deployment', 'security'],
    sources: [
      src(`${DEPLOY}/archive-release.sh`, 1, 30, 'reproducible tarball'),
      src(`${DEPLOY}/extract-release.sh`, 1, 41, 'does not match the package job'),
    ],
  },
  {
    id: 'infra:ssh-setup',
    kind: 'infra',
    name: 'ssh-setup.sh / ssh-cleanup.sh',
    parent: 'infra',
    summary: 'Writes the deployment key and a locked-down SSH configuration on the runner, and removes them afterwards.',
    description:
      'Inputs arrive only as environment variables: `LIGHTSAIL_HOST`, `LIGHTSAIL_USER` (must be `deploy-meridian`), `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`. It reports every missing setting by name, rejects a host value that is not a plain hostname or address, writes the key (0600) and known-hosts file, checks the key is a usable passphrase-less key and logs only its public fingerprint, and requires the known-hosts data to contain an entry for the host.\n\nThe generated config defines one host alias, `meridian`: `StrictHostKeyChecking yes` against that known-hosts file only, `IdentitiesOnly yes`, `IdentityAgent none`, `BatchMode yes`, no password or keyboard-interactive auth, no agent/X11 forwarding. There is no trust-on-first-use and no `ssh-keyscan`. `ssh-cleanup.sh` shreds the key and deletes the directory in an `always()` step.',
    tech: ['bash', 'OpenSSH'],
    detail: 4,
    tags: ['deployment', 'security'],
    sources: [
      src(`${DEPLOY}/ssh-setup.sh`, 1, 33, 'Prepare the pinned SSH client configuration'),
      src(`${DEPLOY}/ssh-setup.sh`, 64, 91, 'StrictHostKeyChecking yes'),
      src(`${DEPLOY}/ssh-cleanup.sh`, 1, 14, 'shred -u'),
    ],
  },
  {
    id: 'infra:release-deploy',
    kind: 'infra',
    name: 'deploy-release.sh',
    parent: 'infra',
    summary: 'Runs on the GitHub runner and drives the whole deployment over SSH: upload, publish, switch, reset, verify — and roll back if anything after the switch fails.',
    description:
      'Usage: `MERIDIAN_SSH_CONFIG=<dir>/config deploy-release.sh --sha <sha> --release <dir>`.\n\nPhase A — nothing on the server changes; a failure just fails the run:\n1. Re-validate the release; stale check (`git ls-remote origin refs/heads/main` must equal the target SHA — otherwise report a STALE RUN and exit 0; if `main` cannot be read, fail closed).\n2. SSH preflight: `id -un` must be `deploy-meridian`; the remote `preflight` action (free space required = 2 × the release size).\n3. `verify-public.mjs preflight` — DNS + trusted TLS for both hostnames.\n4. `rsync` the release into `incoming/<sha>/` (no symlinks, devices or specials; `--delete`).\n5. Remote `publish <sha>`.\n6. Remote `rollback-target <sha>` → `current=` and `previous=`.\n7. Stale check again.\n\nPhase B — 8. Remote `switch <sha> <current-before>` under the shared lock. If the command fails, the script asks the server for its `state` to decide whether the switch actually happened before treating it as a pre- or post-switch failure.\n\nPhase C — any failure triggers `rollback`:\n9. Remote `reset` (the helper takes the lock itself, so it is never called while the lock is held).\n10. Remote `verify <sha>`.\n11. `verify-public.mjs live --expect-revision <sha>`.\n12. Remote `prune <sha> <previous>` — a pruning failure is only a warning.\n\nRollback: switch back to the previous release, `reset`, remote `verify`, public `live --expect-revision <previous> --attempts 12`; the run still FAILS so the bad release is visible. If the rollback itself fails the service is stopped and the run fails with a CRITICAL message. With no previous release (first deployment) there is nothing to roll back to and the run fails.',
    audience: {
      executive: 'The deployment procedure: put the new version in place, start it on fresh demo data, check it publicly, and automatically return to the previous version if it does not check out.',
      systems: 'rsync + `bash -s` over a pinned SSH host; atomic symlink switch under flock; reset via a restricted sudo helper; HTTP verification through the public hostnames; automatic rollback.',
    },
    tech: ['bash', 'OpenSSH', 'rsync'],
    detail: 3,
    tags: ['deployment', 'security'],
    aliases: ['deploy script', 'rollback', 'stale run'],
    sources: [
      src(DEPLOY_SH, 1, 33, 'Deploy a validated Meridian release to the Lightsail server'),
      src(DEPLOY_SH, 98, 115, 'STALE RUN', 'Stale check'),
      src(DEPLOY_SH, 120, 166, 'remote 900 publish', 'Phase A'),
      src(DEPLOY_SH, 168, 185, 'remote 420 switch', 'Phase B'),
      src(DEPLOY_SH, 187, 237, 'rollback()', 'Phase C + rollback'),
    ],
  },
  {
    id: 'infra:remote-release',
    kind: 'infra',
    name: 'remote/meridian-release.sh',
    parent: 'infra',
    summary: 'The only Meridian code that runs on the server: a self-contained script streamed over SSH that validates, publishes, switches, verifies and prunes releases.',
    description:
      'It is never installed on the server. The deploy script pipes this file from the commit being deployed into `ssh meridian "bash -s -- <action> [args]"`, and it runs as `deploy-meridian`. Arguments are only ever a full commit SHA, the word `none` or a number; nothing from the release is executed, sourced or parsed as configuration. All paths are fixed contract values under `/srv/apps/meridian`, with the lock at `/run/lock/cowhill-meridian.lock`.\n\nThe switch is the critical section. `do_switch` opens the lock file read-only, waits up to 300 s for `flock`, re-checks that the target release is ready, then compares `current` against the value the deploy script saw earlier: if it changed, it exits 3 and changes nothing (compare-and-swap). Otherwise it creates a uniquely named temporary symlink and renames it over `current` with `mv -T` — an atomic replace — and releases the lock before returning, so the reset helper can take it.\n\nExit codes: 0 ok, 1 failure, 64 usage, 3 for a lost compare-and-swap. Test hooks (`MERIDIAN_TEST_ROOT`, `MERIDIAN_TEST_HELPER`) are refused when running as the real deploy account.',
    values: [
      { value: 'preflight [required-kib]', meaning: 'Identity, directories, lock file, x86_64 + OpenSSL 3 (for the packaged Prisma engine), helper `status`, free space.' },
      { value: 'validate <dir> <sha>', meaning: 'Structural release checks (also used on the runner).' },
      { value: 'publish <sha>', meaning: 'Validate `incoming/<sha>`, `mv -T` to `releases/<sha>`, normalise modes, validate again, sync, create `.release-ready` LAST. A ready release is reused unchanged.' },
      { value: 'rollback-target <sha>', meaning: 'Print `current=<sha|none>` and `previous=<sha|none>` — the current release if it is a different, ready release whose REVISION matches its name.' },
      { value: 'switch <sha> <expected>', meaning: 'Under the shared lock: compare-and-swap `current` to `releases/<sha>`.' },
      { value: 'reset', meaning: '`sudo -n /usr/local/sbin/cowhill-meridian-service reset`. Never called while holding the lock.' },
      { value: 'stop', meaning: '`sudo -n … stop` — used only when a rollback has also failed.' },
      { value: 'verify <sha>', meaning: '`current` resolves to `releases/<sha>`, `REVISION` matches, ready marker present, helper `status` reports `ActiveState=active`.' },
      { value: 'state', meaning: 'Print the current release or `none`.' },
      { value: 'prune <sha> <previous|none>', meaning: 'Keep `current` + one previous ready release; remove older releases, every `incoming/<sha>` and stale temp links. Never touches `data/`.' },
    ],
    tech: ['bash', 'flock'],
    detail: 3,
    tags: ['deployment', 'security'],
    aliases: ['server-side script', 'switch current', 'compare-and-swap'],
    sources: [
      src(REMOTE, 1, 35, 'the ONLY code the Meridian deployment runs on the server'),
      src(REMOTE, 39, 84, 'HELPER_PATH=/usr/local/sbin/cowhill-meridian-service', 'Contract paths + action dispatch'),
      src(REMOTE, 245, 277, 'do_publish()', 'Publish'),
      src(REMOTE, 305, 348, 'do_switch()', 'Locked compare-and-swap switch'),
      src(REMOTE, 356, 370, 'do_verify()', 'Server-side verification'),
      src(REMOTE, 372, 430, 'do_prune()', 'Pruning'),
    ],
  },
  {
    id: 'infra:verify-public',
    kind: 'infra',
    name: 'verify-public.mjs',
    parent: 'infra',
    summary: 'Read-only HTTP checks that prove the right revision is being served correctly on both public sites.',
    description:
      'A dependency-free Node script with three modes; TLS verification is never disabled and it sends no credentials.\n\nDefaults: customer `https://banking.cowhill.dev`, operations `https://banking-ops.cowhill.dev`, 36 attempts 5 s apart for the first `/status` poll.\n\n`live` — on the customer host poll `/status` until HTTP 200 with `status: "ok"`, `database.connected: true`, `publicDemo: true`, `isSimulation: true`, an `X-Robots-Tag` containing `noindex`, and (when given) `revision` equal to the expected SHA; repeat on the operations host (same backend). Then for each site: `/health` is 200 and ok; the SPA routes (`/` and `/dashboard` for customer, `/` and `/queues` for operations) return the HTML shell with the robots meta tag and `X-Robots-Tag: noindex, nofollow`; the JS bundle referenced by `/` is served with that header and contains “This is a shared public simulation”; `robots.txt` disallows crawling; and `GET /socket.io/?EIO=4&transport=polling` returns an Engine.IO open packet with a `sid`.',
    values: [
      { value: 'preflight', meaning: 'Before anything changes: both hostnames resolve and complete a verified TLS handshake over https. Any HTTP status is accepted.' },
      { value: 'live [--expect-revision <sha>]', meaning: 'After deployment or reset: the full public check of both sites.' },
      { value: 'backend --url <url> [--expect-revision <sha>]', meaning: 'Backend-only checks (`/health`, `/status`, Engine.IO handshake) used by the smoke test.' },
    ],
    tech: ['Node.js'],
    detail: 3,
    tags: ['deployment', 'tests', 'public-demo'],
    aliases: ['public verification', 'post-deploy check'],
    sources: [
      src(VERIFY_MJS, 1, 31, 'HTTP verification (no secrets, read-only requests)'),
      src(VERIFY_MJS, 119, 144, 'async function checkStatus', 'The /status contract'),
      src(VERIFY_MJS, 152, 201, 'async function checkSocketIo', 'Socket.IO, SPA shell, bundle notice, robots.txt'),
      src(VERIFY_MJS, 280, 318, 'async function live', 'Live mode sequence'),
    ],
  },
  {
    id: 'infra:release-dry-run',
    kind: 'infra',
    name: 'dry-run.sh',
    parent: 'infra',
    summary: 'Runs the packaging half of the pipeline locally — build, smoke test, archive, extract, validate — without contacting any server.',
    description: '`npm run release:dry-run`. Same steps as the `package-release` job for `HEAD`, into a temp directory kept for inspection; uncommitted changes are allowed here (`--allow-dirty`), never in CI.',
    tech: ['bash'],
    detail: 5,
    tags: ['deployment'],
    sources: [src(`${DEPLOY}/dry-run.sh`, 1, 24, 'never contacts a server'), src('package.json', 40, 40, 'release:dry-run')],
  },
  {
    id: 'infra:env',
    kind: 'infra',
    name: 'Environment configuration',
    parent: 'infra',
    summary: 'The handful of environment variables that decide how the backend and the two frontends behave in development versus the public demo.',
    description:
      'There are no secrets: the demo passwords are public by design, session tokens are random and generated at runtime, and nothing calls an external service. `.env.example` documents the variables; most local development needs no `.env` at all. The backend parses them once at start-up in `apps/backend/src/config.ts` (`resolveConfig`); only `true` / `1` / `yes` / `on` count as enabled.\n\nTwo independent posture flags: `NODE_ENV=production` (Secure cookies; production frontend builds call their own origin) and `PUBLIC_DEMO=true` (shared-demo warning, no visitor IP or user-agent persisted, seeded accounts exempt from lockout, rate limits, `X-Robots-Tag`). The public demo sets both; in production the values come from the infrastructure’s environment file, not from this repository.',
    fields: [
      { name: 'NODE_ENV', type: 'development | test | production', description: '`production` → cookies carry `Secure`.', values: ['development', 'test', 'production'] },
      { name: 'PUBLIC_DEMO', type: 'boolean flag', description: 'Explicit shared-public-demo posture; never inferred from NODE_ENV.' },
      { name: 'COOKIE_SECURE', type: 'boolean flag (optional)', description: 'Force the cookie `Secure` attribute on or off regardless of NODE_ENV.' },
      { name: 'RATE_LIMITS', type: 'boolean flag (optional)', description: 'Turn the abuse limits on outside public-demo mode.' },
      { name: 'PORT / HOST', type: 'number / string', description: 'Default 3000 on 127.0.0.1. The public demo binds loopback on 8102, set by the infrastructure.' },
      { name: 'CORS_ORIGINS', type: 'comma-separated origins', description: 'Local: the two localhost dev origins. Public: `https://banking.cowhill.dev,https://banking-ops.cowhill.dev`.' },
      { name: 'OPERATIONS_ORIGINS', type: 'comma-separated origins', description: 'Fallback signal for choosing the operations session cookie when no surface header is present.' },
      { name: 'DATABASE_URL', type: 'file: URL', description: 'Default `file:./dev.db` (relative to `apps/backend/prisma`). A deployment uses an absolute path outside the release, e.g. `file:/srv/apps/meridian/data/meridian.db`.' },
      { name: 'SEED_NOW', type: 'ISO-8601 instant (optional)', description: 'Pins the seed instant so a baseline build has deterministic content.' },
      { name: 'VITE_API_URL / VITE_WS_URL', type: 'URL (build time, optional)', description: 'Leave unset: dev → `http://localhost:3000`; production build → the page’s own origin.' },
      { name: 'VITE_PUBLIC_DEMO', type: 'boolean flag (build time)', description: 'Show the shared-demo warning from the first paint.' },
    ],
    example: {
      NODE_ENV: 'production',
      PUBLIC_DEMO: 'true',
      HOST: '127.0.0.1',
      PORT: '8102',
      DATABASE_URL: 'file:/srv/apps/meridian/data/meridian.db',
      CORS_ORIGINS: 'https://banking.cowhill.dev,https://banking-ops.cowhill.dev',
      OPERATIONS_ORIGINS: 'https://banking-ops.cowhill.dev',
    },
    tags: ['config', 'deployment', 'public-demo', 'security'],
    aliases: ['.env', 'environment variables', 'configuration', 'PUBLIC_DEMO'],
    sources: [
      src('.env.example', 16, 32, 'PUBLIC_DEMO=false', 'Posture flags'),
      src('.env.example', 34, 61, 'DATABASE_URL="file:./dev.db"', 'Network + database'),
      src('.env.example', 63, 76, 'VITE_PUBLIC_DEMO=false', 'Frontend build-time variables'),
      src(DEPLOY_DOC, 308, 331, 'There are **no secrets**', 'Production values'),
    ],
  },

  // ---- Outside this repository ---------------------------------------------
  {
    id: 'infra:cowhill-infrastructure',
    kind: 'external',
    name: 'Infrastructure repository (cowhill-infrastructure)',
    parent: 'infra',
    summary: 'A separate repository that owns the server itself: the web server configuration, the service definitions, the reset helper and timer, the accounts and DNS.',
    description: `${OUTSIDE}\n\nMeridian treats it as “infrastructure contract version 1” (\`docs/meridian.md\`, registry \`server/apps/meridian/app.conf\` in that repository): Node.js 22; the \`deploy-meridian\` and \`app-meridian\` accounts; \`/srv/apps/meridian\`; Caddy for both hostnames; \`meridian.service\`; the root-owned helper \`/usr/local/sbin/cowhill-meridian-service\`; the shared lock; the daily reset timer. The Meridian repository contains no Caddyfile, no unit files, no cloud configuration and no Docker, and an ordinary application deployment never needs an infrastructure change.`,
    audience: {
      executive: 'The hosting side is managed separately from the application; the two meet at a written contract.',
    },
    tags: ['deployment', 'boundary'],
    aliases: ['pcowhill/cowhill-infrastructure', 'infrastructure contract'],
    sources: [
      src(DEPLOY_DOC, 3, 18, 'pcowhill/cowhill-infrastructure', 'The two-sided contract'),
      src(ARCH, 131, 138, 'deliberately outside this repository'),
      src(`${DEPLOY}/lib/common.sh`, 7, 13, 'contract version 1'),
    ],
  },
  {
    id: 'infra:host',
    kind: 'external',
    name: 'Lightsail VM',
    parent: 'infra',
    summary: 'The single Linux server that hosts the public demo: it holds the releases, the live database file and runs the backend.',
    description: `${OUTSIDE}\n\nAn AWS Lightsail instance reached by GitHub Actions at the static address in the repository variable \`LIGHTSAIL_HOST\`, as the unprivileged account \`deploy-meridian\`. Layout under \`/srv/apps/meridian\`: \`incoming/<sha>/\` (upload staging), \`releases/<sha>/\` (immutable releases), \`current\` (symlink to the active release) and \`data/meridian.db\` (the live SQLite database, outside every release). The server must be linux-x86_64 with OpenSSL 3, because the release ships a Prisma query engine built for that platform; it never runs npm, a build, or Prisma.`,
    fields: [
      { name: '/srv/apps/meridian/incoming/<sha>/', type: 'directory', description: 'Where rsync uploads a release.' },
      { name: '/srv/apps/meridian/releases/<sha>/', type: 'directory', description: 'Published, immutable releases (at most the current and one previous are kept).' },
      { name: '/srv/apps/meridian/current', type: 'symlink', description: 'Points at the active release; switched atomically.' },
      { name: '/srv/apps/meridian/data/meridian.db', type: 'SQLite file', description: 'The live database; replaced whole on every reset.' },
      { name: '/run/lock/cowhill-meridian.lock', type: 'lock file', description: 'Shared `flock` between the deploy switch and the reset helper.' },
    ],
    tech: ['AWS Lightsail', 'Linux x86_64', 'Node.js 22'],
    tags: ['deployment', 'hosting'],
    aliases: ['server', 'VM', 'Lightsail', 'production host'],
    sources: [
      src(DEPLOY_DOC, 476, 491, '/srv/apps/meridian/incoming/<sha>/', 'Contract paths'),
      src(DEPLOY_DOC, 372, 380, 'the Lightsail static IPv4 address'),
      src(REMOTE, 61, 66, 'APP_ROOT="${test_root}/srv/apps/meridian"'),
      src(REMOTE, 225, 231, 'OpenSSL 3', 'Platform requirement'),
    ],
  },
  {
    id: 'infra:reverse-proxy',
    kind: 'external',
    name: 'Reverse proxy (Caddy)',
    parent: 'infra',
    summary: 'The web server in front of everything: for each public hostname it serves that app’s static files and forwards API and socket traffic to the backend on the same host.',
    description: `${OUTSIDE}\n\nTwo sites, no separate API hostname:\n• \`https://banking.cowhill.dev\` → static files from \`current/customer\`\n• \`https://banking-ops.cowhill.dev\` → static files from \`current/operations\`\n\nOn BOTH hostnames these path prefixes are forwarded to the private backend (loopback, port 8102): \`/api/*\`, \`/health\`, \`/status\`, \`/socket.io/*\` (which needs WebSocket upgrade support). Everything else is a static file, falling back to that site’s \`index.html\` — required because both apps use client-side routing, so \`/queues\` or \`/dashboard\` is not a file.\n\nThis is what “same-origin” means for the apps: a production build calls its own origin, so the browser never makes a cross-origin request and the session cookies are host-scoped. Other stated duties: add \`X-Robots-Tag: noindex, nofollow\` to every static response, and OVERWRITE (not append to) any incoming \`X-Forwarded-For\`, since the backend trusts the proxy for the client address its rate limiter uses. Before the first deployment it answers 404 for pages and 502 for backend paths.`,
    audience: {
      executive: 'The front door of the public demo: one address per app, each also carrying its own traffic to the shared server.',
      systems: 'Caddy, TLS for both hostnames; static roots = `current/customer` and `current/operations`; `/api/*`, `/health`, `/status`, `/socket.io/*` → 127.0.0.1:8102; SPA fallback to `/index.html`.',
    },
    tech: ['Caddy'],
    tags: ['deployment', 'hosting', 'security', 'public-demo'],
    aliases: ['Caddy', 'same-origin reverse proxy', 'proxy', 'banking.cowhill.dev', 'banking-ops.cowhill.dev'],
    sources: [
      src(DEPLOY_DOC, 55, 80, '/socket.io/*  → backend', 'Hostnames, forwarded paths, loopback backend, X-Forwarded-For'),
      src(DEPLOY_DOC, 292, 306, 'Caddy adds the same header to every static response', 'X-Robots-Tag + SPA fallback'),
      src(DEPLOY_DOC, 486, 486, 'Static roots (Caddy)'),
      src(ARCH, 108, 114, 'reverse-proxies'),
    ],
  },
  {
    id: 'infra:backend-service',
    kind: 'external',
    name: 'meridian.service (systemd)',
    parent: 'infra',
    summary: 'The service definition that keeps the backend process running on the server from whichever release is current.',
    description: `${OUTSIDE}\n\nRuns \`/usr/bin/node /srv/apps/meridian/current/backend/index.js\` as the account \`app-meridian\`, with the environment from the infrastructure’s environment file (\`NODE_ENV=production\`, \`PUBLIC_DEMO=true\`, \`HOST=127.0.0.1\`, \`PORT=8102\`, \`DATABASE_URL=file:/srv/apps/meridian/data/meridian.db\`, the CORS and operations origins). The release directory is read-only to it. The deploy account cannot control it directly — only through the helper’s \`restart | stop | status | reset\` — and cannot read its journal.`,
    tech: ['systemd'],
    tags: ['deployment', 'hosting'],
    aliases: ['systemd unit', 'meridian.service'],
    sources: [
      src(DEPLOY_DOC, 487, 490, 'meridian.service'),
      src(DEPLOY_DOC, 308, 321, 'PORT=8102', 'Production environment'),
      src(DEPLOY_DOC, 594, 599, 'the deploy account has no journal access'),
    ],
  },
  {
    id: 'infra:reset-helper',
    kind: 'external',
    name: 'Reset helper (cowhill-meridian-service)',
    parent: 'infra',
    summary: 'A root-owned command on the server that replaces the live database with the current release’s pristine baseline and restarts the backend.',
    description: `${OUTSIDE}\n\n\`sudo -n /usr/local/sbin/cowhill-meridian-service restart|stop|status|reset\` is the only privileged thing the deployment account may run (a restricted sudoers entry). \`reset\` takes the shared lock \`/run/lock/cowhill-meridian.lock\` itself, then: stop the backend → verify the baseline → replace the WHOLE live database file with \`current/baseline/meridian-baseline.db\` → drop SQLite side files → start the backend → check its local \`/health\` and \`/status\`. A non-zero exit means the backend did not become healthy.\n\nBecause the helper takes a non-reentrant lock, Meridian’s scripts never call it while holding that lock: the switch releases the lock first. Visitor data is disposable — a reset never preserves or restores it. Three things invoke it: every deployment, the manual reset workflow, and the daily timer.`,
    audience: {
      executive: 'The “wipe and start fresh” button for the public demo.',
      dba: 'Reset = stop the process, overwrite the SQLite file with the release’s baseline copy, remove -journal/-wal/-shm side files, start the process. No migration runs on the server.',
    },
    tech: ['sudo', 'flock'],
    tags: ['deployment', 'data', 'public-demo'],
    aliases: ['reset', 'service helper', 'cowhill-meridian-service'],
    sources: [
      src(DEPLOY_DOC, 536, 540, 'replace the whole live DB', 'What reset does'),
      src(DEPLOY_DOC, 490, 491, '/usr/local/sbin/cowhill-meridian-service'),
      src(REMOTE, 102, 105, 'run_helper()', 'How Meridian invokes it'),
      src(RESET_YML, 4, 12, 'takes the shared server lock itself'),
    ],
  },
  {
    id: 'infra:reset-timer',
    kind: 'external',
    name: 'Daily reset timer',
    parent: 'infra',
    summary: 'A scheduled job on the server that resets the demo data every day at 04:00 New York time.',
    description: `${OUTSIDE}\n\n\`meridian-reset.timer\` → \`meridian-reset.service\` → \`cowhill-meridian-service reset\`, at 04:00 America/New_York. It is the reason the shared-demo notice says “Demo data is periodically reset”, and one reason the in-memory rate limiter is acceptable — the process restarts daily.`,
    tech: ['systemd timer'],
    tags: ['deployment', 'data', 'public-demo', 'time'],
    aliases: ['meridian-reset.timer', 'nightly reset'],
    sources: [
      src(DEPLOY_DOC, 578, 583, 'meridian-reset.timer'),
      src(RESET_YML, 11, 12, 'meridian-reset.timer'),
    ],
  },

  // ---- Tests ----------------------------------------------------------------
  {
    id: 'test:scripts/deploy/test',
    kind: 'test',
    name: 'Deployment pipeline tests',
    parent: 'tests',
    summary: 'Vitest suites that run the real deployment scripts against temporary directories with a fake ssh, a fake service helper and a fake public verifier.',
    description:
      'Seven files, part of `npm run test` (and so of `verify`). Nothing contacts a real server.\n\n• `release-validation.test.ts` — one rejection test per validation rule (missing app, wrong REVISION, symlink, `.env`, private key, stray database, writable modes…).\n• `remote-server.test.ts` — the server-side script against a temp tree: preflight, publish and reruns, the rollback target, the locked compare-and-swap switch (including waiting for and releasing the lock, and never calling the helper while holding it), verify, prune.\n• `deploy-flow.test.ts` — the whole `deploy-release.sh`: first deployment, upgrade, stale runs at both checkpoints, fail-closed when `main` is unreadable, failures before the switch, rollback after a failed reset and after a failed public verification, a failed rollback stopping the service, reruns.\n• `archive.test.ts` — byte-identical round trip, checksum mismatch, corruption, symlinks and path traversal refused.\n• `ssh-setup.test.ts` — strict config, no secrets printed, missing or malformed settings.\n• `verify-public.test.ts` — the HTTP verifier against local fake sites.\n• `workflows.test.ts` — parses both workflow files and asserts the gating (never deploys for pull requests, other refs, other events or a failed prerequisite), the `meridian-production` group, secrets confined to one step, `contents: read`, and that nothing is built on the server.',
    tech: ['Vitest'],
    tags: ['tests', 'deployment', 'security'],
    sources: [
      src(`${DEPLOY}/vitest.config.ts`, 3, 14, 'Deployment-pipeline tests'),
      src(`${DEPLOY}/test/deploy-flow.test.ts`, 142, 168, 'rolls back to the previous release', 'Rollback paths'),
      src(`${DEPLOY}/test/remote-server.test.ts`, 202, 285, 'compare-and-swap', 'Switch under the lock'),
      src(`${DEPLOY}/test/workflows.test.ts`, 92, 163, 'never deploys for pull requests', 'Workflow gating'),
      src(`${DEPLOY}/test/fixtures/fake-helper.sh`, 1, 8, 'stands in for'),
    ],
  },
];

export const infraRelations: Relation[] = [
  // ---- Workflow → scripts ---------------------------------------------------
  rel('infra:ci#package-release', 'infra:release-build', 'calls', {
    label: 'build-release.sh --sha <sha> --out $RUNNER_TEMP/meridian/release',
    sources: [src(CI_YML, 148, 151, 'scripts/deploy/build-release.sh')],
    order: 1,
  }),
  rel('infra:ci#package-release', 'infra:release-smoke', 'calls', {
    label: 'smoke-release.sh <release> <sha>',
    sources: [src(CI_YML, 155, 158, 'scripts/deploy/smoke-release.sh')],
    order: 2,
  }),
  rel('infra:ci#package-release', 'infra:release-validate', 'calls', {
    label: 'validate-release.sh (after the smoke test)',
    sources: [src(CI_YML, 160, 163, 'scripts/deploy/validate-release.sh')],
    order: 3,
  }),
  rel('infra:ci#package-release', 'infra:release-archive', 'calls', {
    label: 'archive-release.sh → tar.gz + sha256',
    sources: [src(CI_YML, 165, 174, 'scripts/deploy/archive-release.sh')],
    order: 4,
  }),
  rel('infra:ci#deploy', 'infra:release-archive', 'calls', {
    label: 'extract-release.sh <archive> <sha256 from job output> <dest>',
    sources: [src(CI_YML, 234, 239, 'scripts/deploy/extract-release.sh')],
    order: 1,
  }),
  rel('infra:ci#deploy', 'infra:ssh-setup', 'calls', {
    label: 'ssh-setup.sh (the only step with secrets)',
    sources: [src(CI_YML, 241, 247, 'scripts/deploy/ssh-setup.sh')],
    order: 2,
    tags: ['security'],
  }),
  rel('infra:ci#deploy', 'infra:release-deploy', 'calls', {
    label: 'deploy-release.sh --sha <sha> --release <dir>',
    sources: [src(CI_YML, 249, 253, 'scripts/deploy/deploy-release.sh')],
    order: 3,
  }),
  rel('infra:reset-demo', 'infra:ssh-setup', 'calls', {
    label: 'ssh-setup.sh',
    sources: [src(RESET_YML, 46, 51, 'scripts/deploy/ssh-setup.sh')],
    order: 1,
  }),
  rel('infra:reset-demo', 'infra:reset-helper', 'triggers', {
    label: 'sudo -n /usr/local/sbin/cowhill-meridian-service reset',
    summary: 'The manual reset runs only the infrastructure helper over SSH.',
    sources: [src(RESET_YML, 62, 66, 'cowhill-meridian-service reset')],
    order: 2,
  }),
  rel('infra:reset-demo', 'infra:verify-public', 'calls', {
    label: 'node scripts/deploy/verify-public.mjs live',
    sources: [src(RESET_YML, 68, 69, 'verify-public.mjs live')],
    order: 3,
  }),

  // ---- Building the release -------------------------------------------------
  rel('infra:release-build', 'be:prisma/baseline', 'calls', {
    label: 'SEED_NOW=<committer time> npm run db:baseline -- --out <release>/baseline/meridian-baseline.db',
    summary: 'The baseline database is built on the runner, pinned to the commit’s timestamp.',
    sources: [src(BUILD_SH, 69, 93, 'npm run db:baseline')],
    order: 2,
  }),
  rel('infra:release-build', 'infra:runtime-deps', 'calls', {
    label: 'collect-runtime-deps.mjs --out <release>/node_modules',
    sources: [src(BUILD_SH, 110, 110, 'collect-runtime-deps.mjs')],
    order: 3,
  }),
  rel('infra:release-build', 'infra:baseline-check', 'calls', {
    label: 'check-baseline.mjs --release <out> --seed-now <iso>',
    sources: [src(BUILD_SH, 123, 126, 'check-baseline.mjs')],
    order: 4,
  }),
  rel('infra:release-build', 'infra:release-validate', 'calls', {
    label: 'validate-release.sh <out> <sha>',
    sources: [src(BUILD_SH, 128, 128, 'validate-release.sh')],
    order: 5,
  }),
  rel('infra:release-build', 'infra:release', 'writes', {
    label: 'assembles customer/, operations/, backend/, node_modules/, baseline/, package.json, REVISION',
    summary: 'The build script is the only thing that produces a release.',
    sources: [src(BUILD_SH, 96, 121, 'Assemble the release')],
    order: 1,
  }),
  rel('infra:release-build', 'customer', 'deploys', {
    label: 'VITE_PUBLIC_DEMO=true npm run build → customer/',
    summary: 'The customer SPA is built for production (same-origin API) and copied into the release.',
    sources: [src(BUILD_SH, 73, 99, 'apps/customer/dist')],
    detail: 3,
  }),
  rel('infra:release-build', 'operations', 'deploys', {
    label: 'VITE_PUBLIC_DEMO=true npm run build → operations/',
    summary: 'The operations SPA is built for production (same-origin API) and copied into the release.',
    sources: [src(BUILD_SH, 73, 99, 'apps/operations/dist')],
    detail: 3,
  }),
  rel('infra:release-validate', 'infra:remote-release', 'calls', {
    label: 'bash remote/meridian-release.sh validate <dir> <sha>',
    summary: 'Runner-side validation is the server-side function, so the two cannot disagree.',
    sources: [src(`${DEPLOY}/validate-release.sh`, 17, 17, 'validate')],
  }),
  rel('infra:baseline-check', 'db:User', 'reads', {
    label: 'findMany → four showcase users, active, expected roles',
    sources: [src(`${DEPLOY}/check-baseline.mjs`, 74, 94, 'seeded showcase user')],
  }),
  rel('infra:baseline-check', 'db:Session', 'reads', {
    label: 'count() must be 0',
    summary: 'A pristine baseline holds no sessions.',
    sources: [src(`${DEPLOY}/check-baseline.mjs`, 79, 97, 'a pristine baseline must hold no sessions')],
  }),
  rel('infra:baseline-check', 'db:SimulationClock', 'reads', {
    label: 'singleton.currentTime === SEED_NOW',
    sources: [src(`${DEPLOY}/check-baseline.mjs`, 98, 103, 'expected SEED_NOW')],
  }),
  rel('infra:release-smoke', 'backend', 'triggers', {
    label: 'env -i … node backend/index.js (packaged release, temp DB)',
    summary: 'Boots the packaged backend in the production public-demo posture on a copy of the packaged baseline.',
    sources: [src(SMOKE_SH, 49, 64, 'backend/index.js')],
    order: 1,
  }),
  rel('infra:release-smoke', 'infra:verify-public', 'calls', {
    label: 'verify-public.mjs backend --url http://127.0.0.1:<port> --expect-revision <sha>',
    sources: [src(SMOKE_SH, 66, 71, 'verify-public.mjs')],
    order: 2,
  }),
  rel('infra:release', 'be:revision', 'triggers', {
    label: 'REVISION → RELEASE_REVISION → /status.revision',
    summary: 'The backend reads `../REVISION` next to its bundle at start-up and reports it on `GET /status`; `null` outside a packaged release.',
    sources: [src('apps/backend/src/revision.ts', 21, 32, "new URL('../REVISION', import.meta.url)"), src('apps/backend/src/routes/status.ts', 24, 24, 'revision: RELEASE_REVISION')],
  }),

  // ---- Deploying ------------------------------------------------------------
  rel('infra:release-deploy', 'infra:remote-release', 'calls', {
    label: 'ssh meridian "bash -s -- <action> [args]" < remote/meridian-release.sh',
    summary: 'Every server-side step is one action of the streamed script.',
    description: 'In order: `preflight`, `publish`, `rollback-target`, `switch`, `reset`, `verify`, `prune` — plus `state` and `stop` on failure paths.',
    protocol: 'SSH (pinned host key, BatchMode)',
    sources: [src(DEPLOY_SH, 67, 79, 'bash -s -- $*')],
    tags: ['security'],
  }),
  rel('infra:release-deploy', 'infra:release-validate', 'calls', {
    label: 'validate-release.sh <release> <sha>',
    sources: [src(DEPLOY_SH, 123, 126, 'validate-release.sh')],
    order: 1,
  }),
  rel('infra:release-deploy', 'infra:verify-public', 'calls', {
    label: 'verify-public.mjs preflight · live --expect-revision <sha>',
    summary: 'DNS/TLS before anything changes; the full public check after the reset.',
    sources: [src(DEPLOY_SH, 137, 139, 'preflight'), src(DEPLOY_SH, 225, 227, 'live --expect-revision')],
    order: 2,
  }),
  rel('infra:release-deploy', 'infra:host', 'writes', {
    label: 'rsync → meridian:/srv/apps/meridian/incoming/<sha>/',
    summary: 'The release is uploaded to a staging directory — never into `releases/`, `current` or `data/`.',
    protocol: 'rsync over SSH',
    sources: [src(DEPLOY_SH, 141, 149, 'incoming/${sha}/')],
    order: 3,
  }),
  rel('infra:release-deploy', 'backend', 'deploys', {
    label: 'switch current → releases/<sha>, then reset',
    summary: 'The backend restarts from the new release’s bundle on a fresh baseline database.',
    sources: [src(DEPLOY_SH, 171, 176, 'remote 420 switch'), src(DEPLOY_SH, 217, 219, 'remote 900 reset')],
    detail: 2,
  }),
  rel('infra:release-deploy', 'customer', 'deploys', {
    label: 'current/customer becomes the static root',
    summary: 'Switching `current` changes the files served on `https://banking.cowhill.dev`.',
    sources: [src(DEPLOY_SH, 236, 237, 'MERIDIAN_CUSTOMER_HOST')],
    detail: 2,
  }),
  rel('infra:release-deploy', 'operations', 'deploys', {
    label: 'current/operations becomes the static root',
    summary: 'Switching `current` changes the files served on `https://banking-ops.cowhill.dev`.',
    sources: [src(DEPLOY_SH, 236, 237, 'MERIDIAN_OPERATIONS_HOST')],
    detail: 2,
  }),
  rel('infra:remote-release', 'infra:reset-helper', 'calls', {
    label: 'sudo -n /usr/local/sbin/cowhill-meridian-service reset | stop | status',
    summary: 'The script’s only privileged calls, through the restricted sudo contract.',
    sources: [src(REMOTE, 77, 78, 'run_helper reset'), src(REMOTE, 102, 105, '"${HELPER[@]}" "$1"')],
  }),
  rel('infra:remote-release', 'infra:host', 'writes', {
    label: 'incoming/<sha> → releases/<sha>; current → releases/<sha>',
    summary: 'Publishing and switching are plain filesystem operations under `/srv/apps/meridian`.',
    sources: [src(REMOTE, 265, 276, 'mv -T -- "${src}" "${dest}"'), src(REMOTE, 334, 337, 'mv -T -- "${tmp}" "${CURRENT_LINK}"')],
  }),
  rel('infra:verify-public', 'ep:GET /status', 'http', {
    label: 'GET /status (both hostnames)',
    summary: 'Requires status ok, database connected, publicDemo true, isSimulation true, X-Robots-Tag and the expected revision.',
    protocol: 'HTTPS (TLS verified), no credentials',
    sources: [src(VERIFY_MJS, 119, 144, '/status')],
    order: 1,
  }),
  rel('infra:verify-public', 'ep:GET /health', 'http', {
    label: 'GET /health (both hostnames)',
    protocol: 'HTTPS (TLS verified), no credentials',
    sources: [src(VERIFY_MJS, 146, 150, '/health')],
    order: 2,
  }),
  rel('infra:verify-public', 'be:realtime', 'http', {
    label: 'GET /socket.io/?EIO=4&transport=polling',
    summary: 'An anonymous Engine.IO polling handshake must return an open packet with a `sid` — proof the proxy forwards socket traffic. No authentication, no operator events.',
    protocol: 'HTTPS (TLS verified), no credentials',
    sources: [src(VERIFY_MJS, 152, 163, 'EIO=4&transport=polling')],
    order: 3,
  }),
  rel('infra:verify-public', 'infra:reverse-proxy', 'http', {
    label: 'GET / · /dashboard · /queues · /assets/*.js · /robots.txt',
    summary: 'Static checks through the public hostnames: SPA fallback, X-Robots-Tag, the public-demo notice inside the bundle, robots.txt.',
    protocol: 'HTTPS (TLS verified), no credentials',
    sources: [src(VERIFY_MJS, 173, 201, 'checkSpaRoute'), src(VERIFY_MJS, 297, 316, "['/', '/queues']")],
    order: 4,
  }),

  // ---- Hosting (outside this repository) ------------------------------------
  rel('infra:reverse-proxy', 'backend', 'proxies', {
    label: '/api/* · /health · /status · /socket.io/* → 127.0.0.1:8102',
    summary: 'On both public hostnames these path prefixes are forwarded to the loopback-only backend; `/socket.io/*` needs WebSocket upgrade support.',
    description: 'There is no separate API hostname. The backend is built with `trustProxy: true` and reads the client address from `X-Forwarded-For`, which the proxy must overwrite.',
    protocol: 'HTTP reverse proxy (WebSocket upgrade for /socket.io)',
    sources: [src(DEPLOY_DOC, 62, 80, '/api/*        → backend')],
    detail: 2,
  }),
  rel('infra:reverse-proxy', 'customer', 'proxies', {
    label: 'https://banking.cowhill.dev → static current/customer (SPA fallback)',
    summary: 'Serves the built customer app; unknown paths fall back to `index.html`.',
    protocol: 'HTTPS static files',
    sources: [src(DEPLOY_DOC, 57, 60, 'https://banking.cowhill.dev'), src(DEPLOY_DOC, 300, 306, 'SPA fallback')],
    detail: 2,
  }),
  rel('infra:reverse-proxy', 'operations', 'proxies', {
    label: 'https://banking-ops.cowhill.dev → static current/operations (SPA fallback)',
    summary: 'Serves the built operations console; unknown paths fall back to `index.html`.',
    protocol: 'HTTPS static files',
    sources: [src(DEPLOY_DOC, 57, 60, 'https://banking-ops.cowhill.dev'), src(DEPLOY_DOC, 300, 306, 'SPA fallback')],
    detail: 2,
  }),
  rel('infra:backend-service', 'backend', 'triggers', {
    label: 'ExecStart: /usr/bin/node /srv/apps/meridian/current/backend/index.js (as app-meridian)',
    summary: 'systemd runs the backend from whatever release `current` points at.',
    sources: [src(DEPLOY_DOC, 487, 487, '/usr/bin/node /srv/apps/meridian/current/backend/index.js')],
    detail: 3,
  }),
  rel('infra:reset-helper', 'db', 'writes', {
    label: 'copy current/baseline/meridian-baseline.db → data/meridian.db',
    summary: 'A reset replaces the whole live database file; nothing is migrated or merged.',
    sources: [src(DEPLOY_DOC, 488, 488, 'current/baseline/meridian-baseline.db'), src(DEPLOY_DOC, 251, 258, 'replace the whole database')],
    detail: 2,
    tags: ['data'],
  }),
  rel('infra:reset-helper', 'infra:backend-service', 'triggers', {
    label: 'stop → (replace DB) → start → local /health + /status',
    sources: [src(DEPLOY_DOC, 536, 540, 'check local')],
    detail: 3,
  }),
  rel('infra:reset-timer', 'infra:reset-helper', 'triggers', {
    label: 'daily 04:00 America/New_York',
    sources: [src(DEPLOY_DOC, 580, 581, '04:00 America/New_York')],
    detail: 3,
  }),
  rel('infra:cowhill-infrastructure', 'infra:host', 'deploys', {
    label: 'provisions (contract version 1)',
    summary: 'Accounts, directories, Caddy, the service units, the helper, the lock and the timer all come from the infrastructure repository.',
    sources: [src(DEPLOY_DOC, 11, 18, 'contract version 1')],
    detail: 4,
  }),
  rel('infra:host', 'infra:reverse-proxy', 'triggers', {
    label: 'hosts',
    sources: [src(DEPLOY_DOC, 11, 18, 'Caddy for both')],
    detail: 4,
  }),
  rel('infra:env', 'be:config', 'documents', {
    label: 'variables parsed by resolveConfig()',
    summary: '`.env.example` documents exactly what `apps/backend/src/config.ts` reads.',
    sources: [src('apps/backend/src/config.ts', 44, 71, 'export function resolveConfig'), src(DEPLOY_DOC, 47, 48, 'resolveConfig')],
  }),
  rel('infra:backend-service', 'infra:env', 'uses-type', {
    label: 'production environment file',
    summary: 'In production the values are supplied by the infrastructure’s environment file.',
    sources: [src(DEPLOY_DOC, 73, 75, "set by the infrastructure's environment file")],
    detail: 4,
  }),

  // ---- Features + tests -----------------------------------------------------
  rel('infra:ci', 'feat:deploy', 'implements', { label: 'gate + pipeline', sources: [src(CI_YML, 1, 16, 'CI + production deployment')] }),
  rel('infra:release-deploy', 'feat:deploy', 'implements', { label: 'switch, reset, verify, rollback', sources: [src(DEPLOY_SH, 1, 5, 'deploy job only')] }),
  rel('infra:release', 'feat:deploy', 'implements', { label: 'immutable release', sources: [src(BUILD_SH, 14, 23, 'the release directory')] }),
  rel('infra:reset-helper', 'feat:deploy', 'implements', { label: 'reset onto the baseline', sources: [src(DEPLOY_DOC, 578, 583, 'Demo resets')] }),
  rel('infra:reset-demo', 'feat:deploy', 'implements', { label: 'manual reset', sources: [src(RESET_YML, 16, 19, 'Reset demo data')] }),
  rel('test:scripts/deploy/test', 'infra:release-validate', 'tests', {
    label: 'release-validation.test.ts',
    summary: 'One rejection test per validation rule.',
    sources: [src(`${DEPLOY}/test/release-validation.test.ts`, 37, 62, 'accepts a complete release')],
  }),
  rel('test:scripts/deploy/test', 'infra:remote-release', 'tests', {
    label: 'remote-server.test.ts',
    summary: 'Publish and reruns, rollback target, the locked compare-and-swap switch, verify, prune.',
    sources: [src(`${DEPLOY}/test/remote-server.test.ts`, 84, 104, 'writes .release-ready last'), src(`${DEPLOY}/test/remote-server.test.ts`, 228, 237, 'exits 3 without switching when current changed')],
  }),
  rel('test:scripts/deploy/test', 'infra:release-deploy', 'tests', {
    label: 'deploy-flow.test.ts',
    summary: 'First deployment, upgrade, stale runs, pre-switch failures, rollback, failed rollback, reruns.',
    sources: [src(`${DEPLOY}/test/deploy-flow.test.ts`, 56, 69, 'first deployment'), src(`${DEPLOY}/test/deploy-flow.test.ts`, 159, 178, 'a failed rollback stops the service and fails loudly')],
  }),
  rel('test:scripts/deploy/test', 'infra:release-archive', 'tests', {
    label: 'archive.test.ts',
    sources: [src(`${DEPLOY}/test/archive.test.ts`, 36, 67, 'rejects a corrupted archive')],
  }),
  rel('test:scripts/deploy/test', 'infra:ssh-setup', 'tests', {
    label: 'ssh-setup.test.ts',
    sources: [src(`${DEPLOY}/test/ssh-setup.test.ts`, 55, 81, 'prints no secret')],
  }),
  rel('test:scripts/deploy/test', 'infra:verify-public', 'tests', {
    label: 'verify-public.test.ts',
    sources: [src(`${DEPLOY}/test/verify-public.test.ts`, 113, 140, 'fails when the deployed revision is not the expected one')],
  }),
  rel('test:scripts/deploy/test', 'infra:ci', 'tests', {
    label: 'workflows.test.ts — deployment gating + secrets',
    summary: 'Parses `ci.yml` and asserts when deploy can and cannot run, the concurrency group, and that only one step sees secrets.',
    sources: [src(`${DEPLOY}/test/workflows.test.ts`, 92, 162, 'never deploys when a prerequisite failed, was skipped or cancelled'), src(`${DEPLOY}/test/workflows.test.ts`, 208, 234, 'only the deploy job sees secrets')],
  }),
  rel('test:scripts/deploy/test', 'infra:reset-demo', 'tests', {
    label: 'workflows.test.ts — reset-demo.yml',
    sources: [src(`${DEPLOY}/test/workflows.test.ts`, 271, 306, 'the helper reset is the only state change')],
  }),
  rel('infra:ci#verify', 'test:scripts/deploy/test', 'calls', {
    label: 'REQUIRE_DEPLOY_TESTS=1 npm run verify',
    summary: 'In CI a missing shell tool is an error rather than a skipped deployment test.',
    sources: [src(CI_YML, 69, 75, "REQUIRE_DEPLOY_TESTS: '1'"), src(`${DEPLOY}/test/helpers.ts`, 43, 55, 'REQUIRE_DEPLOY_TESTS')],
    detail: 5,
  }),
];

export const infraStateMachines: StateMachine[] = [
  {
    id: 'sm:release',
    name: 'Release lifecycle on the server',
    summary: 'How one release moves from an upload to the active release, then to the rollback target, and is finally pruned.',
    subject: 'infra:release',
    field: 'location under /srv/apps/meridian',
    initial: 'uploaded',
    states: [
      { id: 'uploaded', label: 'Uploaded', description: '`incoming/<sha>/` — rsync’d, not yet validated by the server.' },
      { id: 'ready', label: 'Ready', description: '`releases/<sha>/` with `.release-ready` — validated and immutable, but not serving.' },
      { id: 'current', label: 'Current', description: '`current` points at it; Caddy serves its static files and the backend runs its bundle.' },
      { id: 'previous', label: 'Previous', description: 'Kept as the rollback target after a newer release became current.' },
      { id: 'pruned', label: 'Pruned', description: 'Removed from the server.', terminal: true },
    ],
    transitions: [
      {
        from: 'uploaded',
        to: 'ready',
        label: 'publish',
        by: 'infra:remote-release',
        description: 'Validate, `mv -T` into `releases/`, normalise modes, validate again, sync, then create `.release-ready` last.',
        source: src(REMOTE, 245, 277, 'the marker means every part of the release is complete'),
      },
      {
        from: 'ready',
        to: 'current',
        label: 'switch (locked compare-and-swap)',
        by: 'infra:remote-release',
        description: 'Under `flock`: `current` must still be the expected value; a temp symlink is renamed over it with `mv -T`.',
        source: src(REMOTE, 305, 348, 'mv -T -- "${tmp}" "${CURRENT_LINK}"'),
      },
      {
        from: 'current',
        to: 'previous',
        label: 'a newer release is switched in',
        by: 'infra:remote-release',
        description: 'Captured beforehand by `rollback-target` — accepted only if it is ready and its REVISION equals its directory name.',
        source: src(REMOTE, 279, 303, 'do_rollback_target()'),
      },
      {
        from: 'previous',
        to: 'current',
        label: 'rollback',
        by: 'infra:release-deploy',
        description: 'After a failed reset or verification: switch back, reset onto this release’s own baseline, verify.',
        source: src(DEPLOY_SH, 190, 215, 'ROLLBACK to releases/${previous}'),
      },
      {
        from: 'current',
        to: 'ready',
        label: 'rolled back from',
        by: 'infra:release-deploy',
        description: 'The failed release stays on disk (ready, not current) until a later successful deployment prunes it.',
        source: src(DEPLOY_SH, 198, 204, 'remote 420 switch "${previous}" "${sha}"'),
        confidence: 'inferred',
      },
      {
        from: 'previous',
        to: 'pruned',
        label: 'prune (two deployments later)',
        by: 'infra:remote-release',
        description: 'Only `current` and one previous ready release are kept.',
        source: src(REMOTE, 372, 410, 'prune: removing releases/'),
      },
      {
        from: 'ready',
        to: 'pruned',
        label: 'prune (never switched to, e.g. a stale run)',
        by: 'infra:remote-release',
        source: src(REMOTE, 398, 410, 'rm -rf -- "${RELEASES_DIR:?}/${name}"'),
      },
      {
        from: 'uploaded',
        to: 'pruned',
        label: 'prune clears incoming/',
        by: 'infra:remote-release',
        source: src(REMOTE, 412, 421, 'prune: removing incoming/'),
      },
    ],
    sources: [src(DEPLOY_DOC, 519, 549, '.release-ready` last')],
  },
];
