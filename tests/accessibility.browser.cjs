// Structural checks do not constitute WCAG certification or a manual accessibility audit.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { pageFiles, pageURL } = require('../lib/site-routes');
const preservedStyleFindings = require('./fixtures/accessibility-legacy.json');
(async () => {
    const root = path.resolve(__dirname, '..');
    const server = express().use(express.static(path.join(root, 'dist'))).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage({ serviceWorkers: 'block' });
        await page.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        const report = [];
        for (const file of pageFiles(root)) {
            await page.goto(origin + pageURL(file), { waitUntil: 'load' });
            await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
            const scan = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
            report.push({ file, violations: scan.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })),
                incomplete: scan.incomplete.map(v => ({ id: v.id, nodes: v.nodes.length })) });
        }
        if (process.env.TCG_A11Y_REPORT) fs.writeFileSync(process.env.TCG_A11Y_REPORT, JSON.stringify(report, null, 2));
        console.log('ACCESSIBILITY_REPORT ' + JSON.stringify(report.filter(r => r.violations.length)));
        const unexpected = report.flatMap(r => r.violations.flatMap(v => v.nodes.filter(n =>
            !preservedStyleFindings.some(known => known.file === r.file && known.rule === v.id && JSON.stringify(known.target) === JSON.stringify(n.target))
        ).map(n => ({ file: r.file, rule: v.id, ...n }))));
        assert.deepEqual(unexpected, [], 'no new WCAG A/AA findings, including new contrast/link-style findings');
        console.log('Known unchanged-style findings: ' + preservedStyleFindings.length + ' exact targets; other occurrences of the same rules still fail.');
        console.log('PASS structural accessibility scan on ' + report.length + ' pages. Original colour/link styling findings are reported separately; this is not WCAG certification.');
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
