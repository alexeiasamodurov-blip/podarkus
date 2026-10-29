export function mountAi({ doc, endpoint, getToken, showResults, localResults, fetcher = fetch }) {
  let active = null;
  const quiz = doc.querySelector('#quiz-dialog');
  function node(tag, className, text) {
    const el = doc.createElement(tag); el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  quiz.addEventListener('close', () => active?.abort());
  doc.addEventListener('podarkus-results', event => {
    active?.abort();
    const { answers, result, ai } = event.detail;
    const root = doc.querySelector('#quiz-result');
    root.querySelector('.ai-panel')?.remove();
    const panel = node('section', 'ai-panel');
    panel.setAttribute('aria-label', 'Помощник с ИИ');
    panel.append(node('div', 'eyebrow', 'PODARKUS · ИИ-ПОМОЩНИК'));
    panel.append(node('h3', '', ai?.used ? 'Разберёмся в деталях?' : 'Хотите подобрать ещё точнее?'));
    panel.append(node('p', '', ai?.used ? 'Ответьте на уточнения — ИИ пересмотрит варианты.' : 'ИИ поможет понять увлечения и выбрать подарки из нашего каталога. Для этого войдите в Podarkus.'));
    if (ai?.questions?.length) {
      const list = node('ul', 'ai-questions');
      ai.questions.slice(0, 2).forEach(question => list.append(node('li', '', question)));
      panel.append(list);
    }
    const label = node('label', 'field', 'Уточнение интересов (необязательно)');
    const clarification = doc.createElement('textarea');
    clarification.maxLength = 800;
    clarification.placeholder = 'Например: больше любит рисовать акварелью, чем карандашами; набор красок уже есть.';
    clarification.value = ai?.clarification || '';
    label.append(clarification);
    panel.append(label);
    panel.append(node('p', 'ai-note', 'По кнопке ниже ответы анкеты, ограничения и уточнение будут отправлены в Cloudflare для обработки ИИ. Не указывайте ФИО, контакты или другие личные данные. Новые запреты и бюджет меняйте через «Изменить ответы».'));
    const button = node('button', 'button', ai?.used ? 'Пересмотреть с ИИ ↗' : 'Уточнить подбор с ИИ ↗');
    button.type = 'button'; panel.append(button);
    const status = node('p', 'ai-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.append(status);
    const signIn = node('button', 'auth-visibility', 'Войти или зарегистрироваться'); signIn.type = 'button'; signIn.hidden = true;
    signIn.addEventListener('click', () => doc.querySelector('#account-button')?.click()); panel.append(signIn);
    panel.append(node('p', 'ai-note', 'Бесплатно в пределах общего лимита сервиса. ИИ может ошибаться; цены и ссылки берутся из каталога, наличие и доставка не проверяются.'));
    if (ai) {
      const restore = node('button', 'auth-visibility', 'Вернуться к обычному подбору'); restore.type = 'button';
      restore.addEventListener('click', () => showResults(localResults(answers), answers, null)); panel.append(restore);
    }
    root.prepend(panel);
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true; clarification.disabled = true;
      status.textContent = 'Подключаем ИИ…';
      const controller = new AbortController(); active = controller;
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const token = await getToken();
        if (!panel.isConnected || !quiz.open || root.hidden || controller.signal.aborted) return;
        if (!token) { status.textContent = 'Сначала войдите или зарегистрируйтесь. После входа закройте окно профиля и повторите запрос — ответы останутся здесь.'; signIn.hidden = false; return; }
        signIn.hidden = true;
        status.textContent = 'ИИ сопоставляет интересы с каталогом. Это может занять до 45 секунд…';
        const response = await fetcher(endpoint + '/recommend', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ answers, clarification: clarification.value.trim() }), signal: controller.signal,
          credentials: 'omit', cache: 'no-store'
        });
        const data = await response.json();
        if (!panel.isConnected || !quiz.open || root.hidden || controller.signal.aborted) return;
        if (!response.ok) {
          status.textContent = response.status === 401 ? 'Войдите в Podarkus ещё раз и повторите запрос.' : response.status === 429 ? 'Подождите минуту перед следующим запросом. Обычный подбор доступен ниже.' : response.status === 400 ? 'Проверьте ответы анкеты и длину уточнения. Обычный подбор доступен ниже.' : 'ИИ временно недоступен или бесплатный лимит исчерпан. Обычный подбор доступен ниже.';
          return;
        }
        if (!Array.isArray(data.items) || !data.ai) throw Error('Invalid response');
        showResults(data, answers, { ...data.ai, clarification: clarification.value.trim() });
      } catch {
        if (panel.isConnected && quiz.open && !root.hidden) status.textContent = controller.signal.aborted ? 'ИИ не успел ответить. Обычный подбор сохранён ниже; можно попробовать ещё раз.' : 'Не удалось связаться с ИИ. Обычный подбор доступен ниже.';
      } finally { clearTimeout(timer); button.disabled = false; clarification.disabled = false; }
    });
  });
}
