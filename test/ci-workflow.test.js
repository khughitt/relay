import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const path = new URL('../.github/workflows/ci.yml', import.meta.url);
function workflow() { assert.ok(existsSync(path), 'hosted workflow must exist'); return readFileSync(path, 'utf8'); }

test('every branch push has one cancellable two-runtime forced workflow', () => {
  const text = workflow();
  for (const pattern of [/push:\s*\n\s+branches: \['\*\*'\]/, /workflow_dispatch:/, /contents: read/,
    /group: \$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}/, /cancel-in-progress: true/,
    /runs-on: ubuntu-24\.04/, /node: \['22', '26'\]/, /fail-fast: false/, /timeout-minutes: 20/,
    /    env:\n      TT_FORCE: '1'/, /persist-credentials: false/, /fetch-depth: 0/]) assert.match(text, pattern);
  assert.doesNotMatch(text, /pull_request|continue-on-error|self-hosted|secrets\.|repository:/);
  for (const line of text.matchAll(/uses: ([^\n]+)/g)) assert.match(line[1], /@[a-f0-9]{40}(?: |$)/);
  const justfile = readFileSync(new URL('../justfile', import.meta.url), 'utf8');
  assert.match(justfile, /^ci_remote := "origin"$/m);
  assert.match(justfile, /^ci_suite_refs := "refs\/heads\/\*"$/m);
});
test('hosted setup exposes just to isolated fixtures and proves namespace capability', () => {
  const text = workflow();
  assert.match(text, /sudo install -m 755 "\$\(command -v just\)" \/usr\/bin\/just/);
  assert.match(text, /sudo sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0/);
  assert.match(text, /unshare --user --map-root-user --pid --fork --mount-proc true/);
  assert.match(text, /test "\$\(sysctl -n kernel\.apparmor_restrict_unprivileged_userns\)" = 0/);
  assert.doesNotMatch(text, /sudo unshare|\/etc\/sysctl|apparmor_restrict_unprivileged_unconfined|\|\| true/);
  const ordered = ['sudo install -m 755', 'sudo sysctl -w', 'unshare --user', 'just setup', 'just ci-check-hygiene', 'just check-code', 'just test'];
  for (let i = 1; i < ordered.length; i++) assert.ok(text.indexOf(ordered[i]) > text.indexOf(ordered[i - 1]), `${ordered[i]} follows ${ordered[i - 1]}`);
  assert.match(text, /GIT_CONFIG_GLOBAL=.*RUNNER_TEMP.*GITHUB_ENV/);
});
