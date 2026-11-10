import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type ProfileInput = {
  name: string;
  age: number;
  city: string;
  bio: string;
  interests: string[];
};

export type ApiProfile = ProfileInput & {
  uid: string;
  isVisible: boolean;
};

export type ApiPerson = ApiProfile;

export type ApiEvent = {
  id: string;
  title: string;
  description: string;
  category: string;
  date: string;
  time: string;
  place: string;
  createdBy: string;
  participantCount: number;
  capacity: number;
  joined: boolean;
  status: string;
};

export type ApiMatch = {
  id: string;
  memberUids: string[];
};

export type ApiNotification = {
  id: string;
  type: string;
  title: string;
  text: string;
  read: boolean;
  createdAt?: unknown;
};

export type GoData = {
  profile: ApiProfile | null;
  people: ApiPerson[];
  swipedUids: string[];
  events: ApiEvent[];
  matches: ApiMatch[];
  notifications: ApiNotification[];
  clubMemberships: string[];
};

async function callFunction<TInput, TOutput>(
  name: string,
  data?: TInput,
): Promise<TOutput> {
  if (!functions) {
    throw new Error('Firebase Functions не настроены');
  }

  const callable = httpsCallable<TInput, TOutput>(functions, name);
  const result = await callable(data as TInput);
  return result.data;
}

export function goGetData() {
  return callFunction<Record<string, never>, GoData>('goGetData', {});
}

export function goSaveProfile(data: ProfileInput) {
  return callFunction<ProfileInput, { success: boolean }>('goSaveProfile', data);
}

export function goSwipe(data: {
  targetUid: string;
  direction: 'left' | 'right';
}) {
  return callFunction<
    typeof data,
    { success: boolean; matched: boolean }
  >('goSwipe', data);
}

export function goCreateEvent(data: {
  title: string;
  description: string;
  category: string;
  date: string;
  time: string;
  place: string;
}) {
  return callFunction<
    typeof data,
    { success: boolean; eventId: string }
  >('goCreateEvent', data);
}

export function goJoinEvent(data: { eventId: string }) {
  return callFunction<
    typeof data,
    { success: boolean; joined: boolean }
  >('goJoinEvent', data);
}

export function goToggleClub(data: { clubId: string }) {
  return callFunction<typeof data, { joined: boolean }>(
    'goToggleClub',
    data,
  );
}

export function goMarkNotificationsRead(data: {
  notificationIds: string[];
}) {
  return callFunction<
    typeof data,
    { success: boolean; updated: number }
  >('goMarkNotificationsRead', data);
}