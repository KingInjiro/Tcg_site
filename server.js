const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const publicPath = path.join(__dirname, 'dist'); // we serve from dist

// Custom middleware for case-insensitive static file serving and .htm/.html alias
app.use((req, res, next) => {
    let reqPath = req.path;
    if (reqPath === '/') reqPath = '/index.html';
    
    // Check if the exact file exists
    if (fs.existsSync(path.join(publicPath, reqPath))) {
        return next();
    }
    
    // Fallback: Case-insensitive search and .htm <-> .html
    const dir = path.dirname(reqPath);
    let base = path.basename(reqPath).toLowerCase();
    
    const absDir = path.join(publicPath, dir);
    if (fs.existsSync(absDir)) {
        try {
            const files = fs.readdirSync(absDir);
            let match = files.find(f => f.toLowerCase() === base);
            
            // If not found, try mapping .htm to .html
            if (!match && base.endsWith('.htm')) {
                const baseHtml = base + 'l';
                match = files.find(f => f.toLowerCase() === baseHtml);
            }
            
            if (match) {
                req.url = path.join(dir, match);
            }
        } catch (e) {
            // ignore
        }
    }
    
    next();
});

app.use(express.static(publicPath));

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
