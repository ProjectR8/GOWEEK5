import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase';

const FUNCTION_URL =
  'https://europe-west1-neon-messenger-83ed4.cloudfunctions.net/telegramAuth';

export async function authenticateTelegram(initData: string) {
  if (!auth) throw new Error('Firebase не настроен');
  if (!initData) throw new Error('Telegram не передал данные авторизации');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
      signal: controller.signal,
      cache: 'no-store',
    });

    let data: { token?: string; error?: string };
    try {
      data = await response.json();
    } catch {
      throw new Error('Сервер авторизации вернул некорректный ответ');
    }

    if (!response.ok || typeof data.token !== 'string') {
      throw new Error(data.error || 'Ошибка авторизации Telegram');
    }

    return await signInWithCustomToken(auth, data.token);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Сервер авторизации не ответил за 15 секунд');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}