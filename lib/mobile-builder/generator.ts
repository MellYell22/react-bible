import type { BuilderFile, GeneratedWebApp } from './types';

const ACCENT_SETS = [
  { ink: '#101828', soft: '#f6f8fb', accent: '#18a0a6', accent2: '#ef476f', wash: '#e8fbfb' },
  { ink: '#182230', soft: '#f7f6f2', accent: '#2f80ed', accent2: '#16a34a', wash: '#eaf2ff' },
  { ink: '#161616', soft: '#f8f5ef', accent: '#d97706', accent2: '#0f766e', wash: '#fff4df' },
  { ink: '#172033', soft: '#f4f7f8', accent: '#7c3aed', accent2: '#f97316', wash: '#f1ecff' },
];

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36).padStart(7, '0');
}

function sanitizeTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/build|create|make|app|website|web app|platform/gi, ' ')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = (cleaned || 'Launch Studio')
    .split(' ')
    .filter(Boolean)
    .slice(0, 4);

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function inferAudience(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('coach') || lower.includes('fitness') || lower.includes('wellness')) return 'members';
  if (lower.includes('restaurant') || lower.includes('food') || lower.includes('coffee')) return 'guests';
  if (lower.includes('store') || lower.includes('shop') || lower.includes('market')) return 'customers';
  if (lower.includes('course') || lower.includes('school') || lower.includes('learn')) return 'students';
  if (lower.includes('crm') || lower.includes('sales') || lower.includes('client')) return 'teams';
  return 'users';
}

function inferOffer(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('dashboard') || lower.includes('analytics')) return 'live operating dashboard';
  if (lower.includes('booking') || lower.includes('appointment')) return 'booking workspace';
  if (lower.includes('store') || lower.includes('shop')) return 'conversion-ready storefront';
  if (lower.includes('portfolio')) return 'polished portfolio system';
  if (lower.includes('community')) return 'member community hub';
  return 'launch-ready web app';
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildAppJs(config: Record<string, unknown>): string {
  return `const config = ${json(config)};

const storageKey = 'lovable-builder-' + config.slug;
const initialState = {
  items: [
    { title: 'Shape the first offer', owner: 'Product', stage: 'Today', score: 92 },
    { title: 'Invite early ${config.audience}', owner: 'Growth', stage: 'Next', score: 76 },
    { title: 'Review launch checklist', owner: 'Ops', stage: 'Ready', score: 84 }
  ],
  activity: ['App generated from prompt', 'Responsive shell prepared', 'Interactive data saved locally']
};

const state = JSON.parse(localStorage.getItem(storageKey) || 'null') || initialState;

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function renderItems() {
  const list = document.querySelector('[data-items]');
  list.innerHTML = state.items.map((item, index) => \`
    <article class="item-card">
      <div>
        <p class="eyebrow">\${item.stage}</p>
        <h3>\${item.title}</h3>
        <span>\${item.owner}</span>
      </div>
      <button aria-label="Improve score" data-boost="\${index}">\${item.score}</button>
    </article>
  \`).join('');
}

function renderActivity() {
  const feed = document.querySelector('[data-activity]');
  feed.innerHTML = state.activity.slice(-5).reverse().map((line) => \`<li>\${line}</li>\`).join('');
}

function renderMetrics() {
  const avg = Math.round(state.items.reduce((sum, item) => sum + item.score, 0) / state.items.length);
  document.querySelector('[data-score]').textContent = avg + '%';
  document.querySelector('[data-count]').textContent = state.items.length;
}

function render() {
  renderItems();
  renderActivity();
  renderMetrics();
}

document.querySelector('[data-add]').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.namedItem('item');
  const value = input.value.trim();
  if (!value) return;
  state.items.unshift({ title: value, owner: 'You', stage: 'New', score: 71 });
  state.activity.push('Added ' + value);
  input.value = '';
  save();
  render();
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-boost]');
  if (!target) return;
  const index = Number(target.dataset.boost);
  state.items[index].score = Math.min(99, state.items[index].score + 3);
  state.activity.push('Improved ' + state.items[index].title);
  save();
  render();
});

render();
`;
}

