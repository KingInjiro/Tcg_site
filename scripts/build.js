const fs = require('node:fs');
const path = require('node:path');
const { publicEntries, isPublicContent } = require('../lib/site-files');
const { pageFiles, cleanWebsite } = require('../lib/site-routes');

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
    const pages = new Map(pageFiles(root).map(name => [name, fs.readFileSync(path.join(root, name))]));
    for (const [name, content] of cleanWebsite(pages)) {
        fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
        fs.writeFileSync(path.join(output, name), content);
    }
    // The visual editor is the only editing engine shipped with the site.
    const vendor = path.join(output, 'admin', 'vendor');
    fs.mkdirSync(vendor, { recursive: true });
    const grapes = path.dirname(require.resolve('grapesjs'));
    fs.copyFileSync(path.join(grapes, 'grapes.min.js'), path.join(vendor, 'grapes.min.js'));
    fs.copyFileSync(path.join(grapes, 'css', 'grapes.min.css'), path.join(vendor, 'grapes.min.css'));
    fs.copyFileSync(path.join(grapes, '..', 'LICENSE'), path.join(vendor, 'grapes.LICENSE.txt'));
    console.log('Website built in dist/');
    return output;
}

if (require.main === module) build();
module.exports = { build };
