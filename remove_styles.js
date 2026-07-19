const fs = require('fs');
const path = require('path');

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
    
    // Remove the injected <style> block completely
    content = content.replace(/<style>[\s\S]*?\/\* Увеличение шрифтов[\s\S]*?<\/style>/, '');
    
    if (oldContent !== content) {
        fs.writeFileSync(file, content);
    }
});
console.log('Injected styles removed.');
