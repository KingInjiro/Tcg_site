window.CMS_MANUAL_INIT = true;
window.showCMSError = function (message) {
    const status = document.getElementById('cms-status');
    if (status) {
        status.hidden = false;
        status.setAttribute('role', 'alert');
        status.textContent = 'Не вдалося відкрити редактор. ' + message;
    }
};
window.addEventListener('error', function (event) {
    window.showCMSError(event.message || 'Перевірте з’єднання та перезавантажте сторінку.');
});
window.addEventListener('unhandledrejection', function (event) {
    window.showCMSError(event.reason && event.reason.message || 'Помилка завантаження.');
});
