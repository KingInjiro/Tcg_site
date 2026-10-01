const fs = require('node:fs');
const path = require('node:path');
const { publicEntries, isPublicContent } = require('../lib/site-files');

function build(root = path.resolve(__dirname, '..')) {
    const output = path.join(root, 'dist');
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    for (const name of publicEntries(root)) {
        fs.cpSync(path.join(root, name), path.join(output, name), {
            recursive: true,
            filter: source => !fs.lstatSync(source).isSymbolicLink() && !path.basename(source).startsWith('.') && isPublicContent(source),
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
    const grapes = path.dirname(require.resolve('grapesjs'));
    fs.copyFileSync(path.join(grapes, 'grapes.min.js'), path.join(vendor, 'grapes.min.js'));
    fs.copyFileSync(path.join(grapes, 'css', 'grapes.min.css'), path.join(vendor, 'grapes.min.css'));
    fs.copyFileSync(path.join(grapes, '..', 'LICENSE'), path.join(vendor, 'grapes.LICENSE.txt'));
    console.log('Website built in dist/');
    return output;
}

if (require.main === module) build();
module.exports = { build };
