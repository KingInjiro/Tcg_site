/* A plain static host can serve index.html without server rewrite rules. */
(function () {
    const canonical = document.querySelector('link[data-tcg-canonical]');
    if (!canonical || !/^https?:$/.test(location.protocol)) return;
    const url = new URL(canonical.getAttribute('href'), location.href);
    if (url.origin === location.origin && /\.html?$/i.test(location.pathname)) {
        location.replace(url.pathname + location.search + location.hash);
    }
})();
