/* Progressive SPA navigation: static URLs and ordinary links remain the fallback. */
(() => {
    'use strict';
    if (window.top !== window || !window.fetch || !window.DOMParser || !history.pushState || window.TCGNavigation) return;
    window.TCGNavigation = true;
    const managed = new Set(['/themes/navigation.js', '/themes/service-worker.js', '/themes/clean-urls.js']);
    const modules = new Set(['/themes/search.js', '/themes/contact.js', '/themes/calculators.js', '/themes/news.js']);
    const thirdParty = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
    const loaded = new Map([...document.scripts].filter(s => s.src).map(s => [s.src, Promise.resolve()]));
    let sequence = 0, pending, changing = false, rendered = location.pathname + location.search, scrollFrame;
    history.scrollRestoration = 'manual';
    const saveScroll = () => {
        if (!changing) history.replaceState({ ...history.state, tcgScroll: [scrollX, scrollY] }, '', location.href);
    };
    saveScroll();
    addEventListener('scroll', () => { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(saveScroll); }, { passive: true });
    function loadScript(src) {
        const url = new URL(src, location.href).href;
        if (!loaded.has(url)) loaded.set(url, new Promise((resolve, reject) => {
            const script = document.createElement('script'), timer = setTimeout(() => { script.remove(); reject(new Error('script timeout')); }, 10000);
            script.src = url;
            script.onload = () => { clearTimeout(timer); resolve(); };
            script.onerror = () => { clearTimeout(timer); reject(new Error('script unavailable')); };
            document.head.append(script);
        }));
        return loaded.get(url);
    }
    function legacyAd(script) {
        const code = script.textContent.replace(/<!--|-->|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim();
        return /^google_ad_client\s*=\s*"pub-\d+";\s*google_ad_slot\s*=\s*"\d+";\s*google_ad_width\s*=\s*\d+;\s*google_ad_height\s*=\s*\d+;$/.test(code);
    }
    function scriptSupported(script) {
        if (!script.src) return !script.textContent.trim() || legacyAd(script) ||
            /navigator\.serviceWorker\.register\('\/sw\.js'\)/.test(script.textContent);
        const url = new URL(script.getAttribute('src'), location.href);
        return url.href === thirdParty || (url.origin === location.origin && (modules.has(url.pathname) || managed.has(url.pathname)));
    }
    function copyAttributes(from, to) {
        for (const attr of [...to.attributes]) to.removeAttribute(attr.name);
        for (const attr of from.attributes) to.setAttribute(attr.name, attr.value);
    }
    async function position(url, saved) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const main = document.querySelector('main, [role="main"]');
        if (main) { if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
        if (saved) scrollTo(...saved);
        else if (url.hash) {
            let id; try { id = decodeURIComponent(url.hash.slice(1)); } catch { id = url.hash.slice(1); }
            const anchor = document.getElementById(id) || document.getElementsByName(id)[0];
            if (anchor) { anchor.scrollIntoView(); if (anchor.matches('a,button,input,select,textarea,[tabindex]')) anchor.focus({ preventScroll: true }); }
            else scrollTo(0, 0);
        } else scrollTo(0, 0);
    }
    async function visit(url, pop = false, saved) {
        const current = ++sequence;
        pending?.abort(); pending = new AbortController();
        const controller = pending, temporary = [];
        if (!pop) saveScroll();
        changing = true;
        document.documentElement.setAttribute('aria-busy', 'true');
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url.href, { headers: { 'X-TCG-Navigation': '1' }, signal: controller.signal });
            if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || new URL(response.url).origin !== location.origin) throw new Error('not a public page');
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            if (doc.querySelector('meta[name="tcg-page"]')?.content !== '1' || doc.querySelector('base')) throw new Error('ordinary navigation required');
            const scripts = [...doc.scripts];
            if (!scripts.every(scriptSupported)) throw new Error('custom page script requires its own document');
            const finalURL = new URL(response.url); finalURL.hash = url.hash;
            // Load new styles without applying them to the old page. Reuse these loaded nodes at commit.
            const sheets = [...doc.head.querySelectorAll('link[rel="stylesheet"]')];
            const replacements = new Map();
            await Promise.all(sheets.map(link => new Promise((resolve, reject) => {
                const sheet = document.importNode(link, true), media = sheet.getAttribute('media');
                sheet.media = 'not all'; temporary.push(sheet); replacements.set(link, { sheet, media });
                const timer = setTimeout(() => reject(new Error('stylesheet timeout')), 10000);
                const done = error => { clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
                const aborted = () => done(new Error('superseded'));
                controller.signal.addEventListener('abort', aborted, { once: true });
                sheet.onload = () => done(); sheet.onerror = () => done(new Error('stylesheet unavailable'));
                document.head.append(sheet);
            })));
            for (const script of scripts) {
                const src = script.getAttribute('src');
                if (src && modules.has(new URL(src, finalURL).pathname)) await loadScript(src);
            }
            if (current !== sequence || controller.signal.aborted) return;
            const adSettings = scripts.filter(legacyAd).map(script => script.textContent);
            scripts.forEach(script => script.remove());
            const head = [...doc.head.childNodes].map(node => {
                const replacement = replacements.get(node);
                if (!replacement) return document.importNode(node, true);
                if (replacement.media === null) replacement.sheet.removeAttribute('media'); else replacement.sheet.media = replacement.media;
                return replacement.sheet;
            });
            // One synchronous commit prevents styles from a previous page leaking into the next one.
            if (!pop) history.pushState({ tcgScroll: [0, 0] }, '', finalURL);
            copyAttributes(doc.documentElement, document.documentElement);
            document.head.replaceChildren(...head);
            document.body.replaceWith(document.importNode(doc.body, true));
            rendered = finalURL.pathname + finalURL.search;
            document.dispatchEvent(new Event('tcg:page-load'));
            if (scripts.some(script => script.getAttribute('src') === thirdParty)) {
                for (const code of adSettings) { const script = document.createElement('script'); script.textContent = code; document.head.append(script); }
                loadScript(thirdParty).catch(() => {});
            }
            await position(finalURL, pop ? saved : null);
        } catch {
            if (current === sequence) { history.scrollRestoration = 'auto'; pop ? location.reload() : location.assign(url.href); }
        } finally {
            clearTimeout(timeout);
            for (const sheet of temporary) if (sheet.media === 'not all') sheet.remove();
            if (current === sequence) { changing = false; document.documentElement.removeAttribute('aria-busy'); saveScroll(); }
        }
    }
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.('a[data-tcg-page], area[data-tcg-page]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.relList.contains('external')) return;
        const url = new URL(link.href);
        if (url.origin !== location.origin || !/^https?:$/.test(url.protocol) ||
            (url.pathname === location.pathname && url.search === location.search)) return;
        event.preventDefault(); visit(url);
    });
    addEventListener('popstate', event => {
        const url = new URL(location.href);
        if (url.pathname + url.search === rendered) {
            ++sequence; pending?.abort(); changing = false;
            document.documentElement.removeAttribute('aria-busy');
            position(url, event.state?.tcgScroll);
        }
        else visit(url, true, event.state?.tcgScroll);
    });
})();