function buildStyles(colors: (typeof ACCENT_SETS)[number]): string {
  return `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: ${colors.soft};
  color: ${colors.ink};
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    linear-gradient(130deg, ${colors.wash} 0%, transparent 38%),
    linear-gradient(180deg, #ffffff 0%, ${colors.soft} 100%);
}

button,
input {
  font: inherit;
}

.app {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 28px 0 32px;
}

.topbar,
.hero,
.workspace,
.footer {
  display: grid;
  gap: 16px;
}

.topbar {
  grid-template-columns: 1fr auto;
  align-items: center;
  padding: 10px 0 20px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 900;
}

.mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: ${colors.ink};
  color: white;
}

.pill {
  border: 1px solid rgba(16, 24, 40, 0.12);
  border-radius: 999px;
  padding: 9px 14px;
  background: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  font-weight: 800;
}

.hero {
  grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr);
  align-items: stretch;
  min-height: 420px;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(24px, 6vw, 70px) 0;
}

.eyebrow {
  margin: 0 0 8px;
  color: ${colors.accent};
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  max-width: 760px;
  margin-bottom: 18px;
  font-size: clamp(42px, 7vw, 86px);
  line-height: 0.94;
  letter-spacing: 0;
}

.lede {
  max-width: 640px;
  color: rgba(16, 24, 40, 0.72);
  font-size: 19px;
  line-height: 1.55;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.primary,
.secondary,
.item-card button {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 900;
}

.primary {
  background: ${colors.ink};
  color: #fff;
  padding: 14px 18px;
}

.secondary {
  background: #fff;
  color: ${colors.ink};
  padding: 14px 18px;
  border: 1px solid rgba(16, 24, 40, 0.12);
}

.panel {
  align-self: center;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(16, 24, 40, 0.11);
  border-radius: 8px;
  box-shadow: 0 24px 80px rgba(16, 24, 40, 0.12);
  padding: 18px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  border-radius: 8px;
  background: ${colors.wash};
  padding: 16px;
}

.metric strong {
  display: block;
  font-size: 34px;
}

.workspace {
  grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
  margin-top: 22px;
}

.item-card,
.feed,
.quick-add {
  background: #fff;
  border: 1px solid rgba(16, 24, 40, 0.1);
  border-radius: 8px;
  padding: 16px;
}

.item-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
  margin-bottom: 12px;
}

.item-card h3 {
  margin-bottom: 5px;
}

.item-card span {
  color: rgba(16, 24, 40, 0.58);
  font-size: 14px;
  font-weight: 700;
}

.item-card button {
  width: 54px;
  height: 54px;
  background: ${colors.accent2};
  color: #fff;
}

.quick-add {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  margin-bottom: 14px;
}

.quick-add input {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(16, 24, 40, 0.12);
  border-radius: 8px;
  padding: 13px 14px;
}

.feed ul {
  margin: 0;
  padding-left: 18px;
  color: rgba(16, 24, 40, 0.7);
}

.footer {
  margin-top: 28px;
  color: rgba(16, 24, 40, 0.55);
  font-size: 13px;
}

@media (max-width: 780px) {
  .hero,
  .workspace,
  .topbar {
    grid-template-columns: 1fr;
  }

  .hero-copy {
    padding-bottom: 8px;
  }

  .quick-add {
    grid-template-columns: 1fr;
  }
}
`;
}

export function composeInlinePreview(files: BuilderFile[]): string {
  const html = files.find((file) => file.path === 'index.html')?.content ?? '';
  const css = files.find((file) => file.path === 'styles.css')?.content ?? '';
  const js = files.find((file) => file.path === 'app.js')?.content ?? '';

  return html
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css}</style>`)
    .replace('<script type="module" src="./app.js"></script>', `<script>${js}</script>`);
}

export function generateWebApp(promptInput: string, styleInput?: string): GeneratedWebApp {
  const prompt = promptInput.trim() || 'A polished web app for launching a new idea';
  const id = `build-${stableId(`${prompt}:${Date.now()}`)}`;
  const title = sanitizeTitle(prompt);
  const audience = inferAudience(prompt);
  const offer = inferOffer(prompt);
  const colors = ACCENT_SETS[stableId(prompt).charCodeAt(0) % ACCENT_SETS.length];
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'launch-studio';
  const style = typeof styleInput === 'string' && styleInput.trim() ? styleInput.trim() : 'clean mobile-first product UI';
  const summary = `${title} is a ${offer} for ${audience}, generated from your mobile prompt.`;
  const config = { title, audience, offer, slug, style };

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <main class="app">
      <header class="topbar">
        <div class="brand"><span class="mark">${cssString(title.charAt(0) || 'A')}</span><span>${title}</span></div>
        <div class="pill">${offer}</div>
      </header>

      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Generated mobile build</p>
          <h1>${title}</h1>
          <p class="lede">${summary} The layout is responsive, editable, and ready for a real product pass.</p>
          <div class="actions">
            <button class="primary">Open workspace</button>
            <button class="secondary">Review plan</button>
          </div>
        </div>

        <aside class="panel" aria-label="Launch metrics">
          <div class="metric-grid">
            <div class="metric"><span>Readiness</span><strong data-score>0%</strong></div>
            <div class="metric"><span>Tracks</span><strong data-count>0</strong></div>
          </div>
          <form class="quick-add" data-add>
            <input name="item" placeholder="Add a launch task" aria-label="Add a launch task">
            <button class="primary" type="submit">Add</button>
          </form>
          <section class="feed">
            <p class="eyebrow">Activity</p>
            <ul data-activity></ul>
          </section>
        </aside>
      </section>

      <section class="workspace" aria-label="Workspace">
        <div data-items></div>
        <aside class="panel">
          <p class="eyebrow">Prompt</p>
          <h2>${title} command center</h2>
          <p>${prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </aside>
      </section>

      <footer class="footer">Created by AA Designs</footer>
    </main>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`;

  const files: BuilderFile[] = [
    { path: 'index.html', language: 'html', content: indexHtml },
    { path: 'styles.css', language: 'css', content: buildStyles(colors) },
    { path: 'app.js', language: 'javascript', content: buildAppJs(config) },
    {
      path: 'server.mjs',
      language: 'javascript',
      content: `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const safePath = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\\\])+/, '');
  const filePath = join(root, safePath);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': types[extname(filePath)] || 'text/plain; charset=utf-8' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(5173, '0.0.0.0', () => {
  console.log('Preview running on http://0.0.0.0:5173');
});
`,
    },
    {
      path: 'package.json',
      language: 'json',
      content: `${json({ scripts: { start: 'node server.mjs' }, type: 'module', private: true })}\n`,
    },
    {
      path: 'README.md',
      language: 'markdown',
      content: `# ${title}\n\n${summary}\n\nGenerated from:\n\n> ${prompt}\n\nRun locally with:\n\n\`\`\`bash\nnode server.mjs\n\`\`\`\n`,
    },
  ];

  return {
    id,
    name: title,
    prompt,
    stack: 'Static HTML, CSS, JavaScript, Node preview server',
    files,
    previewHtml: composeInlinePreview(files),
    summary,
  };
}
