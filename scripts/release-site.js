'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { isPage, isProject } = require('../admin/repository');
const SHA = /^[a-f0-9]{40}$/;
const editable = name => isPage(name) || isProject(name) || /^images\/editor\/[a-z0-9-]+\.(png|jpg|jpeg|gif|webp)$/.test(name);

function apiClient(env = process.env, fetcher = fetch) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '') || !env.GH_TOKEN) throw new Error('GitHub release credentials are not configured.');
    return async (route, body, method = body ? 'POST' : 'GET') => {
        const response = await fetcher('https://api.github.com/repos/' + env.GITHUB_REPOSITORY + route, {
            method, redirect: 'error', signal: AbortSignal.timeout(30000),
            headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error('GitHub release request failed (HTTP ' + response.status + '). No force update was attempted.');
        return response.status === 204 ? null : response.json();
    };
}

async function prepareRelease(event, api, repository) {
    const trigger = event.workflow_run;
    if (!trigger || !Number.isSafeInteger(trigger.id) || !SHA.test(trigger.head_sha || '')) throw new Error('Invalid check event.');
    // Re-read the authoritative run. Never trust an artifact or a PR payload.
    const run = await api('/actions/runs/' + trigger.id);
    if (run.path !== '.github/workflows/site-checks.yml' || run.event !== 'push' || run.conclusion !== 'success' ||
        run.head_sha !== trigger.head_sha || run.head_repository?.full_name !== repository ||
        !(run.head_branch === 'main' || /^cms\/[a-z0-9-]+$/.test(run.head_branch))) throw new Error('This commit has no eligible successful checks.');
    const current = (await api('/git/ref/heads/main')).object.sha;
    if (run.head_branch !== 'main' && current !== run.head_sha) {
        const commit = await api('/git/commits/' + run.head_sha);
        if (commit.parents?.length !== 1 || commit.parents[0].sha !== current) throw new Error('Main changed during checks. Reopen the editor and reconcile the saved draft.');
        const compare = await api('/compare/' + current + '...' + run.head_sha);
        if (compare.total_commits !== 1 || compare.status !== 'ahead' || !compare.files?.length || compare.files.length > 100 ||
            compare.files.some(file => !['added', 'modified'].includes(file.status) || !editable(file.filename))) throw new Error('Only editor content may be published automatically.');
        const tree = await api('/git/trees/' + commit.tree.sha + '?recursive=1');
        if (tree.truncated || compare.files.some(file => !tree.tree.some(entry => entry.path === file.filename && entry.type === 'blob' && entry.mode === '100644'))) throw new Error('Unsafe or incomplete content tree.');
        // A concurrent change makes this non-fast-forward and GitHub rejects it.
        await api('/git/refs/heads/main', { sha: run.head_sha, force: false }, 'PATCH');
    } else if (current !== run.head_sha) throw new Error('A newer main commit already exists. This release is obsolete.');
    return run.head_sha;
}

async function reportStatus(event, api, state, env = process.env) {
    if (!['pending', 'success', 'failure'].includes(state) || !SHA.test(event.workflow_run?.head_sha || '')) throw new Error('Invalid publication status.');
    const description = { pending: 'Checking release and publishing site', success: 'Checks passed; publication workflow completed', failure: 'Publication stopped; see workflow details' }[state];
    return api('/statuses/' + event.workflow_run.head_sha, { state, context: 'TCG publication', description,
        target_url: 'https://github.com/' + env.GITHUB_REPOSITORY + '/actions/runs/' + env.GITHUB_RUN_ID });
}

if (require.main === module) (async () => {
    const env = process.env, event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')), api = apiClient(env);
    if (process.argv[2] === 'status') return reportStatus(event, api, process.argv[3]);
    const sha = await prepareRelease(event, api, env.GITHUB_REPOSITORY);
    const source = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'tcg-release-'));
    const archive = path.join(source, 'source.tar'), directory = path.join(source, 'website');
    fs.mkdirSync(directory);
    execFileSync('git', ['archive', '--format=tar', '--output=' + archive, sha], { stdio: 'pipe' });
    execFileSync('tar', ['-xf', archive, '-C', directory], { stdio: 'pipe' });
    fs.unlinkSync(archive);
    fs.appendFileSync(env.GITHUB_OUTPUT, 'sha=' + sha + '\nsource=' + directory + '\n');
    console.log('Checked release prepared: ' + sha);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareRelease, reportStatus, apiClient };
