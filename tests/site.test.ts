import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { exportSite, renderSite, seedFiles } from '../server/site.ts';
import type { Integration } from '../shared/types.ts';

const integration: Integration = { id: 'analytics', name: 'Test analytics', type: 'script', enabled: true, endpoint: 'https://analytics.example/script.js', script: 'window.integrationWasLoaded=true;' };

test('preview renders real content, selection bridge, and non-submitting forms', () => {
  const html = renderSite(seedFiles(), { preview: true, integrations: [integration] });
  assert.match(html, /Пространство, в котором вы/);
  assert.match(html, /data-section-id="home"/);
  assert.match(html, /data-forma-preview="true"/);
  assert.match(html, /forma:select/);
  assert.match(html, /http:\/\/127\.0\.0\.1:4310/);
  assert.doesNotMatch(html, /integrationWasLoaded|analytics\.example/);
});

test('published site includes only enabled browser integrations and escaped form token', () => {
  const html = renderSite(seedFiles(), { preview: false, formToken: 'a"<b', integrations: [integration, { ...integration, id: 'disabled', enabled: false, script: 'disabledIntegration()' }] });
  assert.match(html, /name="_formaToken" value="a&quot;&lt;b"/);
  assert.match(html, /integrationWasLoaded/);
  assert.doesNotMatch(html, /forma:select|disabledIntegration/);
  assert.match(html, /action="\/forms\/contact"/);
});

test('content cannot escape attributes; arbitrary source script cannot prematurely close its HTML wrapper', () => {
  const files = seedFiles();
  const content = JSON.parse(files['content.json']);
  content.title = '</title><script>titleAttack()</script>';
  content.sections[0].buttonUrl = 'javascript:alert(1)';
  files['content.json'] = JSON.stringify(content);
  files['script.js'] = 'window.example = "</script><script>separateInjection()</script>";';
  files['styles.css'] += '\n/* </style><script>cssInjection()</script> */';
  const html = renderSite(files, { preview: false });
  assert.doesNotMatch(html, /<script>titleAttack|<script>separateInjection|<script>cssInjection|href="javascript:/);
  assert.match(html, /\\u003c\/script>/);
  assert.match(html, /&lt;\/title&gt;/);
});

test('custom sections preserve functional markup but route JS through script.js', () => {
  const files = seedFiles();
  const content = JSON.parse(files['content.json']);
  content.sections.push({ id: 'feature', type: 'custom', title: 'Feature', html: '<div id="calculator"><button onclick="bad()">Calculate</button><iframe src="https://example.com/embed" title="Map"></iframe></div><script>bad()</script>' });
  files['content.json'] = JSON.stringify(content);
  const html = renderSite(files, { preview: false });
  assert.match(html, /id="calculator"/);
  assert.match(html, /<iframe/);
  assert.doesNotMatch(html, /onclick=|<script>bad/);
});

test('both exports use the actual shared renderer and editable source, with disconnected external forms', () => {
  for (const framework of ['nuxt', 'next'] as const) {
    const exported = exportSite(seedFiles(), framework, [integration, { id: 'secret', name: 'CRM', type: 'webhook', enabled: true, endpoint: 'https://private.example/crm', secretConfigured: true }]);
    assert.equal(exported['site/content.json'], seedFiles()['content.json']);
    assert.equal(exported['public/script.js'], seedFiles()['script.js']);
    assert.ok(exported['assets/styles.css'].includes('.hero'));
    assert.doesNotMatch(JSON.stringify(exported), /private\.example|secretConfigured/);
    const source = exported['site/render.ts'].replace('export { renderContent };', 'globalThis.render = renderContent;');
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const html: string = context.render(JSON.parse(exported['site/content.json']), { preview: false, exported: true });
    assert.match(html, /data-forma-configured="false"/);
    assert.match(html, /data-section-id="services"/);
    assert.doesNotMatch(html, /_formaToken/);
    assert.ok(exported['README.md'].includes('not connected by default'));
    const entry = exported[framework === 'nuxt' ? 'app.vue' : 'app/page.tsx'];
    assert.match(entry, /renderContent/);
    assert.match(entry, /forma-runtime\.js/);
  }
});
