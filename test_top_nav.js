const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');
const matched = content.match(/<a href="([^"]+)"[^>]*><img src="\/derived\/[^"]*_GBTN\.GIF"[^>]*alt="([^"]+)"[^>]*><\/a>/gi);
console.log(matched);
