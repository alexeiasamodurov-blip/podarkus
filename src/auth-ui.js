export function authError(error) {
  const messages = {
    'auth/invalid-email': 'Проверьте адрес электронной почты.',
    'auth/invalid-credential': 'Не удалось войти. Проверьте email и пароль.',
    'auth/user-not-found': 'Не удалось войти. Проверьте email и пароль.',
    'auth/wrong-password': 'Не удалось войти. Проверьте email и пароль.',
    'auth/email-already-in-use': 'Не удалось создать аккаунт с этим email. Попробуйте войти или восстановить пароль.',
    'auth/weak-password': 'Используйте пароль от 10 символов. Лучше выбрать длинную фразу.',
    'auth/password-does-not-meet-requirements': 'Пароль не соответствует требованиям. Используйте не менее 10 символов.',
    'auth/too-many-requests': 'Слишком много попыток. Подождите немного и повторите.',
    'auth/quota-exceeded': 'Сервис исчерпал лимит отправки писем. Попробуйте позже; повторные нажатия сейчас не помогут.',
    'auth/network-request-failed': 'Нет связи с сервисом аккаунтов. Проверьте интернет и повторите.',
    'auth/user-disabled': 'Этот аккаунт недоступен.',
    'auth/operation-not-allowed': 'Регистрация временно недоступна. Попробуйте позже.',
    'auth/unauthorized-continue-uri': 'Адрес возврата на сайт не разрешён в настройках отправки писем. Сообщите об этой ошибке владельцу сайта.',
    'auth/invalid-continue-uri': 'Неверно настроен адрес возврата из письма. Сообщите об этой ошибке владельцу сайта.',
    'auth/expired-action-code': 'Ссылка устарела. Запросите новое письмо.',
    'auth/user-token-expired': 'Сессия истекла. Войдите ещё раз.',
    'auth/invalid-user-token': 'Сессия истекла. Войдите ещё раз.'
  };
  return messages[error?.code] || 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export function verificationError(error) {
  const reason = authError(error);
  const safeCodes = ['auth/network-request-failed', 'auth/too-many-requests', 'auth/quota-exceeded',
    'auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/invalid-email',
    'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled'];
  return 'Письмо подтверждения не отправлено. ' + reason +
    (safeCodes.includes(error?.code) ? ' Код ошибки: ' + error.code + '.' : '');
}

export function mountAuth(doc) {
  const $ = selector => doc.querySelector(selector);
  const dialog = $('#auth-dialog');
  const form = $('#auth-form');
  const trigger = $('#account-button');
  const status = $('#auth-status');
  const fieldset = form.querySelector('fieldset');
  const fields = form.elements;
  const tabs = [...dialog.querySelectorAll('[data-auth-mode]')];
  const password = fields.namedItem('password');
  const confirmation = fields.namedItem('confirmation');
  let provider = null, user = null, mode = 'login', busy = false;
  let verifyAgainAt = 0;

  function message(text = '', error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  }
  function clearPasswords() {
    password.value = confirmation.value = '';
    password.type = confirmation.type = 'password';
    confirmation.setCustomValidity('');
    $('#password-visibility').textContent = 'Показать пароль';
    $('#password-visibility').setAttribute('aria-pressed', 'false');
  }
  function render() {
    const registration = mode === 'register', reset = mode === 'reset';
    form.hidden = Boolean(user);
    $('#account-profile').hidden = !user;
    $('#auth-tabs').hidden = Boolean(user);
    trigger.textContent = user ? 'Мой профиль' : 'Войти';
    $('#auth-title').textContent = user ? 'Ваш профиль' : reset ? 'Вернём доступ' : registration ? 'Добро пожаловать!' : 'С возвращением!';
    $('#auth-description').textContent = user ? 'Ваш аккаунт в Podarkus. Подберём что-нибудь особенное?' : reset ? 'Укажите email вашего аккаунта — отправим ссылку для смены пароля.' : 'Подбор подарков доступен и без входа. Регистрация бесплатна.';
    form.querySelectorAll('[data-registration]').forEach(node => {
      node.hidden = !registration;
      node.querySelector('input').disabled = !registration;
      node.querySelector('input').required = registration;
    });
    $('[data-password]').hidden = reset;
    password.disabled = reset;
    password.required = !reset;
    password.minLength = registration ? 10 : 1;
    password.autocomplete = registration ? 'new-password' : 'current-password';
    $('#password-hint').hidden = !registration;
    $('#password-visibility').hidden = reset;
    $('#forgot-password').hidden = reset;
    $('#back-to-login').hidden = !reset;
    $('#auth-submit').textContent = reset ? 'Отправить ссылку' : registration ? 'Создать аккаунт' : 'Войти';
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.authMode === mode)));
    if (user) {
      $('#account-name').textContent = user.displayName || 'Пользователь Podarkus';
      $('#account-email').textContent = user.email || '';
      $('#email-state').textContent = user.emailVerified ? 'Email подтверждён' : 'Email ещё не подтверждён';
      $('#email-state').classList.toggle('is-verified', Boolean(user.emailVerified));
      $('#verification-actions').hidden = Boolean(user.emailVerified);
    }
    fieldset.disabled = busy || !provider;
    dialog.querySelectorAll('button:not(.close-dialog)').forEach(button => {
      button.disabled = busy || (!provider && !button.hasAttribute('data-auth-mode'));
    });
    form.setAttribute('aria-busy', String(busy));
  }
  function setMode(next) {
    mode = next; clearPasswords(); message(); render();
    if (!provider) message('Сервис аккаунтов ещё не подключён. Обновите страницу или попробуйте позже. Подбор подарков доступен без входа.');
  }
  async function run(action) {
    if (busy || !provider) return;
    busy = true; render(); message('Подождите…');
    try { await action(); }
    catch (error) { message(authError(error), true); }
    finally { busy = false; render(); }
  }

  trigger.addEventListener('click', () => { if (!busy) setMode('login'); });
  tabs.forEach(tab => tab.addEventListener('click', () => { if (!busy) setMode(tab.dataset.authMode); }));
  $('#forgot-password').addEventListener('click', () => setMode('reset'));
  $('#back-to-login').addEventListener('click', () => setMode('login'));
  $('#password-visibility').addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = confirmation.type = show ? 'text' : 'password';
    $('#password-visibility').textContent = show ? 'Скрыть пароль' : 'Показать пароль';
    $('#password-visibility').setAttribute('aria-pressed', String(show));
  });
  [password, confirmation].forEach(input => input.addEventListener('input', () => confirmation.setCustomValidity('')));

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !provider) return;
    const email = fields.namedItem('email').value.trim();
    fields.namedItem('email').value = email;
    if (mode === 'register' && (password.value.length < 10 || password.value.length > 128)) {
      message('Пароль должен содержать от 10 до 128 символов.', true); return;
    }
    if (mode === 'register' && password.value !== confirmation.value) {
      confirmation.setCustomValidity('Пароли не совпадают.');
      confirmation.reportValidity(); return;
    }
    if (!form.reportValidity()) return;
    const submittedMode = mode;
    // Capture before disabling controls; never save the password beyond this request.
    const secret = password.value;
    const name = fields.namedItem('name').value.trim();
    if (submittedMode === 'register' && !name) { message('Укажите ваше имя.', true); return; }
    void run(async () => {
      if (submittedMode === 'reset') {
        try { await provider.reset(email); }
        catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
        message('Если аккаунт с этим email существует, письмо со ссылкой отправлено. Проверьте почту и папку «Спам».');
        return;
      }
      try {
        if (submittedMode === 'register') {
          const result = await provider.register(email, secret, name);
          user = result.user;
          form.reset(); clearPasswords();
          let notice = 'Аккаунт создан. Вы вошли в Podarkus.';
          if (result.profileWarning) notice += ' Имя пока не удалось сохранить.';
          try {
            await provider.verify(user);
            verifyAgainAt = Date.now() + 60000;
            notice += ' Запрос на отправку принят. В письме будет ссылка подтверждения, а не цифровой код. Доставка может занять несколько минут.';
          } catch (error) {
            notice += ' ' + verificationError(error) + ' Повторно создавать аккаунт не нужно.';
          }
          message(notice);
        } else {
          user = await provider.login(email, secret);
          form.reset(); clearPasswords(); message('Вы вошли в аккаунт.');
        }
      } finally { clearPasswords(); }
    });
  });
  $('#logout-button').addEventListener('click', () => void run(async () => {
    await provider.logout(); user = null; form.reset(); mode = 'login'; clearPasswords();
    message('Вы вышли из аккаунта.');
  }));
  $('#resend-verification').addEventListener('click', () => void run(async () => {
    if (!user) return;
    if (Date.now() < verifyAgainAt) { message('Письмо уже отправлено. Повторить отправку можно через минуту.'); return; }
    try {
      await provider.verify(user); verifyAgainAt = Date.now() + 60000;
      message('Сервис принял запрос на отправку. Это ещё не подтверждает доставку в почтовый ящик. В письме будет ссылка; откройте её и нажмите «Я подтвердил email».');
    } catch (error) { message(verificationError(error), true); }
  }));
  $('#refresh-verification').addEventListener('click', () => void run(async () => {
    if (!user) return;
    try {
      user = await provider.refresh(user);
      message(user?.emailVerified ? 'Email подтверждён.' : 'Подтверждение пока не найдено. Откройте ссылку в письме и повторите проверку.');
    } catch (error) {
      if (['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled'].includes(error.code)) {
        await provider.logout(); user = null;
      }
      throw error;
    }
  }));
  $('#account-gifts').addEventListener('click', () => { dialog.close(); $('[data-quiz]').click(); });
  dialog.addEventListener('close', clearPasswords);
  render();
  return {
    connect(service, currentUser) { provider = service; user = currentUser; render(); message(); },
    setUser(value) { user = value; if (!busy) render(); },
    unavailable(text) { provider = null; render(); message(text, true); }
  };
}
