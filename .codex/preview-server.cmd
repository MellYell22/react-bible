@echo off
cd /d "%~dp0\.."
set NODE_ENV=production
"C:\Users\Alissa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" -e "import('./dist/server.js')" >> ".codex\preview-server.out.log" 2>> ".codex\preview-server.err.log"
