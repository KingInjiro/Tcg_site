(async function () {
    const output = document.getElementById('result');
    try {
        const response = await fetch('/admin/diagnostic.php', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const data = await response.json();
        if (!response.ok || typeof data.php !== 'string' || typeof data.supported !== 'boolean') throw new Error();
        output.textContent = 'PHP ' + data.php + '. ' + (data.supported ? 'Версія входить до підтримуваного діапазону.' : 'Для адмінпанелі потрібна версія 8.2–8.5. Поточну версію не підтримано.') + (location.protocol === 'https:' ? '' : ' Адміністративний запис через HTTP заборонений.');
    } catch { output.textContent = 'Не вдалося підтвердити виконання PHP. Можливі причини: PHP не ввімкнений, файл недоступний або сервер не повернув очікувану відповідь. Публічний статичний сайт не залежить від цієї перевірки.'; }
})();
