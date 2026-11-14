import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type ApiProfile = {
  uid: string;
  name: string;
  age: number;
  city: string;
  bio: string;
  interests: string[];
  photoUrl?: string;
  username?: string;
  showUsername?: boolean;
  tgSync?: boolean;
  ratingAvg?: number;
  ratingCount?: number;
  popularity?: number;
  swipesTotal?: number;
};

export type ApiLiked = ApiProfile & {
  mutual: boolean;
};

export type ApiMatch = {
  id: string;
  memberUids: string[];
  profile?: ApiProfile | null;
};

export type ApiClub = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  memberCount: number;
  joined: boolean;
  ownerUid: string;
  isBuiltin?: boolean;
};

export type ApiNotification = {
  id: string;
  type: string;
  title: string;
  text: string;
  read: boolean;
  createdAt: number | null;
};

export type ApiPhotoPost = {
  id: string;
  photoUrl: string;
  caption: string;
  createdAt: number | null;
};

export type ApiEvent = {
  id: string;
  title: string;
  description: string;
  category: string;
  date: string;
  time: string;
  place: string;
  city?: string;
  createdBy: string;
  participantCount: number;
  capacity: number;
  joined: boolean;
  status: string;
};

export type GoData = {
  profile: ApiProfile | null;
  people: ApiProfile[];
  swipedUids: string[];
  liked: ApiLiked[];
  likedMeCount: number;
  events: ApiEvent[];
  matches: ApiMatch[];
  notifications: ApiNotification[];
  photoPosts: ApiPhotoPost[];
  clubMemberships: string[];
  clubCounts: Record<string, number>;
  clubs: ApiClub[];
  totalUsers: number;
};

export type GoLiveData = {
  people: ApiProfile[];
  swipedUids: string[];
  matches: ApiMatch[];
  events: ApiEvent[];
  notifications: ApiNotification[];
  clubMemberships: string[];
  clubCounts: Record<string, number>;
  clubs: ApiClub[];
  totalUsers: number;
};

const call = <I, O>(name: string) => (data: I) =>
  httpsCallable<I, O>(
    getFunctions(getApp(), 'europe-west1'),
    name
  )(data).then((result) => result.data);

export const goGetData = () =>
  call<Record<string, never>, GoData>('goGetData')({});

export const goGetLiveUpdates = () =>
  call<Record<string, never>, GoLiveData>('goGetLiveUpdates')({});

export const goCreateClub = call<
  {
    title: string;
    description: string;
    category: string;
  },
  {
    success: boolean;
    club: ApiClub;
  }
>('goCreateClub');

export const goSaveProfile = call<
  {
    name: string;
    age: number;
    city: string;
    bio: string;
    interests: string[];
    useTelegram?: boolean;
    showUsername?: boolean;
    photoUrl?: string;
  },
  {
    success: boolean;
  }
>('goSaveProfile');

export const goCreatePhotoPost = call<
  {
    photoUrl: string;
    caption?: string;
  },
  {
    success: boolean;
    postId: string;
  }
>('goCreatePhotoPost');

export const goDeletePhotoPost = call<
  {
    postId: string;
  },
  {
    success: boolean;
  }
>('goDeletePhotoPost');

export const goDeleteProfile = () =>
  call<Record<string, never>, { success: boolean }>(
    'goDeleteProfile'
  )({});

export const goSwipe = call<
  {
    targetUid: string;
    direction: 'left' | 'right';
  },
  {
    success: boolean;
    matched: boolean;
  }
>('goSwipe');

export const goUnlike = call<
  {
    targetUid: string;
  },
  {
    success: boolean;
  }
>('goUnlike');

export const goRate = call<
  {
    targetUid: string;
    stars: number;
  },
  {
    ratingAvg: number;
    ratingCount: number;
  }
>('goRate');

export const goReport = call<
  {
    targetUid: string;
  },
  {
    success: boolean;
  }
>('goReport');

export const goCreateEvent = call<
  {
    title: string;
    description: string;
    category: string;
    date: string;
    time: string;
    place: string;
    capacity?: number;
  },
  {
    success: boolean;
    eventId: string;
  }
>('goCreateEvent');

export const goJoinEvent = call<
  {
    eventId: string;
  },
  {
    success: boolean;
    joined: boolean;
  }
>('goJoinEvent');

export const goLeaveEvent = call<
  {
    eventId: string;
  },
  {
    success: boolean;
  }
>('goLeaveEvent');

export const goDeleteEvent = call<
  {
    eventId: string;
  },
  {
    success: boolean;
  }
>('goDeleteEvent');

export const goToggleClub = call<
  {
    clubId: string;
  },
  {
    joined: boolean;
    count: number;
  }
>('goToggleClub');

export const goMarkNotificationsRead = call<
  {
    notificationIds: string[];
  },
  {
    success: boolean;
    updated: number;
  }
>('goMarkNotificationsRead');

export const goGetPosts = call<
  {
    targetUid: string;
  },
  {
    posts: ApiPhotoPost[];
  }
>('goGetPosts');

export type ApiEventMessage = {
  id: string;
  uid: string;
  name: string;
  text: string;
  createdAt: number | null;
};

export const goGetEventChat = call<
  { eventId: string },
  { messages: ApiEventMessage[] }
>('goGetEventChat');

export const goSendEventMessage = call<
  { eventId: string; text: string },
  { success: boolean; messageId: string }
>('goSendEventMessage');