// This unauthenticated file editor must never listen on a public interface.
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
process.env.PORT = '8081';
process.env.BIND_HOST = '127.0.0.1';
process.env.MODE = 'fs';
// Use Decap's localhost-only CORS policy.
delete process.env.ORIGIN;
require('decap-server');
