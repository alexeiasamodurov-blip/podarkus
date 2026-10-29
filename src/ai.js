import { mountAi } from './ai-ui.js';
mountAi({
  doc: document, endpoint: PODARKUS_AI_ENDPOINT,
  getToken: () => window.podarkusIdentity?.getToken() ?? null,
  showResults: (data, answers, ai) => window.podarkusResults.show(data, answers, ai),
  localResults: answers => window.podarkusResults.local(answers)
});
