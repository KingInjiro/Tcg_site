const fs = require('fs');
const path = require('path');

const ADDITIONAL_STYLES = `
<style>
  /* Увеличение шрифтов для лучшей читаемости */
  body, p, td, span, div, a {
    font-size: 16px;
    line-height: 1.5;
  }
  font[size="1"] { font-size: 14px; }
  font[size="2"] { font-size: 16px; }
  font[size="3"] { font-size: 18px; }
  
  a { color: #0000ee; }
  a:visited { color: #551a8b; }

  /* Global Layout Redesign */
  body {
    background-image: url('/themes/-1-/background_spring.gif') !important;
    background-repeat: repeat !important;
    background-color: #EBB66C !important;
  }
  body > table {
    max-width: 1000px !important;
    margin: 0 auto !important;
    background-color: #ffffff !important;
    box-shadow: 0 0 15px rgba(0,0,0,0.2);
  }
  
  /* Modern Top Buttons */
  .modern-top-btn {
    display: inline-block;
    padding: 6px 15px;
    margin: 2px;
    background-color: #ECE164;
    color: #000 !important;
    text-decoration: none;
    font-size: 14px;
    font-weight: bold;
    border: 1px solid #D1CEAA;
    border-radius: 4px;
  }
  .modern-top-btn:hover {
    background-color: #D8D6BE;
  }
  
  /* Modern Nav Buttons (Left menu) */
  .modern-nav-btn {
    display: block;
    width: 132px;
    padding: 8px 10px;
    margin-bottom: 5px;
    background-color: #FAF8DD;
    color: #0000ee !important;
    text-decoration: none;
    font-size: 15px;
    font-weight: bold;
    border: 1px solid #D1CEAA;
    border-radius: 4px;
    text-align: center;
  }
  .modern-nav-btn:hover {
    background-color: #D3D2C4;
  }
  
  /* Fix lists */
  ul {
    list-style-image: none !important;
    list-style-type: disc !important;
  }
  
  /* Ad containers */
  .ad-left, .ad-right {
    position: fixed;
    top: 150px;
    width: 160px;
    height: 600px;
    background-color: rgba(255, 255, 255, 0.9);
    border: 2px dashed #ccc;
    text-align: center;
    padding: 10px;
    color: #666;
    font-weight: bold;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ad-left { left: calc(50% - 680px); }
  .ad-right { right: calc(50% - 680px); }
  @media (max-width: 1400px) {
    .ad-left, .ad-right { display: none !important; }
  }
</style>
`;

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

walk('.').forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let oldContent = content;
    
    // 1. Clean previous injected styles to avoid duplication
    content = content.replace(/<style>\s*\/\* Увеличение шрифтов[\s\S]*?<\/style>/, '');
    content = content.replace(/<style>\s*\/\* Увеличение шрифтов[\s\S]*?<\/style>/, '');
    
    // Inject the new styles just before </head>
    content = content.replace(/<\/head>/i, ADDITIONAL_STYLES + '\n</head>');
    
    // 2. Add ad banners right after <body>
    if (!content.includes('ad-left')) {
        content = content.replace(/<body[^>]*>/i, '$&\n<div class="ad-left">Место для рекламы (Л)</div>\n<div class="ad-right">Место для рекламы (П)</div>\n');
    }
    
    // 3. Replace Top Nav Images
    content = content.replace(/<a href="([^"]+)"[^>]*><img src="[^"]*_GBTN\.GIF"[^>]*alt="([^"]+)"[^>]*><\/a>/gi, '<a href="$1" class="modern-top-btn">$2</a>');
    content = content.replace(/<a href="([^"]+)"[^>]*><img src="[^"]*_HBTN(?:_A)?\.GIF"[^>]*alt="([^"]+)"[^>]*><\/a>/gi, '<a href="$1" class="modern-top-btn">$2</a>');
    
    // 4. Replace Left Nav Images
    content = content.replace(/<a href="([^"]+)"[^>]*><img src="[^"]*_VBTN(?:_A)?\.GIF"[^>]*alt="([^"]+)"[^>]*><\/a>/gi, '<a href="$1" class="modern-nav-btn">$2</a>');
    
    // 5. Replace 2009 with 2026 for the date
    content = content.replace(/2009/g, '2026');
    
    if (oldContent !== content) {
        fs.writeFileSync(file, content);
    }
});
console.log('Global redesign applied!');
