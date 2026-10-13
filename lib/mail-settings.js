'use strict';
const email = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/u;
function missingSettings(env) {
    const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].filter(key => !env[key]);
    for (const key of ['CONTACT_FROM', 'CONTACT_TO']) if (!email.test(env[key] || '')) missing.push(key);
    if (![465, 587].includes(Number(env.SMTP_PORT || 465))) missing.push('SMTP_PORT');
    if (env.VERCEL && !env.CONTACT_TOKEN_SECRET) missing.push('CONTACT_TOKEN_SECRET');
    return missing;
}
function smtpOptions(env) {
    const port = Number(env.SMTP_PORT || 465);
    if (![465, 587].includes(port)) throw new Error('SMTP port');
    return { host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 10000,
        greetingTimeout: 10000, socketTimeout: 15000, disableFileAccess: true, disableUrlAccess: true };
}
async function checkMail(env = process.env, makeTransport = require('nodemailer').createTransport) {
    const missing = missingSettings(env);
    if (missing.length) return { ok: false, stage: 'configuration', missing, message: 'Перевірте налаштування: ' + missing.join(', ') + '.' };
    let transport;
    try {
        transport = makeTransport(smtpOptions(env));
        await transport.verify();
        return { ok: true, stage: 'connection', message: 'Захищене SMTP-з’єднання та вхід працюють. Листів не надсилали; доставку у вхідні це не підтверджує.' };
    } catch (error) {
        return { ok: false, stage: 'connection', message: error.code === 'EAUTH' ? 'Поштовий сервер відхилив облікові дані. Перевірте SMTP_USER та SMTP_PASSWORD.' : 'Не вдалося встановити захищене з’єднання з поштовим сервером. Перевірте SMTP_HOST, SMTP_PORT та доступність сервера.' };
    } finally { transport?.close(); }
}
module.exports = { missingSettings, smtpOptions, checkMail };
