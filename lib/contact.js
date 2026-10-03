const crypto = require('node:crypto');
const labels = { Name: 'Имя', Title: 'Должность', Company: 'Организация', Telephone: 'Телефон', Phone: 'Телефон', FAX: 'Факс', Email: 'Эл. почта', Address: 'Адрес / текст запроса', 'Заметки': 'Заметки', Category: 'Категория', SendProductLiterature: 'Литература о продукте', SendServiceLiterature: 'Литература об услуге', SendCompanyLiterature: 'Литература об организации', SalesContactRequested: 'Связь с продавцом' };
const pages = new Set(['/feedback/', '/1CPrice/', '/price01/', '/price1C/']);
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/u;
function createContact({ env = process.env, sendMail, now = Date.now } = {}) {
    const secret = env.CONTACT_TOKEN_SECRET || crypto.randomBytes(32), attempts = new Map();
    let transport;
    function token(origin, time) { return time + '.' + crypto.createHmac('sha256', secret).update(origin + '\n' + time).digest('hex'); }
    function validToken(value, origin) {
        if (typeof value !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(value)) return false;
        const time = Number(value.split('.')[0]);
        return now() >= time && now() - time < 3600000 && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(token(origin, time)));
    }
    function originFor(req) {
        let origin = req.headers.origin || '';
        if (!origin && req.method === 'GET') { try { origin = new URL(req.headers.referer).origin; } catch { return null; } }
        let url; try { url = new URL(origin); } catch { return null; }
        if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return null;
        const allowed = (env.CONTACT_ALLOWED_ORIGINS || env.CMS_ORIGIN || '').split(',').map(s => s.trim());
        return allowed.includes(origin) || url.host === req.headers.host ? origin : null;
    }
    function json(res, status, data) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); }
    return async function contact(req, res) {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Vary', 'Origin');
        const origin = originFor(req);
        if (!origin) return json(res, 403, { error: 'Запрос с этого адреса запрещён.' });
        res.setHeader('Access-Control-Allow-Origin', origin);
        if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-TCG-Token'); res.statusCode = 204; return res.end(); }
        if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, OPTIONS'); return json(res, 405, { error: 'Метод не поддерживается.' }); }
        if ((!sendMail && !(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && emailPattern.test(env.CONTACT_FROM || '') && emailPattern.test(env.CONTACT_TO || ''))) || (env.VERCEL && !env.CONTACT_TOKEN_SECRET)) return json(res, 503, { error: 'Отправка через сайт пока недоступна. Данные остались в форме. Свяжитесь с нами по контактам на сайте.' });
        if (req.method === 'GET') return json(res, 200, { token: token(origin, now()) });
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Неподдерживаемый формат запроса.' });
        if (!validToken(req.headers['x-tcg-token'], origin)) return json(res, 403, { error: 'Срок действия формы истёк. Попробуйте ещё раз.' });
        let body = req.body;
        try {
            if (body === undefined) {
                const chunks = []; let length = 0;
                for await (const chunk of req) { length += chunk.length; if (length > 16384) return json(res, 413, { error: 'Сообщение слишком большое.' }); chunks.push(chunk); }
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } else if (typeof body === 'string' || Buffer.isBuffer(body)) body = JSON.parse(String(body));
            if (!body || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 16384) throw new Error('body');
        } catch { return json(res, 400, { error: 'Не удалось прочитать сообщение.' }); }
        if (body.website) return json(res, 400, { error: 'Не удалось отправить сообщение.' });
        const fields = body.fields;
        if (!pages.has(body.page) || !fields || typeof fields !== 'object' || Array.isArray(fields)) return json(res, 400, { error: 'Некорректная форма.' });
        const lines = [];
        for (const [name, value] of Object.entries(fields)) {
            if (!Object.hasOwn(labels, name) || typeof value !== 'string' || value.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return json(res, 400, { error: 'Некорректное значение поля.' });
            if (value.trim()) lines.push(labels[name] + ': ' + value.trim());
        }
        if (!fields.Name?.trim() || !emailPattern.test(fields.Email || '') || fields.Email.length > 254) return json(res, 400, { error: 'Укажите имя и корректный адрес электронной почты.' });
        const ip = req.socket?.remoteAddress || 'unknown';
        const ipKey = 'ip:' + ip, emailKey = 'email:' + fields.Email.toLowerCase();
        for (const [key, record] of attempts) if (now() - record.time >= 600000) attempts.delete(key);
        const ipRecord = attempts.get(ipKey), emailRecord = attempts.get(emailKey);
        if ((ipRecord?.count || 0) >= 5 || (emailRecord && now() - emailRecord.time < 60000) || attempts.size >= 2000) return json(res, 429, { error: 'Лимит отправки исчерпан. Попробуйте позже.' });
        attempts.set(ipKey, { time: ipRecord?.time || now(), count: (ipRecord?.count || 0) + 1 });
        attempts.set(emailKey, { time: now(), count: 1 });
        try {
            if (!sendMail && !transport) {
                const port = Number(env.SMTP_PORT || 465); if (![465, 587].includes(port)) throw new Error('SMTP port');
                transport = require('nodemailer').createTransport({ host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
                    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
                    disableFileAccess: true, disableUrlAccess: true });
            }
            const message = { from: env.CONTACT_FROM, to: env.CONTACT_TO, replyTo: fields.Email, subject: 'TCG: обращение с ' + body.page,
                text: 'Страница: ' + body.page + '\n\n' + lines.join('\n'), disableFileAccess: true, disableUrlAccess: true };
            const result = await (sendMail ? sendMail(message) : transport.sendMail(message));
            if (!result?.accepted?.length) throw new Error('recipient rejected');
            return json(res, 200, { ok: true, message: 'Сообщение принято почтовым сервером. Спасибо за обращение.' });
        } catch { return json(res, 502, { error: 'Не удалось подтвердить отправку. Данные остались в форме. Повторите позже или воспользуйтесь контактами на сайте.' }); }
    };
}
module.exports = { createContact };
