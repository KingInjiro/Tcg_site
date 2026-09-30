(function () {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) return;
    const url = new URL(canonical.getAttribute('href'), location.origin);
    if (url.origin === location.origin) location.replace(url.pathname + location.search + location.hash);
})();
