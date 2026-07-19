const fs = require('fs');
const path = require('path');

function getBaseName(href) {
    if (href.toLowerCase() === 'index.html' || href.toLowerCase() === 'index.htm') return 'HOME';
    if (href.toLowerCase() === 'listpage_www_tcg_com_ua.html') return 'LISTPAGE_WWW_TCG_COM_UA.HTM';
    return href.replace(/\.html?$/i, '.HTM').toUpperCase();
}

function walk(dir) {
    let results = [];
    fs.readdirSync(dir).forEach(file => {
        if (['node_modules', 'dist', '.git', 'admin'].includes(file)) return;
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            results = results.concat(walk(fullPath));
        } else if (file.endsWith('.html') || file.endsWith('.htm')) {
            results.push(fullPath);
        }
    });
    return results;
}

const NEW_SAFE_STYLES = `
<style>
  /* Safe font increase */
  body, p, td, span, div, a, font, li {
    font-size: 16px;
    line-height: 1.5;
  }
  font[size="1"] { font-size: 14px; }
  font[size="2"] { font-size: 16px; }
  font[size="3"] { font-size: 18px; }
  
  .left-nav-icon {
    width: 165px !important; /* increased from 132px */
    height: auto !important;
    margin-bottom: 5px;
  }
  .top-nav-icon {
    width: 100px !important; /* slightly increased from 90 */
    height: auto !important;
  }
  
  /* Ad containers */
  .ad-left, .ad-right {
    position: fixed;
    top: 150px;
    width: 160px;
    height: 600px;
    background-color: transparent;
    border: 1px dashed #ccc;
    text-align: center;
    padding: 10px;
    color: #666;
    font-size: 12px;
    z-index: 100;
  }
  .ad-left { left: 5px; }
  .ad-right { right: 5px; }
  @media (max-width: 1300px) {
    .ad-left, .ad-right { display: none !important; }
  }
</style>
`;

walk('.').forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let oldContent = content;
    
    // 1. Remove the bad CSS block
    content = content.replace(/<style>\s*\/\* Увеличение шрифтов[\s\S]*?<\/style>/g, '');
    
    // 2. Inject safe CSS
    content = content.replace(/<\/head>/i, NEW_SAFE_STYLES + '\n</head>');
    
    // 3. Restore Top Nav Images
    content = content.replace(/<a href="([^"]+)" class="modern-top-btn">([^<]+)<\/a>/gi, (match, href, alt) => {
        let base = getBaseName(href);
        let src = `/derived/${base}_CMP_-1-010_GBTN.GIF`;
        if (!fs.existsSync(path.join(__dirname, 'derived', `${base}_CMP_-1-010_GBTN.GIF`))) {
            src = `/derived/${base}_CMP_-1-010_HBTN.GIF`;
        }
        return `<a href="${href}"><img src="${src}" border="0" alt="${alt}" align="middle" class="top-nav-icon"></a>`;
    });
    
    // 4. Restore Left Nav Images
    content = content.replace(/<a href="([^"]+)" class="modern-nav-btn">([^<]+)<\/a>/gi, (match, href, alt) => {
        let base = getBaseName(href);
        let src = `/derived/${base}_CMP_-1-010_VBTN.GIF`;
        return `<a href="${href}"><img src="${src}" border="0" alt="${alt}" class="left-nav-icon"></a>`;
    });
    
    if (oldContent !== content) {
        fs.writeFileSync(file, content);
    }
});
console.log('Restoration applied!');
