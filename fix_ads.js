const fs = require('fs');
const path = require('path');

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

const adHtml = `
<div class="ad-left">Место для рекламы (Л)</div>
<div class="ad-right">Место для рекламы (П)</div>
`;

walk('.').forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // First remove any existing ads we might have injected poorly
    content = content.replace(/<div class="ad-left">[^<]*<\/div>\n<div class="ad-right">[^<]*<\/div>\n/g, '');
    
    // Now inject right before </body>, or if not found, at the end of file
    if (content.includes('</body>')) {
        content = content.replace('</body>', adHtml + '\n</body>');
    } else {
        content += adHtml;
    }
    
    fs.writeFileSync(file, content);
});
console.log('Ads fixed!');
