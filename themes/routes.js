(function (root, factory) {
    const routes = factory();
    if (typeof module === 'object' && module.exports) module.exports = routes;
    else root.TCGRoutes = routes;
})(typeof window === 'object' ? window : this, function () {
    'use strict';
    function pageURL(file) {
        const stem = file.replace(/^\/+/, '').replace(/\.html?$/i, '');
        return /^index$/i.test(stem) ? '/' : '/' + stem.split('/').map(encodeURIComponent).join('/') + '/';
    }
    function outputFile(file) {
        const url = pageURL(file);
        return decodeURIComponent(url.slice(1)) + 'index.html';
    }
    return { pageURL, outputFile };
});
