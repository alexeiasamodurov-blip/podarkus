import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { generateKeyPair, SignJWT } from 'jose';
import data from '../worker/catalog.json' with { type: 'json' };
import { createPodarkusLocal } from '../worker/catalog-engine.js';
import { createHandler, parseOutput, shortlist } from '../worker/service.js';
import { verifyFirebaseToken } from '../worker/index.js';
import { mountAi } from '../src/ai-ui.js';

const ordinary = createPodarkusLocal(data), catalogue = createPodarkusLocal(data, true);
const answers = {
  recipient: data.config.questions.recipient[0].value,
  occasion: data.config.questions.occasion[0].value,
  style: data.config.questions.style[0].value,
  budget: 5000, interests: 'рисование акварелью', exclude: '', age_group: 'adult'
};
const origin = 'https://alexeiasamodurov-blip.github.io';
const token = 'test.'.repeat(20);
function setup(options = {}) {
  let calls = 0;
  const env = {
    ALLOWED_ORIGIN: origin, FIREBASE_PROJECT_ID: 'test-project',
    USER_LIMIT: { async limit() { return { success: !options.limited }; } },
    AI: { async run(model, input) {
      calls++;
      if (options.failure) throw Error('provider unavailable');
      const sent = JSON.parse(input.messages[1].content.split('\n/no_think')[0]);
      assert(!Object.hasOwn(sent.answers, 'email'));
      const id = sent.candidates[0].id;
      return { response: { picks: [{ id, reason: 'Подходит для творчества', search_url: 'https://evil.invalid' }], summary: 'Подбор', questions: [] } };
    } }
  };
  const handler = createHandler({ catalogue, verifyToken: async () => { if (options.badToken) throw Error('bad token'); return { sub: 'test-user' }; } });
  const request = (changes = {}) => new Request('https://worker.example/recommend', {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...changes.headers },
    body: changes.body ?? JSON.stringify({ answers: { ...answers, email: 'must-not-be-sent@example.invalid' }, clarification: '' })
  });
  return { run: (changes) => handler(request(changes), env), handler, env, calls: () => calls };
}

