'use strict';
const { checkMail } = require('./mail-settings');
function createMailStatus({ env = process.env, fetchImpl = fetch, diagnose = checkMail } = {}) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const reply = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'Метод не підтримується.' }); }
        const authorization = req.headers.authorization || '';
        if (!/^Bearer [A-Za-z0-9_]+$/.test(authorization) || authorization.length > 1024) return reply(401, { error: 'Увійдіть через GitHub.' });
        try {
            const response = await fetchImpl('https://api.github.com/repos/KingInjiro/Tcg_site', {
                headers: { Authorization: authorization, Accept: 'application/vnd.github+json', 'User-Agent': 'TCG-admin' },
                redirect: 'error', signal: AbortSignal.timeout(10000),
            });
            if (!response.ok || (await response.json()).permissions?.push !== true) return reply(403, { error: 'Потрібне право запису в репозиторій сайту.' });
            return reply(200, await diagnose(env));
        } catch { return reply(502, { error: 'Перевірка тимчасово недоступна. Спробуйте пізніше.' }); }
    };
}
module.exports = { createMailStatus };
