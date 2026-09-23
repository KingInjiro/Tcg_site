(function () {
    if (!window.CMS) {
        window.showCMSError('Файли редактора недоступні. Перезавантажте сторінку.');
        return;
    }
    window.CMS.registerCustomFormat('raw', 'html', window.TCGRawFormat);
    window.CMS.init({ config: {
        backend: { base_url: window.location.origin, auth_endpoint: 'api/auth' },
        // Local filesystem editing is an explicit opt-in on loopback hosts only.
        local_backend: ['localhost', '127.0.0.1'].includes(window.location.hostname)
            && new URLSearchParams(window.location.search).get('local') === 'true'
            ? { url: 'http://127.0.0.1:8081/api/v1' } : false,
    } });
    document.getElementById('cms-status').hidden = true;
})();
