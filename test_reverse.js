const fs = require('fs');

function getBaseName(href) {
    if (href.toLowerCase() === 'index.html' || href.toLowerCase() === 'index.htm') {
        return 'HOME';
    }
    return href.replace(/\.html?$/i, '.HTM').toUpperCase();
}

let testHtml = `<a href="index.html" class="modern-top-btn">Основная</a>
<a href="news.html" class="modern-nav-btn">Новости</a>`;

testHtml = testHtml.replace(/<a href="([^"]+)" class="modern-top-btn">([^<]+)<\/a>/gi, (match, href, alt) => {
    let base = getBaseName(href);
    // Is it GBTN or HBTN? In root index.html it's GBTN for main links
    // But let's just check if GBTN exists, otherwise use HBTN
    let src = `/derived/${base}_CMP_-1-010_GBTN.GIF`;
    if (!fs.existsSync(`derived/${base}_CMP_-1-010_GBTN.GIF`)) {
        src = `/derived/${base}_CMP_-1-010_HBTN.GIF`;
    }
    return `<a href="${href}"><img src="${src}" width="90" height="25" border="0" alt="${alt}" align="middle"></a>`;
});

testHtml = testHtml.replace(/<a href="([^"]+)" class="modern-nav-btn">([^<]+)<\/a>/gi, (match, href, alt) => {
    let base = getBaseName(href);
    let src = `/derived/${base}_CMP_-1-010_VBTN.GIF`;
    return `<a href="${href}"><img src="${src}" width="132" height="18" border="0" alt="${alt}" class="left-nav-icon"></a>`;
});

console.log(testHtml);
