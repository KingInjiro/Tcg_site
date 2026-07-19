const fs = require('fs');
const path = require('path');

const HEAD_TO_INJECT = `
<meta http-equiv="Content-Language" content="ru">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<link rel="stylesheet" type="text/css" href="/themes/-1-/-1-1011-1251.css">
<!--mstheme--><link rel="stylesheet" type="text/css" href="/themes/-1-/-1-1011-1251.css">
<meta name="Microsoft Theme" content="-1- 1011, default">
<meta name="Microsoft Border" content="tlb, default">
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
</style>
`;

function walk(dir) {
    let results = [];
    fs.readdirSync(dir).forEach(file => {
        if (['node_modules', 'dist', '.git', 'admin'].includes(file)) return;
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            results = results.concat(walk(fullPath));
        } else if (file.endsWith('.html')) {
            results.push(fullPath);
        }
    });
    return results;
}

walk('.').forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let oldContent = content;
    
    // For index.html, we need to restore the broken head
    if (file === 'index.html' || file === 'index.htm') {
        if (!content.includes('Microsoft Theme')) {
            // Reconstruct the head
            content = content.replace(/<head>([\s\S]*?)<\/head>/i, '<head>$1' + HEAD_TO_INJECT + '\n<title>Tornado Computers Group</title>\n</head>');
        } else {
            // Just inject our safe styles before </head> if not there
            if (!content.includes('Увеличение шрифтов')) {
                 content = content.replace('</head>', '<style>\n  /* Увеличение шрифтов для лучшей читаемости */\n  body, p, td, span, div, a { font-size: 16px; line-height: 1.5; }\n  font[size="1"] { font-size: 14px; }\n  font[size="2"] { font-size: 16px; }\n  font[size="3"] { font-size: 18px; }\n  a { color: #0000ee; }\n  a:visited { color: #551a8b; }\n</style>\n</head>');
            }
        }
    } else {
        // For other files, inject safe styles
        if (!content.includes('Увеличение шрифтов')) {
             content = content.replace('</head>', '<style>\n  /* Увеличение шрифтов для лучшей читаемости */\n  body, p, td, span, div, a { font-size: 16px; line-height: 1.5; }\n  font[size="1"] { font-size: 14px; }\n  font[size="2"] { font-size: 16px; }\n  font[size="3"] { font-size: 18px; }\n  a { color: #0000ee; }\n  a:visited { color: #551a8b; }\n</style>\n</head>');
        }
    }
    
    if (oldContent !== content) {
        fs.writeFileSync(file, content);
    }
});
console.log('Fixed HTML files.');
