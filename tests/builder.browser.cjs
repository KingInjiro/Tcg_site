// Run against an isolated copy: never publish to GitHub or edit the working site.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const { createApp } = require('../server');
const { publicEntries } = require('../lib/site-files');
const { build } = require('../scripts/build');
const source = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-browser-'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const exists = name => fs.existsSync(path.join(root, name));
const screenshot = async (page, name) => {
    if (!process.env.TCG_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.TCG_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.TCG_SCREENSHOT_DIR, name + '.png') });
};
(async () => {
    for (const name of publicEntries(source)) fs.cpSync(path.join(source, name), path.join(root, name), { recursive: true });
    build(root);
    const server = createApp({ dev: true, root }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser, page;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === origin || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
        const open = async name => {
            await page.locator('[data-path="' + name + '"]').click();
            await page.waitForFunction(name => document.getElementById('current-path').textContent === '/' + name, name);
        };
        const login = async () => {
            await page.goto(origin + '/admin/?local=true'); await page.locator('#login').click();
            await page.waitForFunction(() => document.getElementById('current-path').textContent === '/index.html');
        };
        const publish = async () => {
            await page.locator('#publish').click();
            await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Збережено.'), {}, { timeout: 15000 });
        };
        await login();
        await screenshot(page, 'builder-existing-page');
        const entries = yaml.load(read('admin/config.yml')).collections.flatMap(collection => collection.files).map(file => file.file);
        const listed = await page.locator('#page-list [data-path]').evaluateAll(nodes => nodes.map(node => node.dataset.path));
        assert.deepEqual(listed.sort(), [...entries].sort(), 'only real pages are offered, never binary documents or saved 404 responses');
        for (const name of entries) {
            if (name !== 'index.html') await open(name);
            const result = await page.evaluate(({ html, name }) => {
                const editor = window.grapesjs.editors.at(-1), D = window.TCGDocument;
                const output = D.exportHTML(editor, D.importHTML(html, name).meta);
                const parse = text => new DOMParser().parseFromString(text, 'text/html');
                const a = parse(html), b = parse(output), differences = [];
                const list = (doc, selector, attribute) => [...doc.querySelectorAll(selector)].map(node => node.getAttribute(attribute)).sort();
                for (const [selector, attribute] of [['img', 'src'], ['a', 'href'], ['link[rel="stylesheet"]', 'href']]) if (JSON.stringify(list(a, selector, attribute)) !== JSON.stringify(list(b, selector, attribute))) differences.push(selector);
                const scripts = doc => [...doc.querySelectorAll('script')].map(node => node.outerHTML).sort();
                if (JSON.stringify(scripts(a)) !== JSON.stringify(scripts(b))) differences.push('scripts');
                const text = doc => { doc.querySelectorAll('script,style').forEach(node => node.remove()); return doc.body.textContent.replace(/\s/g, ''); };
                if (text(a) !== text(b)) differences.push('text');
                return { differences, dirty: !document.getElementById('publish').disabled };
            }, { html: read(name), name });
            assert.deepEqual(result, { differences: [], dirty: false }, name);
            const broken = await page.frameLocator('.gjs-frame').locator('body').evaluate(async body => {
                const images = [...body.querySelectorAll('img')].filter(img => new URL(img.src, document.baseURI).origin === new URL(document.baseURI).origin || img.src.startsWith('data:'));
                await Promise.all(images.map(img => img.decode().catch(() => {})));
                return images.filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src'));
            });
            assert.deepEqual(broken, [], name + ': every local image must decode in the editor');
        }
        console.log(`PASS ${entries.length} real pages: clean round trip, preserved contents and decoded editor images; invalid imports excluded`);
        const originalContacts = read('contacts.html');
        await open('contacts.html'); await page.locator('#page-title').fill('Контакти — перевірено');
        await page.locator('#new-page').click(); await page.locator('#new-title').fill('Нова тест сторінка');
        assert.equal(await page.locator('#new-slug').inputValue(), 'nova-test-storinka');
        await page.getByRole('button', { name: 'Створити сторінку', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('current-path').textContent === '/nova-test-storinka.html');
        let canvas = page.frameLocator('.gjs-frame');
        await canvas.getByText('Нова тест сторінка', { exact: true }).dblclick();
        await canvas.locator('[contenteditable="true"]').fill('Нова сторінка без коду'); await page.locator('#page-title').click();
        const block = page.locator('.gjs-block').filter({ hasText: 'Текст' }).first();
        const bb = await block.boundingBox(), target = await canvas.locator('main').boundingBox();
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height - 10, { steps: 18 }); await page.mouse.up();
        await canvas.getByText('Двічі натисніть, щоб змінити цей текст.', { exact: true }).waitFor();
        await page.locator('#mobile').click(); await page.waitForFunction(() => document.querySelector('.gjs-frame').getBoundingClientRect().width < 450);
        await page.locator('#desktop').click();
        console.log('PASS new page, automatic URL, inline text editing, block drag and mobile viewport');

        // Use the public UI to add and upload an image, not a model API shortcut.
        await page.getByRole('button', { name: 'Зображення', exact: true }).click();
        if (!await page.locator('#asset-dialog').isVisible()) await page.locator('#choose-image').click();
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9HcAAAAASUVORK5CYII=', 'base64');
        await page.locator('#asset-upload').setInputFiles({ name: 'test-image.png', mimeType: 'image/png', buffer: png });
        await page.locator('#asset-dialog').waitFor({ state: 'hidden' });
        await publish();
        const html = read('nova-test-storinka.html');
        assert.ok(html.includes('Нова сторінка без коду'));
        assert.ok(html.includes('Двічі натисніть, щоб змінити цей текст.'));
        assert.ok(html.includes('/images/editor/'));
        assert.ok(!html.includes('data:image/png;base64'));
        assert.equal(fs.readdirSync(path.join(root, 'images/editor')).length, 1);
        const contacts = read('contacts.html');
        assert.ok(contacts.includes('href="/nova-test-storinka.html"'));
        assert.ok(contacts.includes('<title>Контакти — перевірено</title>'));
        assert.equal((contacts.match(/<script\b/gi) || []).length, (originalContacts.match(/<script\b/gi) || []).length);
        assert.ok(exists('.tcg-editor/nova-test-storinka.html.json'));
        console.log('PASS atomic local publish: two pages, project data, uploaded image and inbound link');

        await page.reload(); await page.locator('#login').click();
        await page.waitForFunction(() => document.getElementById('current-path').textContent === '/index.html');
        await open('nova-test-storinka.html'); canvas = page.frameLocator('.gjs-frame');
        await canvas.getByText('Нова сторінка без коду', { exact: true }).waitFor();
        assert.equal(await page.locator('#publish').isDisabled(), true);
        await screenshot(page, 'builder-new-page');
        const live = await browser.newPage(); await live.goto(origin + '/nova-test-storinka.html');
        assert.equal(await live.locator('h1').innerText(), 'Нова сторінка без коду');
        assert.ok(await live.locator('img').evaluate(image => image.complete && image.naturalWidth === 1));
        await live.close();
        console.log('PASS published page and image served; editable blocks survive reopening');

        await page.locator('#page-title').fill('Чернетка для відновлення');
        const downloadPromise = page.waitForEvent('download'); await page.locator('#backup').click();
        const download = await downloadPromise, backup = await download.path();
        const data = JSON.parse(fs.readFileSync(backup, 'utf8'));
        assert.equal(data.pages.length, 1); assert.ok(!JSON.stringify(data).includes('token'));
        page.once('dialog', dialog => dialog.accept()); await page.reload(); await page.locator('#login').click();
        await page.waitForFunction(() => document.getElementById('current-path').textContent === '/index.html');
        await page.locator('#restore-file').setInputFiles(backup);
        await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Чернетки відновлено'));
        assert.equal(await page.locator('#page-title').inputValue(), 'Чернетка для відновлення'); await publish();
        console.log('PASS draft download, restore and publish without credentials in backup');

        await page.locator('#new-page').click(); await page.locator('#new-title').fill('Копія сторінки');
        await page.locator('#new-template').selectOption('copy'); await page.locator('#new-link').uncheck();
        await page.getByRole('button', { name: 'Створити сторінку', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('current-path').textContent === '/kopiya-storinky.html');
        await page.frameLocator('.gjs-frame').getByText('Нова сторінка без коду', { exact: true }).waitFor();
        await publish(); assert.ok(read('kopiya-storinky.html').includes('<title>Копія сторінки</title>'));
        console.log('PASS copy existing page preserves contents and changes only the new title');

        await page.locator('#page-title').fill('Не перезаписувати іншу зміну');
        fs.appendFileSync(path.join(root, 'contacts.html'), '\n<!-- concurrent editor -->');
        await page.locator('#publish').click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Сайт змінився'));
        assert.ok(!read('kopiya-storinky.html').includes('Не перезаписувати іншу зміну'));
        assert.equal(await page.locator('#publish').isDisabled(), false);
        console.log('PASS concurrent changes keep both the published version and unsaved draft');
        assert.deepEqual(errors, []);
    } catch (error) {
        if (page) { console.error('Editor status:', await page.locator('#status').innerText()); await screenshot(page, 'builder-failure'); }
        throw error;
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
