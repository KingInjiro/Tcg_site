const crypto = require('node:crypto');

const REPOSITORY = 'KingInjiro/Tcg_site';
const COOKIE = 'tcg_oauth';
const TTL = 10 * 60 * 1000;

function settings(env) {
    if (!env.CMS_ORIGIN || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        throw new Error('Вхід ще не налаштовано. Вкажіть CMS_ORIGIN, GITHUB_CLIENT_ID та GITHUB_CLIENT_SECRET у налаштуваннях сервера.');
    }
    const url = new URL(env.CMS_ORIGIN);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('CMS_ORIGIN має містити HTTPS-адресу сайту без шляху. HTTP дозволено лише для localhost.');
    }
    return { origin: url.origin, secure: url.protocol === 'https:', id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET };
}

function headers(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
}

function text(res, status, message) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(message);
}

function cookie(value, config, maxAge) {
    return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? '; Secure' : ''}`;
}

function sign(value, secret) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function equal(a, b) {
    return typeof a === 'string' && typeof b === 'string' &&
        Buffer.byteLength(a) === Buffer.byteLength(b) &&
        crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function readSession(req, secret, now) {
    const value = (req.headers.cookie || '').split(';').map(part => part.trim())
        .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!value || value.length > 2048) return null;
    const [data, signature, extra] = value.split('.');
    if (extra || !equal(signature, sign(data, secret))) return null;
    try {
        const session = JSON.parse(Buffer.from(data, 'base64url').toString());
        return session.expires > now && session.expires <= now + TTL &&
            typeof session.state === 'string' && typeof session.verifier === 'string' ? session : null;
    } catch { return null; }
}

function sendResult(res, config, status, data, statusCode = 200) {
    const nonce = crypto.randomBytes(18).toString('base64');
    const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
    res.end(`<!DOCTYPE html><html lang="uk"><meta charset="utf-8"><title>Вхід у TCG</title>
<p id="status">Завершення входу…</p>
<script nonce="${nonce}">
const origin = ${json(config.origin)};
const message = ${json('authorization:github:' + status + ':' + JSON.stringify(data))};
if (window.opener) {
    window.addEventListener('message', function receive(event) {
        if (event.origin !== origin || event.source !== window.opener || event.data !== 'authorizing:github') return;
        window.removeEventListener('message', receive);
        window.opener.postMessage(message, origin);
        document.getElementById('status').textContent = 'Поверніться до вікна редактора.';
    });
    window.opener.postMessage('authorizing:github', origin);
} else {
    document.getElementById('status').textContent = 'Відкрийте /admin/ і почніть вхід знову.';
}
</script></html>`);
}

function createOAuth({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    function prepare(req, res) {
        headers(res);
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            text(res, 405, 'Method not allowed');
            return null;
        }
        try { return settings(env); }
        catch (error) {
            text(res, 503, error instanceof TypeError ? 'CMS_ORIGIN має містити коректну адресу сайту.' : error.message);
            return null;
        }
    }

    function auth(req, res) {
        const config = prepare(req, res);
        if (!config) return;
        const query = new URL(req.url, config.origin).searchParams;
        if (query.has('provider') && query.get('provider') !== 'github') return text(res, 400, 'Unsupported provider');
        const session = {
            state: crypto.randomBytes(32).toString('base64url'),
            verifier: crypto.randomBytes(32).toString('base64url'),
            expires: now() + TTL,
        };
        const data = Buffer.from(JSON.stringify(session)).toString('base64url');
        res.setHeader('Set-Cookie', cookie(`${data}.${sign(data, config.secret)}`, config, TTL / 1000));
        const url = new URL('https://github.com/login/oauth/authorize');
        url.search = new URLSearchParams({
            client_id: config.id,
            redirect_uri: config.origin + '/api/callback',
            scope: 'public_repo',
            state: session.state,
            code_challenge: crypto.createHash('sha256').update(session.verifier).digest('base64url'),
            code_challenge_method: 'S256',
        }).toString();
        res.statusCode = 302;
        res.setHeader('Location', url.href);
        res.end();
    }

    async function callback(req, res) {
        const config = prepare(req, res);
        if (!config) return;
        const query = new URL(req.url, config.origin).searchParams;
        const session = readSession(req, config.secret, now());
        res.setHeader('Set-Cookie', cookie('', config, 0));
        if (!session || !equal(query.get('state'), session.state)) {
            return text(res, 400, 'Сеанс входу недійсний або закінчився. Відкрийте /admin/ і почніть вхід знову.');
        }
        if (query.has('error')) {
            return sendResult(res, config, 'error', { message: 'Вхід через GitHub скасовано. Спробуйте знову.' });
        }
        const code = query.get('code');
        if (!code || code.length > 1024) return text(res, 400, 'Missing authorization code');
        try {
            const response = await fetchImpl('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: config.id, client_secret: config.secret, code,
                    redirect_uri: config.origin + '/api/callback', code_verifier: session.verifier,
                }),
                signal: AbortSignal.timeout(10000),
            });
            const token = await response.json();
            if (!response.ok || typeof token.access_token !== 'string' || !token.access_token) throw new Error('Token exchange failed');
            // Authenticate and check write access before returning a token to Decap.
            const repo = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}`, {
                headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'TCG-CMS' },
                signal: AbortSignal.timeout(10000),
            });
            if (!repo.ok || (await repo.json()).permissions?.push !== true) {
                return sendResult(res, config, 'error', { message: `Цей обліковий запис не має права редагувати ${REPOSITORY}.` }, 403);
            }
            sendResult(res, config, 'success', { token: token.access_token, provider: 'github' });
        } catch {
            // Never expose upstream response bodies, OAuth codes or credentials.
            sendResult(res, config, 'error', { message: 'Не вдалося завершити вхід через GitHub. Спробуйте ще раз або перевірте налаштування OAuth.' }, 502);
        }
    }

    return { auth, callback };
}

module.exports = { createOAuth };