test('AI catalogue retains exactly 1537 unique ideas', () => {
  assert.equal(data.gifts.length, 1537); assert.equal(new Set(data.gifts.map(g => g.id)).size, 1537);
});
test('AI candidate widening retains price, age and explicit exclusions', () => {
  const query = { ...answers, age_group: 'child', budget: 1500, interests: 'не любит спорт; рисует', gift_kind: 'item' };
  const result = catalogue.recommend(query);
  assert(result.items.length > 0);
  for (const item of result.items) {
    const source = data.gifts.find(g => g.id === item.id);
    assert(item.price_max <= 1500); assert(source.audiences.includes('all') || source.audiences.includes('child'));
    assert(!source.flags.some(f => ['knife', 'needle', 'experience', 'certificate'].includes(f)));
    assert(!source.tags.includes('sport'));
  }
  assert(ordinary.recommend(answers).items.every(item => catalogue.recommend(answers).items.some(g => g.id === item.id)));
});
test('shortlist is bounded, unique and keeps the top matches', () => {
  const candidates = catalogue.recommend({ ...answers, budget: 100000 }).items;
  const list = shortlist(candidates);
  assert(list.length <= 150); assert.equal(list.length, new Set(list.map(g => g.id)).size);
  assert.deepEqual(list.slice(0, Math.min(35, candidates.length)), candidates.slice(0, 35));
});
test('model cannot invent catalogue IDs, prices or URLs, or duplicate picks', () => {
  const gift = catalogue.recommend(answers).items[0];
  const result = parseOutput({ response: JSON.stringify({ picks: [{ id: 'invented', reason: 'Fake' }, { id: gift.id, reason: 'Useful', price_max: 1, search_url: 'https://evil.invalid' }, { id: gift.id, reason: 'Again' }], questions: ['a', 'b', 'c'], summary: 'ok' }) }, [gift]);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].price_max, gift.price_max);
  assert.equal(result.items[0].search_url, gift.search_url); assert.equal(result.questions.length, 2);
  assert.throws(() => parseOutput({ response: { picks: [{ id: 'fake', reason: 'x' }], questions: [] } }, [gift]));
  assert.throws(() => parseOutput({ response: 'not JSON' }, [gift]));
});
test('origin and authentication checks happen before AI calls', async () => {
  for (const [options, changes, status] of [[{}, { headers: { Origin: 'https://evil.invalid' } }, 403], [{}, { headers: { Authorization: '' } }, 401], [{ badToken: true }, {}, 401]]) {
    const f = setup(options); assert.equal((await f.run(changes)).status, status); assert.equal(f.calls(), 0);
  }
});
test('invalid, oversized and unsupported input never reaches AI', async () => {
  for (const body of ['{', JSON.stringify({ answers: { ...answers, budget: -1 } }), JSON.stringify({ answers, clarification: 'x'.repeat(801) }), 'x'.repeat(16001)]) {
    const f = setup(); assert.equal((await f.run({ body })).status, 400); assert.equal(f.calls(), 0);
  }
});
test('user rate limit and provider errors return clear failure codes', async () => {
  const limited = setup({ limited: true }); assert.equal((await limited.run()).status, 429); assert.equal(limited.calls(), 0);
  assert.equal((await setup({ failure: true }).run()).status, 503);
});
test('authorized recommendation returns vetted catalogue data', async () => {
  const f = setup(), response = await f.run(), result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert(result.ai.used); assert.equal(result.items.length, 1); assert(result.items[0].search_url.startsWith('https://yandex.ru/search/'));
  assert.equal(f.calls(), 1);
});
test('empty eligible catalogue does not use AI quota', async () => {
  const f = setup(); const response = await f.run({ body: JSON.stringify({ answers: { ...answers, budget: 1 } }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).ai.used, false); assert.equal(f.calls(), 0);
});
test('Firebase token checks signature, issuer, audience, expiry and issue time', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const sign = (changes = {}, key = privateKey) => new SignJWT({ sub: 'test-user', iss: 'https://securetoken.google.com/project', aud: 'project', iat: now, exp: now + 3600, auth_time: now, ...changes }).setProtectedHeader({ alg: 'RS256' }).sign(key);
  assert.deepEqual(await verifyFirebaseToken(await sign(), 'project', publicKey), { sub: 'test-user' });
  for (const changes of [{ aud: 'other' }, { iss: 'https://evil.invalid' }, { exp: now - 60 }, { iat: now + 100 }, { auth_time: now + 100 }, { sub: '' }]) {
    await assert.rejects(verifyFirebaseToken(await sign(changes), 'project', publicKey));
  }
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyFirebaseToken(await sign({}, other.privateKey), 'project', publicKey));
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function ui(options = {}) {
  const dom = new JSDOM('<dialog id="quiz-dialog" open><div id="quiz-result"><article>Обычные подарки</article></div></dialog>');
  const doc = dom.window.document, shown = [];
  mountAi({ doc, endpoint: 'https://worker.example', getToken: async () => 'test', showResults: (...args) => shown.push(args), localResults: () => ordinary.recommend(answers), ...options });
  doc.dispatchEvent(new dom.window.CustomEvent('podarkus-results', { detail: { answers, result: ordinary.recommend(answers), ai: options.ai } }));
  return { dom, doc, shown, button: doc.querySelector('.ai-panel .button') };
}
test('logged-out user is prompted to sign in without sending answers', async () => {
  let calls = 0; const f = ui({ getToken: async () => null, fetcher: async () => { calls++; } });
  f.button.click(); await tick(); assert.equal(calls, 0); assert.match(f.doc.querySelector('.ai-status').textContent, /Сначала войдите/);
});
test('provider failure preserves ordinary gifts', async () => {
  const f = ui({ fetcher: async () => Response.json({ error: 'ai_unavailable' }, { status: 503 }) });
  f.button.click(); await tick(); assert.match(f.doc.querySelector('article').textContent, /Обычные/); assert.equal(f.shown.length, 0); assert.equal(f.button.disabled, false);
});
test('closing dialog prevents an outstanding response replacing results', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const f = ui({ fetcher: () => pending }); f.button.click(); await tick();
  f.doc.querySelector('dialog').open = false;
  f.doc.querySelector('dialog').dispatchEvent(new f.dom.window.Event('close'));
  resolve(Response.json({ items: [], ai: { used: true } })); await tick(); assert.equal(f.shown.length, 0);
});
test('editing answers prevents a stale AI response replacing the questionnaire', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const f = ui({ fetcher: () => pending }); f.button.click(); await tick();
  f.doc.querySelector('#quiz-result').hidden = true;
  resolve(Response.json({ items: [], ai: { used: true } })); await tick(); assert.equal(f.shown.length, 0);
});
test('model questions are rendered as text, never executable markup', () => {
  const f = ui({ ai: { used: true, questions: ['<img src=x onerror=alert(1)>'] } });
  assert.equal(f.doc.querySelectorAll('img').length, 0); assert.match(f.doc.querySelector('.ai-questions').textContent, /<img/);
});

test('full page renders a real recorded AI response and can restore local results', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const recorded = JSON.parse(await readFile(new URL('./live-ai-result.json', import.meta.url), 'utf8'));
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://alexeiasamodurov-blip.github.io/podarkus/' });
  const win = dom.window, doc = win.document;
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  doc.querySelector('[data-quiz]').click(); await tick();
  doc.querySelector('#quiz-result').hidden = false;
  mountAi({ doc, endpoint: 'https://worker.example', getToken: async () => null,
    showResults: (...args) => win.podarkusResults.show(...args), localResults: a => win.podarkusResults.local(a) });
  win.podarkusResults.show(recorded.result, recorded.answers, recorded.result.ai);
  assert.equal(doc.querySelector('#quiz-title').textContent, 'Подарки с помощью ИИ');
  assert.equal(doc.querySelectorAll('.result-card').length, recorded.result.items.length);
  assert.match(doc.querySelector('.gift-why').textContent, /ИИ:/);
  [...doc.querySelectorAll('.ai-panel button')].find(b => b.textContent === 'Вернуться к обычному подбору').click();
  assert.equal(doc.querySelector('#quiz-title').textContent, 'Подарки по вашим ответам');
  assert.equal(doc.querySelectorAll('.result-card').length, ordinary.recommend(recorded.answers).items.length);
  dom.window.close();
});

test('standalone legacy scenarios remain identical when available', async t => {
  let cases;
  try { cases = JSON.parse(await readFile(new URL('../../../work/standalone-cases.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('Legacy workspace fixtures are not part of the deployment'); throw error; }
  for (const fixture of cases) {
    if (fixture.error) assert.throws(() => ordinary.recommend(fixture.payload), { message: fixture.error });
    else assert.deepEqual(ordinary.recommend(fixture.payload), fixture.result);
  }
  t.diagnostic(`${cases.length} legacy scenarios passed`);
});
