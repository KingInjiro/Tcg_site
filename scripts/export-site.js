const path = require('node:path');
const { exportWebsite } = require('../lib/site-export');
try {
    const { filename } = exportWebsite(path.resolve(__dirname, '..'));
    console.log('Готовий архів: exports/' + filename);
    console.log('Розпакуйте його вміст у кореневу папку сайту на хостингу. Інструкція: README.md.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
