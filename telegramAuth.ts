import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase';

const FUNCTION_URL =
  'https://europe-west1-neon-messenger-83ed4.cloudfunctions.net/telegramAuth';

export async function authenticateTelegram(initData: string) {
  if (!auth) throw new Error('Firebase не настроен');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });

  const data = await response.json();

  if (!response.ok || typeof data.token !== 'string') {
    throw new Error(data.error || 'Ошибка авторизации Telegram');
  }

  return signInWithCustomToken(auth, data.token);
}
