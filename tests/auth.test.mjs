import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mountAuth, authError, verificationError } from '../src/auth-ui.js';

const markup = await readFile(new URL('../src/auth-dialog.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(overrides = {}, user = null) {
  const dom = new JSDOM('<button id="account-button">Войти</button><button data-quiz></button>' + markup);
  const doc = dom.window.document;
  const calls = [];
  const member = { uid: 'test', email: 'gift@example.test', displayName: 'Ирина', emailVerified: false };
  const service = {
    async register(...args) { calls.push(['register', ...args]); return { user: member }; },
    async login(...args) { calls.push(['login', ...args]); return member; },
    async logout() { calls.push(['logout']); },
    async reset(...args) { calls.push(['reset', ...args]); },
    async verify(...args) { calls.push(['verify', ...args]); },
    async refresh() { return { ...member, emailVerified: true }; },
    ...overrides
  };
  const controller = mountAuth(doc);
  controller.connect(service, user);
  const $ = selector => doc.querySelector(selector);
  const click = selector => $(selector).click();
  function fill(register = false) {
    if (register) click('[data-auth-mode="register"]');
    $('[name=email]').value = 'gift@example.test';
    $('[name=password]').value = 'long-test-passphrase';
    $('[name=name]').value = 'Ирина';
    $('[name=confirmation]').value = 'long-test-passphrase';
  }
  async function submit() {
    $('#auth-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
  }
  return { dom, doc, $, click, fill, submit, calls, controller, member };
}

test('mismatched confirmation prevents account creation', async () => {
  const f = fixture(); f.fill(true); f.$('[name=confirmation]').value = 'different-passphrase';
  await f.submit(); assert.equal(f.calls.length, 0);
  assert.equal(f.$('[name=confirmation]').validationMessage, 'Пароли не совпадают.');
});
test('short password is rejected before sending credentials', async () => {
  const f = fixture(); f.fill(true);
  f.$('[name=password]').value = f.$('[name=confirmation]').value = 'tiny';
  // Native HTML validation is supplemented in code, including for synthetic submits.
  await f.submit(); assert.equal(f.calls.length, 0);
});
test('registration and verification run once, then profile is shown and passwords cleared', async () => {
  const f = fixture(); f.fill(true); await f.submit();
  assert.deepEqual(f.calls.map(c => c[0]), ['register', 'verify']);
  assert.equal(f.$('#account-profile').hidden, false);
  assert.equal(f.$('#account-name').textContent, 'Ирина');
  assert.equal(f.$('[name=password]').value, '');
  assert.equal(f.$('[name=confirmation]').value, '');
  f.click('#resend-verification'); await tick();
  assert.equal(f.calls.filter(c => c[0] === 'verify').length, 1);
});
test('failed email delivery does not undo successful registration', async () => {
  const f = fixture({ async verify() { throw { code: 'auth/network-request-failed' }; } });
  f.fill(true); await f.submit();
  assert.equal(f.$('#account-profile').hidden, false);
  assert.match(f.$('#auth-status').textContent, /Аккаунт создан/);
  assert.match(f.$('#auth-status').textContent, /Письмо подтверждения не отправлено/);
  assert.match(f.$('#auth-status').textContent, /auth\/network-request-failed/);
  assert.match(f.$('#auth-status').textContent, /Повторно создавать аккаунт не нужно/);
});

test('verification quota errors remain visible while the account stays signed in', async () => {
  const f = fixture({ async verify() { throw { code: 'auth/quota-exceeded' }; } }, { email: 'gift@example.test' });
  f.click('#resend-verification'); await tick();
  assert.equal(f.$('#account-profile').hidden, false);
  assert.equal(f.$('#auth-status').classList.contains('is-error'), true);
  assert.match(f.$('#auth-status').textContent, /лимит отправки писем/);
  assert.match(f.$('#auth-status').textContent, /auth\/quota-exceeded/);
});

test('resend success describes provider acceptance without claiming inbox delivery', async () => {
  const f = fixture({}, { email: 'gift@example.test' });
  f.click('#resend-verification'); await tick();
  assert.match(f.$('#auth-status').textContent, /ещё не подтверждает доставку/);
  f.click('#resend-verification'); await tick();
  assert.equal(f.calls.filter(c => c[0] === 'verify').length, 1);
});

test('verification failures never expose unknown raw error content', () => {
  assert(!verificationError({ code: 'private-value', message: 'secret-token' }).includes('private-value'));
  assert(!verificationError({ message: 'secret-token' }).includes('secret-token'));
});
test('failed login leaves no profile and clears password', async () => {
  const f = fixture({ async login() { throw { code: 'auth/invalid-credential' }; } });
  f.fill(); await f.submit();
  assert.equal(f.$('#account-profile').hidden, true);
  assert.equal(f.$('[name=password]').value, '');
  assert.match(f.$('#auth-status').textContent, /Проверьте email и пароль/);
});
test('reset does not reveal whether the email exists', async () => {
  const f = fixture({ async reset() { throw { code: 'auth/user-not-found' }; } });
  f.click('#forgot-password'); f.$('[name=email]').value = 'missing@example.test';
  await f.submit();
  assert.equal(f.$('[name=password]').disabled, true);
  assert.match(f.$('#auth-status').textContent, /Если аккаунт с этим email существует/);
  assert.equal(f.$('#auth-status').classList.contains('is-error'), false);
});
test('logout waits for the provider, then removes profile', async () => {
  const f = fixture({}, { email: 'gift@example.test', displayName: 'Ирина' });
  f.click('#logout-button'); await tick();
  assert.deepEqual(f.calls, [['logout']]); assert.equal(f.$('#account-profile').hidden, true);
});
test('failed logout does not claim the session ended', async () => {
  const f = fixture({ async logout() { throw Error('failure'); } }, { email: 'gift@example.test' });
  f.click('#logout-button'); await tick();
  assert.equal(f.$('#account-profile').hidden, false);
  assert.equal(f.$('#auth-status').classList.contains('is-error'), true);
});
test('double submit cannot create duplicate accounts', async () => {
  let complete, count = 0;
  const f = fixture({ register() { count++; return new Promise(resolve => { complete = resolve; }); } });
  f.fill(true); await f.submit(); await f.submit(); assert.equal(count, 1);
  assert.equal(f.$('.auth-fields').disabled, true);
  complete({ user: f.member }); await tick(); assert.equal(f.$('.auth-fields').disabled, false);
});
test('profile renders user data as text rather than markup', () => {
  const f = fixture({}, { displayName: '<img src=x onerror=alert(1)>', email: 'gift@example.test' });
  assert.equal(f.$('#account-name').children.length, 0);
  assert.match(f.$('#account-name').textContent, /<img/);
});
test('verification reflects fresh provider state', async () => {
  const f = fixture({}, { email: 'gift@example.test', emailVerified: false });
  f.click('#refresh-verification'); await tick();
  assert.equal(f.$('#verification-actions').hidden, true);
  assert.equal(f.$('#email-state').textContent, 'Email подтверждён');
});
test('provider failure keeps credential fields disabled', () => {
  const f = fixture(); f.controller.unavailable('Подключение недоступно');
  assert.equal(f.$('.auth-fields').disabled, true);
  assert.equal(f.$('#auth-submit').disabled, true);
});
test('unknown SDK errors never expose raw details or tokens', () => {
  assert.equal(authError({ message: 'secret token in a provider error' }).includes('secret'), false);
});
