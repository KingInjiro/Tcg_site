const fs = require('node:fs');
const path = require('node:path');
const { publicEntries } = require('../lib/site-files');

function build(root = path.resolve(__dirname, '..')) {
    const output = path.join(root, 'dist');
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    for (const name of publicEntries(root)) {
        fs.cpSync(path.join(root, name), path.join(output, name), {
            recursive: true,
            filter: source => !fs.lstatSync(source).isSymbolicLink() && !path.basename(source).startsWith('.'),
        });
    }
    // Include the pinned CMS bundle and its lazy-loaded chunks on this site.
    const cms = path.dirname(require.resolve('decap-cms'));
    const vendor = path.join(output, 'admin', 'vendor');
    fs.mkdirSync(vendor, { recursive: true });
    for (const name of fs.readdirSync(cms)) {
        if (name.endsWith('.js') || name.endsWith('.css') || name.endsWith('.LICENSE.txt')) {
            fs.copyFileSync(path.join(cms, name), path.join(vendor, name));
        }
    }
    console.log('Website built in dist/');
    return output;
}

if (require.main === module) build();
module.exports = { build };
