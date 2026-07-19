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
    
    // Restore mangled widget max-height
    content = content.replace(/max-\s*overflow-y/g, 'max-height: 500px; overflow-y');
    
    // Restore left rail height
    content = content.replace(/style="width: 136px; margin-right: 7px;"/g, 'style="height: 284px; width: 136px; margin-right: 7px;"');
    
    // Restore top p height
    content = content.replace(/style="margin-top: 12px; "/g, 'style="margin-top: 12px; height: 101px;"');
    
    if (oldContent !== content) {
        fs.writeFileSync(file, content);
    }
});
console.log('Restored mangled heights.');
