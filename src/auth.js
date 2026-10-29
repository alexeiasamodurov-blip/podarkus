import { initializeApp } from 'firebase/app';
import {
  initializeAuth, browserSessionPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile, reload
} from 'firebase/auth';
import { mountAuth } from './auth-ui.js';

const controller = mountAuth(document);
async function start() {
try {
  const app = initializeApp(PODARKUS_FIREBASE_CONFIG);
  // Let the SDK manage session tokens. Never persist passwords in application storage.
  const auth = initializeAuth(app, { persistence: browserSessionPersistence });
  auth.languageCode = 'ru';
  // Email links always return to the authorized public site, including from a local preview.
  const actions = { url: 'https://alexeiasamodurov-blip.github.io/podarkus/' };
  const provider = {
    async register(email, password, name) {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      let profileWarning = false;
      try { await updateProfile(user, { displayName: name }); }
      catch { profileWarning = true; }
      // Email sending is separate: an email failure must not masquerade as failed registration.
      return { user, profileWarning };
    },
    async login(email, password) { return (await signInWithEmailAndPassword(auth, email, password)).user; },
    logout: () => signOut(auth),
    reset: email => sendPasswordResetEmail(auth, email, actions),
    verify: user => sendEmailVerification(user, actions),
    async refresh(user) { await reload(user); return auth.currentUser; }
  };
  await auth.authStateReady();
  window.podarkusIdentity = {
    async getToken() { return auth.currentUser ? auth.currentUser.getIdToken() : null; }
  };
  controller.connect(provider, auth.currentUser);
  onAuthStateChanged(auth, user => controller.setUser(user));
} catch {
  controller.unavailable('Не удалось подключиться к сервису аккаунтов. Проверьте соединение и обновите страницу. Подбор подарков доступен без входа.');
}
}
void start();
