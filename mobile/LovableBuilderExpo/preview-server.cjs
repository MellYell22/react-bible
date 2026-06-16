const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'dist-web');
const preferredPort = Number(process.env.PORT || 8081);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function createServer(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      send(res, 200, 'ok');
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const safePath = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([/\\])+/, '');
    const filePath = path.join(root, safePath);

    if (!filePath.startsWith(root)) {
      send(res, 403, 'Forbidden');
      return;
    }

    fs.readFile(filePath, (error, body) => {
      if (error) {
        fs.readFile(path.join(root, 'index.html'), (fallbackError, fallbackBody) => {
          if (fallbackError) send(res, 404, 'Not found');
          else send(res, 200, fallbackBody, types['.html']);
        });
        return;
      }

      send(res, 200, body, types[path.extname(filePath)] || 'application/octet-stream');
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < preferredPort + 20) {
      createServer(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Lovable Builder Expo preview running at http://localhost:${port}`);
  });
}

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('Missing dist-web/index.html. Run npm run export:web first.');
  process.exit(1);
}

createServer(preferredPort);
