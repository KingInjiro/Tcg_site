const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// replace meta div
html = html.replace(/<div class="meta">[\s\S]*?<\/div>/, '<div class="meta"><iframe src="https://news.meta.ua/" width="100%" height="300" style="border:none;"></iframe></div>');

// add leading slash to all image src
html = html.replace(/src="(?!\/|http|data:)([^"]+)"/g, 'src="/$1"');
html = html.replace(/src='(?!\/|http|data:)([^']+)'/g, "src='/$1'");

// replace _derived with derived
html = html.replace(/_derived\//g, 'derived/');

// replace _themes with themes
html = html.replace(/_themes\//g, 'themes/');

// replace logo src
html = html.replace(/src="\/images\/undercon\.gif"/g, 'src="/images/tcg_log3.gif"');

// replace .gif to .GIF inside derived/
html = html.replace(/(src="\/derived\/[^"]+)\.gif"/gi, '$1.GIF"');

// insert manifest and sw
if (!html.includes('<link rel="manifest"')) {
  html = html.replace(/<\/head>/i, '  <link rel="manifest" href="/manifest.json">\n</head>');
}
if (!html.includes('serviceWorker')) {
  html = html.replace(/<\/head>/i, '  <script>\n    if ("serviceWorker" in navigator) {\n      navigator.serviceWorker.register("/sw.js");\n    }\n  </script>\n</head>');
}

fs.writeFileSync('public/index.html', html);
