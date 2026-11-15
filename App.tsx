import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowRight, ArrowUpRight, Bell, CalendarDays, Check,
  ChevronRight, Compass, MapPin, Plus, Search,
  Settings, Sparkles, Users, UsersRound, UserRound, Send, Music2, Dumbbell,
  X, Clock3, SlidersHorizontal, LayoutGrid, Trash2, Camera, Gamepad2, Palette, Cpu, ChevronLeft,
  MessageCircle, LogOut, Ellipsis, Share2
} from 'lucide-react';
import { firebaseConfigured, storage } from './firebase';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import './profile.css';
import { authenticateTelegram } from './telegramAuth';
import {
  goCreateEvent,
  goCreatePhotoPost,
  goDeletePhotoPost,
  goGetData,
  goGetLiveUpdates,
  goGetPulse,
  goLeaveEvent,
  goDeleteEvent,
  goCreateClub,
  goGetPosts,
  goJoinEvent,
  goMarkNotificationsRead,
  goSaveProfile,
  goSwipe,
  goToggleClub,
  type ApiClub,
  type ApiMatch,
  type ApiNotification,
  type ApiPhotoPost,
  type ApiProfile,
  type GoData,
} from './goApi';

const GroupScreen = lazy(() => import('./GroupScreen'));

type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: {
    user?: {
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  openTelegramLink?: (url: string) => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type Tab = 'home' | 'people' | 'create' | 'communities' | 'profile';

type Person = {
  uid: string;
  name: string;
  age: number;
  city: string;
  bio: string;
  interests: string[];
  color: string;
  initials: string;
  activity: string;
  photoUrl?: string;
  username?: string;
};

type EventItem = {
  id: string;
  title: string;
  category: string;
  date: string;
  time: string;
  place: string;
  people: string;
  participantCount: number;
  capacity: number;
  joined: boolean;
  color: string;
  description: string;
  forYou?: boolean;
  city?: string;
  nearby?: boolean;
  createdBy?: string;
};

type Club = {
  id: string;
  title: string;
  members: string;
  description: string;
  icon: string;
  keywords: string[];
  perks: string[];
  category?: string;
  ownerUid?: string;
};

type Detail =
  | { type: 'person'; uid: string }
  | { type: 'event'; id: string }
  | { type: 'club'; id: string };

type ProfileForm = {
  name: string;
  age: string;
  city: string;
  bio: string;
  interests: string;
};

type TelegramAuthStatus = 'checking' | 'signed-in' | 'error' | 'not-in-telegram';

const demoPeople: Person[] = [
  {
    uid: 'demo-artem', name: 'Артём', age: 16, city: 'Рядом с тобой',
    bio: 'Ищу компанию для настолок, небольших проектов и прогулок. Люблю придумывать что-то новое.',
    interests: ['Настольные игры', 'Программирование', 'Кино'], color: 'blue', initials: 'А',
    activity: 'Ищет команду на выходные',
  },
  {
    uid: 'demo-sasha', name: 'Саша', age: 15, city: 'Твой город',
    bio: 'Рисую, слушаю музыку и хочу найти друзей, с которыми можно ходить на события.',
    interests: ['Рисование', 'Музыка', 'Прогулки'], color: 'pink', initials: 'С',
    activity: 'Открыта к новым идеям',
  },
  {
    uid: 'demo-misha', name: 'Миша', age: 17, city: 'Твой город',
    bio: 'Люблю футбол, игры и технологии. Буду рад совместным активностям.',
    interests: ['Футбол', 'Игры', 'Технологии'], color: 'green', initials: 'М',
    activity: 'Собирает игровую команду',
  },
];

const demoEvents: EventItem[] = [
  {
    id: 'demo-event-1', title: 'Вечер настолок', category: 'Встреча', date: 'Суббота',
    time: '16:00', place: 'Молодёжный центр', people: '4 из 12 участников',
    participantCount: 4, capacity: 12, joined: false, color: 'lavender',
    description: 'Знакомимся, выбираем настольную игру и проводим вечер в хорошей компании. Новичкам тоже рады.',
  },
  {
    id: 'demo-event-2', title: 'Мини-хакатон', category: 'Технологии', date: 'Воскресенье',
    time: '14:00', place: 'Онлайн', people: '3 из 8 участников',
    participantCount: 3, capacity: 8, joined: false, color: 'orange',
    description: 'Небольшая командная сессия: идеи, прототипы и обмен опытом. Можно прийти просто посмотреть.',
  },
  {
    id: 'demo-event-3', title: 'Прогулка с фото', category: 'Творчество', date: 'Среда',
    time: '17:30', place: 'Городской парк', people: '5 из 10 участников',
    participantCount: 5, capacity: 10, joined: false, color: 'mint',
    description: 'Неспешная прогулка, фотографии на телефон и новые знакомства.',
  },
];

// Старые демо-записи оставлены в исходнике, но не показываются участникам.
void demoPeople;
void demoEvents;

const CITIES = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Нижний Новгород', 'Челябинск', 'Самара',
  'Омск', 'Ростов-на-Дону', 'Уфа', 'Красноярск', 'Воронеж', 'Пермь', 'Волгоград', 'Краснодар', 'Саратов', 'Тюмень',
  'Тольятти', 'Ижевск', 'Барнаул', 'Ульяновск', 'Иркутск', 'Хабаровск', 'Ярославль', 'Владивосток', 'Махачкала',
  'Томск', 'Оренбург', 'Кемерово', 'Новокузнецк', 'Рязань', 'Астрахань', 'Набережные Челны', 'Пенза', 'Липецк',
  'Киров', 'Чебоксары', 'Калининград', 'Тула', 'Курск', 'Сочи', 'Ставрополь', 'Улан-Удэ', 'Тверь', 'Магнитогорск',
  'Иваново', 'Брянск', 'Белгород', 'Сургут', 'Владимир', 'Нижний Тагил', 'Архангельск', 'Чита', 'Калуга', 'Смоленск',
  'Курган', 'Череповец', 'Орёл', 'Вологда', 'Мурманск', 'Саранск', 'Якутск', 'Йошкар-Ола', 'Тамбов', 'Кострома',
  'Нижневартовск', 'Новороссийск', 'Каменск-Уральский', 'Первоуральск',
];

const CATEGORIES = ['Встреча', 'Игры', 'Творчество', 'Технологии', 'Спорт', 'Музыка', 'Другое'];
const CLUB_CATEGORIES = ['Игры', 'Творчество', 'Технологии', 'Музыка', 'Спорт', 'Общение', 'Другое'];

const clubs: Club[] = [
  {
    id: 'gaming', title: 'Игровой клуб', members: '', category: 'Игры',
    description: 'Для тех, кто любит настолки и видеоигры. Находи команду и ходи на игровые встречи.',
    icon: 'game', keywords: ['игр', 'настол', 'гейм', 'турнир', 'game'],
    perks: ['Все игровые события в одном месте', 'Такие события появляются у тебя в «Для тебя»', 'Можно создать игровую встречу прямо из клуба'],
  },
  {
    id: 'art', title: 'Арт-комьюнити', members: '', category: 'Творчество',
    description: 'Рисование, фото, дизайн и музыка. Для тех, кто любит создавать и делиться.',
    icon: 'art', keywords: ['твор', 'рис', 'арт', 'фото', 'дизайн', 'музык'],
    perks: ['Творческие встречи и прогулки с фото', 'Такие события появляются у тебя в «Для тебя»', 'Можно создать встречу прямо из клуба'],
  },
  {
    id: 'tech', title: 'Технологии', members: '', category: 'Технологии',
    description: 'Код, электроника и пет-проекты. Собирай команду и ходи на хакатоны.',
    icon: 'tech', keywords: ['тех', 'код', 'програм', 'хакатон', 'it', 'робот'],
    perks: ['Хакатоны и встречи для разработчиков', 'Такие события появляются у тебя в «Для тебя»', 'Можно создать встречу прямо из клуба'],
  },
];

const nav = [
  { id: 'home' as const, label: 'Главная', Icon: Compass },
  { id: 'people' as const, label: 'Люди', Icon: Search },
  { id: 'create' as const, label: 'Создать', Icon: Plus },
  { id: 'communities' as const, label: 'Клубы', Icon: UsersRound },
  { id: 'profile' as const, label: 'Профиль', Icon: UserRound },
];

const emptyProfileForm: ProfileForm = {
  name: '', age: '', city: '', bio: '', interests: '',
};

function ClubIcon({ id, size }: { id: string; size: number }) {
  const Icon = id === 'game'
    ? Gamepad2
    : id === 'art'
      ? Palette
      : id === 'tech'
        ? Cpu
        : id === 'music'
          ? Music2
          : id === 'sport'
            ? Dumbbell
            : UsersRound;

  return <Icon size={size} />;
}

const norm = (value: string) => value.trim().toLowerCase();

function sameInterest(a: string, b: string) {
  const x = norm(a);
  const y = norm(b);

  if (!x || !y) return false;

  return x === y ||
    (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}

function scorePerson(me: ApiProfile | null, person: Person) {
  if (!me) return { score: 0, percent: 0, shared: [] as string[] };

  const mine = me.interests || [];
  const shared = person.interests.filter(
    (tag) => mine.some((interest) => sameInterest(interest, tag))
  );

  let score = shared.length * 3;

  const sameCity = Boolean(
    me.city &&
    person.city &&
    norm(me.city) === norm(person.city)
  );

  if (sameCity) score += 3;

  const diff = Math.abs((me.age || 0) - person.age);

  score += diff === 0
    ? 3
    : diff === 1
      ? 2
      : diff <= 2
        ? 1
        : 0;

  if (person.photoUrl) score += 1;

  const maxScore =
    Math.min(5, Math.max(1, mine.length, person.interests.length)) * 3 + 7;

  const percent = Math.max(
    5,
    Math.min(99, Math.round((score / maxScore) * 100))
  );

  return { score, percent, shared };
}

function todayStr() {
  const date = new Date();

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isUpcoming(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date >= todayStr()
    : true;
}

function withinDays(date: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  const diff =
    (new Date(`${date}T12:00:00`).getTime() - Date.now()) / 86400000;

  return diff <= days;
}

function eventInClub(event: EventItem, club: Club) {
  const value = norm(`${event.category} ${event.title}`);

  return club.keywords.some((word) => value.includes(word));
}

function isForYou(
  me: ApiProfile | null,
  joined: string[],
  event: EventItem,
  clubList: Club[] = clubs
) {
  const byClub = clubList.some(
    (club) => joined.includes(club.id) && eventInClub(event, club)
  );

  const value = norm(`${event.title} ${event.category} ${event.description}`);

  const byInterest = (me?.interests || []).some((tag) => {
    const interest = norm(tag);

    return interest.length >= 3 && value.includes(interest);
  });

  return byClub || byInterest;
}

function initialsFor(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function colorFor(uid: string) {
  const colors = ['blue', 'pink', 'green'];
  let hash = 0;

  for (let index = 0; index < uid.length; index += 1) {
    hash = (hash * 31 + uid.charCodeAt(index)) | 0;
  }

  return colors[Math.abs(hash) % colors.length];
}

function toPerson(profile: ApiProfile): Person {
  return {
    uid: profile.uid,
    name: profile.name || 'Участник GO',
    age: Number(profile.age || 0),
    city: profile.city || 'Город не указан',
    bio: profile.bio || 'Пока ничего не рассказал о себе.',
    interests: Array.isArray(profile.interests) ? profile.interests : [],
    color: colorFor(profile.uid),
    initials: initialsFor(profile.name || ''),
    activity: 'Открыт к совместным активностям',
    photoUrl: profile.photoUrl || '',
    username: profile.username || '',
  };
}

function toClub(club: ApiClub): Club {
  const category = club.category || 'Другое';

  const icon = club.icon ||
    (
      category === 'Игры'
        ? 'game'
        : category === 'Творчество'
          ? 'art'
          : category === 'Технологии'
            ? 'tech'
            : category === 'Музыка'
              ? 'music'
              : category === 'Спорт'
                ? 'sport'
                : 'users'
    );

  return {
    id: club.id,
    title: club.title,
    members: String(Number(club.memberCount || 0)),
    description: club.description || 'Сообщество участников GO.',
    icon,
    keywords: [norm(category), norm(club.title)].filter(Boolean),
    perks: [
      'Общайся с участниками по интересам',
      'Следи за событиями сообщества',
      'Создавай совместные активности',
    ],
    category,
    ownerUid: club.ownerUid || '',
  };
}

function eventColor(category: string) {
  const value = category.toLowerCase();

  if (
    value.includes('тех') ||
    value.includes('код') ||
    value.includes('онлайн') ||
    value.includes('спорт')
  ) {
    return 'orange';
  }

  if (
    value.includes('твор') ||
    value.includes('фото') ||
    value.includes('арт')
  ) {
    return 'mint';
  }

  return 'lavender';
}

function toEvent(event: GoData['events'][number]): EventItem {
  const count = Number(event.participantCount || 0);
  const capacity = Number(event.capacity || 30);

  return {
    id: event.id,
    title: event.title,
    category: event.category || 'Встреча',
    date: event.date,
    time: event.time,
    place: event.place,
    city: event.city || '',
    people: `${count} из ${capacity} участников`,
    participantCount: count,
    capacity,
    joined: event.joined,
    createdBy: event.createdBy || '',
    color: eventColor(event.category || ''),
    description: event.description,
  };
}

function displayDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  return value;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(
      (error as { message?: unknown }).message || 'Неизвестная ошибка'
    );
  }

  return String(error || 'Неизвестная ошибка');
}

async function prepareImage(file: File, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');

  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);

  canvas.getContext('2d')!.drawImage(
    bmp,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error('Не удалось обработать фото')),
      'image/jpeg',
      0.85
    )
  );
}

// У событий нет загруженных фото, поэтому обложка рисуется по категории.
type ArtKind = 'crowd' | 'city' | 'field' | 'grid';

function artFor(category: string): {
  a: string;
  b: string;
  glow: string;
  kind: ArtKind;
} {
  const value = norm(category);

  if (value.includes('муз')) return { a: '#1a0b4d', b: '#8a3df0', glow: '#e0b3ff', kind: 'crowd' };
  if (value.includes('спорт')) return { a: '#101a55', b: '#4a6cf0', glow: '#b6c8ff', kind: 'field' };
  if (value.includes('игр')) return { a: '#1d0a52', b: '#9a3df0', glow: '#7df0ff', kind: 'grid' };
  if (value.includes('тех')) return { a: '#0c1a52', b: '#5b4df0', glow: '#8fe6ff', kind: 'city' };
  if (value.includes('твор') || value.includes('фото') || value.includes('арт')) {
    return { a: '#340b52', b: '#c03dd0', glow: '#ffb3f0', kind: 'city' };
  }

  return { a: '#1f0b57', b: '#7c3df0', glow: '#d2b8ff', kind: 'crowd' };
}

function EventArt({ category }: { category: string }) {
  const art = artFor(category);
  const key = norm(category).replace(/[^a-zа-я0-9]/g, '') || 'x';
  const heads = Array.from({ length: 14 }, (_, i) => ({
    x: 14 + i * 28 + (i % 3) * 4,
    y: 236 + ((i * 7) % 5) * 6,
    r: 13 + (i % 4) * 2,
  }));

  return (
    <svg
      className="art"
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`art-bg-${key}`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={art.b} />
          <stop offset="1" stopColor={art.a} />
        </linearGradient>
        <radialGradient id={`art-glow-${key}`} cx="50%" cy="30%" r="60%">
          <stop offset="0" stopColor={art.glow} stopOpacity=".75" />
          <stop offset="1" stopColor={art.glow} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="300" fill={`url(#art-bg-${key})`} />
      <rect width="400" height="300" fill={`url(#art-glow-${key})`} />

      {art.kind === 'crowd' && (
        <>
          <g fill={art.glow} opacity=".2">
            <path d="M70 0l40 0 -70 240z" />
            <path d="M170 0l36 0 -20 240z" />
            <path d="M250 0l36 0 56 240z" />
            <path d="M330 0l30 0 60 200z" />
          </g>
          <g fill="#0a0518">
            {heads.map((h, i) => (
              <g key={i}>
                <circle cx={h.x} cy={h.y} r={h.r} />
                <path
                  d={`M${h.x - h.r - 8} 310c0-40 ${h.r}-52 ${h.r + 8}-52s${h.r + 8} 12 ${h.r + 8} 52z`}
                />
              </g>
            ))}
          </g>
        </>
      )}

      {art.kind === 'city' && (
        <g fill="#0a0518" opacity=".92">
          <path d="M0 300V190h30v-40h26v40h20v-70h30v70h22v-30h24v30h18v-100h34v100h22v-60h26v60h20v-84h30v84h24v-40h28v40h16v-20h30v20h20v110z" />
          <g fill={art.glow} opacity=".55">
            {Array.from({ length: 26 }, (_, i) => (
              <rect key={i} x={20 + (i * 47) % 360} y={170 + ((i * 29) % 100)} width="5" height="7" rx="1" />
            ))}
          </g>
        </g>
      )}

      {art.kind === 'field' && (
        <g fill="none" stroke={art.glow} strokeWidth="3" opacity=".5">
          <ellipse cx="200" cy="280" rx="260" ry="90" />
          <ellipse cx="200" cy="280" rx="170" ry="56" />
          <path d="M200 190v180" />
          <circle cx="200" cy="140" r="28" fill={art.glow} fillOpacity=".25" stroke="none" />
        </g>
      )}

      {art.kind === 'grid' && (
        <g stroke={art.glow} strokeWidth="1.5" opacity=".4" fill="none">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M${200 + (i - 4) * 12} 150L${200 + (i - 4) * 70} 300`} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d={`M0 ${160 + i * i * 6}h400`} />
          ))}
          <rect x="150" y="70" width="100" height="56" rx="14" fill={art.glow} fillOpacity=".18" />
        </g>
      )}
    </svg>
  );
}

function AvatarStack({ count }: { count: number }) {
  const shown = Math.min(3, count);

  return (
    <span className="avatar-stack" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <i key={i} className={`as as-${i}`}>
          <UserRound size={13} />
        </i>
      ))}

      {count > 3 && <b>+{count - 3}</b>}
    </span>
  );
}

function shortMonth(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00`)
        .toLocaleDateString('ru-RU', { month: 'short' })
        .replace('.', '')
    : '';
}

function DateBadge({ date }: { date: string }) {
  return (
    <div className="date-badge" aria-hidden="true">
      <b>{Number(date.slice(8, 10)) || ''}</b>
      <span>{shortMonth(date)}</span>
    </div>
  );
}

function withJoin(event: EventItem, joined: boolean, count: number): EventItem {
  const safe = Math.max(0, count);

  return {
    ...event,
    joined,
    participantCount: safe,
    people: `${safe} из ${event.capacity} участников`,
  };
}

function Splash({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-orb" />

      <svg
        className="splash-city"
        viewBox="0 0 390 120"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
      >
        <path d="M0 120V84h18V62h14v22h12V48h16v36h10V70h18v14h14V36h12v48h16V58h20v26h12V74h16V52h14v32h12V66h18v18h14V40h14v44h16V60h18v24h12V72h20v48z" />
      </svg>

      <div className="splash-logo">
        <span className="splash-mark">
          G<i />
        </span>
        <span className="splash-name">GO</span>
        <span className="splash-tag">Город. Люди. События.</span>
      </div>

      {error ? (
        <div className="splash-error">
          <p>{error}</p>

          <button className="primary" onClick={onRetry}>
            Повторить
          </button>
        </div>
      ) : (
        <div className="splash-dots" aria-label="Загрузка">
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  text,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="confirm-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="confirm-title">{title}</h3>
        <p>{text}</p>

        <div className="confirm-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>

          <button className="primary danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Подожди…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventTile({
  event,
  onOpen,
}: {
  event: EventItem;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      className={`event-tile hero event-${event.color}`}
      onClick={() => onOpen(event.id)}
    >
      <EventArt category={event.category} />
      <div className="cover-shade" />

      <DateBadge date={event.date} />

      <div className="event-body">
        <h2>{event.title}</h2>

        <div className="hero-line">
          <MapPin size={14} />
          {event.place}
        </div>

        <div className="hero-line">
          <Clock3 size={14} />
          {event.time} · {event.participantCount}/{event.capacity}
        </div>

        <span className="hero-cta">
          Участвовать
          <ArrowRight size={15} />
        </span>
      </div>
    </button>
  );
}

function EventRow({
  event,
  onOpen,
}: {
  event: EventItem;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      className="event-row"
      style={{ ['--ev' as string]: artFor(event.category).glow }}
      onClick={() => onOpen(event.id)}
    >
      <span className="event-row-art">
        <EventArt category={event.category} />
      </span>

      <span className="event-row-body">
        <b>{event.title}</b>

        <small>
          <CalendarDays size={12} />
          {displayDate(event.date)} · {event.time}
        </small>

        <span className="event-row-people">
          <AvatarStack count={event.participantCount} />
          <em>
            {event.participantCount}/{event.capacity}
          </em>
        </span>
      </span>

      <ChevronRight size={17} />
    </button>
  );
}

function Intro({ onDone }: { onDone: () => void }) {
  return (
    <div className="intro">
      <div className="intro-bg" />

      <svg className="intro-star" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="star-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".55" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity=".15" />
          </linearGradient>
        </defs>
        <path
          d="M60 8l14 32 35 4-26 24 7 34-30-17-30 17 7-34L11 44l35-4z"
          fill="url(#star-g)"
          stroke="rgba(255,255,255,.5)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>

      <div className="intro-content">
        <span className="brand-g">
          G<i />
        </span>

        <h1>
          Больше,
          <br />
          чем просто
          <br />
          события
        </h1>

        <p>Сообщество. Возможности. Новые знакомства.</p>

        <AvatarStack count={3} />
      </div>

      <button className="intro-cta" onClick={onDone}>
        Присоединиться к GO
        <ArrowRight size={18} />
      </button>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | ''>('');
  const [swipeLock, setSwipeLock] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState('');
  const [authStatus, setAuthStatus] = useState<TelegramAuthStatus>('checking');
  const [dataLoading, setDataLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [query, setQuery] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm);
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [allPeople, setAllPeople] = useState<Person[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [clubCounts, setClubCounts] = useState<Record<string, number>>({});
  const [communityClubs, setCommunityClubs] = useState<Club[]>(clubs);
  const [registeredUserCount, setRegisteredUserCount] = useState(0);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [bootError, setBootError] = useState('');
  const [bootNonce, setBootNonce] = useState(0);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [heroIdx, setHeroIdx] = useState(0);
  const [eventTab, setEventTab] = useState<'about' | 'members'>('about');
  const [eventMenu, setEventMenu] = useState(false);
  const [clubCat, setClubCat] = useState('Все');
  const [introSeen, setIntroSeen] = useState(() => {
    try {
      return localStorage.getItem('go_intro_seen') === '1';
    } catch {
      return false;
    }
  });
  const [confirm, setConfirm] = useState<{
    kind: 'leave' | 'delete';
    id: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [clubCreateOpen, setClubCreateOpen] = useState(false);
  const [clubCreating, setClubCreating] = useState(false);
  const [clubForm, setClubForm] = useState({
    title: '',
    description: '',
    category: 'Общение',
  });
  const [photoPosts, setPhotoPosts] = useState<ApiPhotoPost[]>([]);
  const [eventStep, setEventStep] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [clubJoined, setClubJoined] = useState<string[]>([]);
  const [viewPost, setViewPost] = useState<ApiPhotoPost | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [createStarted, setCreateStarted] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState<'all' | 'you' | 'near' | 'today' | 'week'>('all');
  const [onlyMyCity, setOnlyMyCity] = useState(false);
  const [cityOther, setCityOther] = useState(false);
  const [ageRange, setAgeRange] = useState<'any' | '1' | '2'>('any');
  const [personPosts, setPersonPosts] = useState<{
    uid: string;
    posts: ApiPhotoPost[];
  }>({
    uid: '',
    posts: [],
  });

  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    category: 'Встреча',
    date: '',
    time: '',
    place: '',
    capacity: '12',
  });

  const startX = useRef(0);
  const loadedRef = useRef(false);
  const joinBusy = useRef(new Set<string>());
  const cardRef = useRef<HTMLDivElement>(null);
  const hintNoRef = useRef<HTMLDivElement>(null);
  const hintYesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(0);
  const moved = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const postInputRef = useRef<HTMLInputElement>(null);

  const rankedPeople = [...people]
    .map((person) => ({
      person,
      score: scorePerson(profile, person).score,
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.person);

  const matchLine = (person: Person) => {
    const match = scorePerson(profile, person);

    return match.shared.length
      ? `Общее: ${match.shared.slice(0, 2).join(', ')}`
      : person.interests[0] || 'Новые знакомства';
  };

  const upcomingEvents: EventItem[] = events
    .filter((event) => isUpcoming(event.date))
    .map((event) => ({
      ...event,
      forYou: isForYou(profile, clubJoined, event, communityClubs),
      nearby: Boolean(
        profile?.city &&
        event.city &&
        norm(profile.city) === norm(event.city)
      ),
    }))
    .sort(
      (a, b) =>
        Number(Boolean(b.nearby)) - Number(Boolean(a.nearby)) ||
        `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
    );

  const filteredEvents = upcomingEvents.filter((event) =>
    eventFilter === 'all'
      ? true
      : eventFilter === 'you'
        ? Boolean(event.forYou)
        : eventFilter === 'near'
          ? Boolean(event.nearby)
          : eventFilter === 'today'
            ? event.date === todayStr()
            : withinDays(event.date, 7)
  );

  const passesFilters = (person: Person) => {
    if (
      onlyMyCity &&
      profile?.city &&
      norm(person.city) !== norm(profile.city)
    ) {
      return false;
    }

    if (
      ageRange !== 'any' &&
      profile &&
      Math.abs(person.age - profile.age) > Number(ageRange)
    ) {
      return false;
    }

    return true;
  };

  const swipePeople = rankedPeople.filter(passesFilters);

  const currentPerson = swipePeople.find((person) => {
    const search = peopleQuery.trim().toLowerCase();

    if (!search) return true;

    return [
      person.name,
      person.city,
      person.bio,
      ...person.interests,
    ].some((value) => value.toLowerCase().includes(search));
  });

  const unreadCount = notifications.filter(
    (item) => !item.read
  ).length;

  const currentMatch = currentPerson
    ? scorePerson(profile, currentPerson)
    : null;

  // Слабые устройства: отключаем backdrop-filter и анимации (класс .lite).
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };

    const weak =
      (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) ||
      (navigator.hardwareConcurrency !== undefined &&
        navigator.hardwareConcurrency <= 2);

    document.documentElement.classList.toggle('lite', weak);
  }, []);

  // Скрываем нижнюю панель, пока открыта клавиатура.
  useEffect(() => {
    const isField = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (
        target.tagName === 'TEXTAREA' ||
        (
          target.tagName === 'INPUT' &&
          !['file', 'checkbox', 'radio'].includes(
            (target as HTMLInputElement).type
          )
        )
      );

    const onIn = (event: FocusEvent) => {
      if (isField(event.target)) {
        setKbOpen(true);
      }
    };

    const onOut = () => {
      setTimeout(() => {
        setKbOpen(isField(document.activeElement));
      }, 80);
    };

    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);

    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timer = setTimeout(() => setNotice(''), 4000);

    return () => clearTimeout(timer);
  }, [notice]);

  // Telegram Mini App setup.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) return;

    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    tg.setHeaderColor?.('#0a0613');
    tg.setBackgroundColor?.('#0a0613');

    const telegramName = [
      tg.initDataUnsafe?.user?.first_name,
      tg.initDataUnsafe?.user?.last_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (telegramName) {
      setProfileForm((old) =>
        old.name
          ? old
          : { ...old, name: telegramName }
      );
    }
  }, []);

  // Telegram authentication.
  useEffect(() => {
    let cancelled = false;

    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData;

    if (!tg || !initData) {
      setAuthStatus('not-in-telegram');

      if (firebaseConfigured) {
        setNotice('Открой GO через Telegram');
      }

      return;
    }

    if (!firebaseConfigured) {
      setAuthStatus('error');
      setNotice('Firebase не настроен. Проверь GitHub Secrets.');
      return;
    }

    authenticateTelegram(initData)
      .then(() => {
        if (!cancelled) {
          setAuthStatus('signed-in');
        }
      })
      .catch((error: unknown) => {
        console.error('Telegram auth error:', error);

        if (!cancelled) {
          setAuthStatus('error');
          setBootError(`Не удалось войти: ${errorMessage(error)}`);
          setNotice(`Ошибка входа: ${errorMessage(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootNonce]);

  const refreshData = async () => {
    if (!firebaseConfigured || authStatus !== 'signed-in') return;

    setDataLoading(true);

    try {
      const data = await goGetData();
      const publicPeople = data.people.map(toPerson);

      setProfile(data.profile);
      setAllPeople(publicPeople);

      setPeople(
        publicPeople.filter(
          (person) => !(data.swipedUids || []).includes(person.uid)
        )
      );

      setEvents(
        data.events
          .map(toEvent)
          .sort((a, b) =>
            `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
          )
      );

      setMatches(data.matches || []);
      setNotifications(data.notifications || []);
      setClubJoined(data.clubMemberships || []);
      setClubCounts(data.clubCounts || {});
      setPhotoPosts(data.photoPosts || []);
      setCommunityClubs((data.clubs || []).map(toClub));
      setRegisteredUserCount(Number(data.totalUsers || 0));
      loadedRef.current = true;
      setBootError('');
      setInitialLoaded(true);

      if (data.profile) {
        setProfileForm({
          name: data.profile.name || '',
          age: String(data.profile.age || ''),
          city: data.profile.city || '',
          bio: data.profile.bio || '',
          interests: Array.isArray(data.profile.interests)
            ? data.profile.interests.join(', ')
            : '',
        });

        setCityOther(
          Boolean(data.profile.city) &&
          !CITIES.includes(data.profile.city)
        );

        setProfileEditing(false);
      } else {
        setProfileEditing(true);
      }
    } catch (error) {
      console.error('GO data loading error:', error);

      if (!loadedRef.current) {
        setBootError(`Не удалось загрузить данные: ${errorMessage(error)}`);
      } else {
        setNotice(`Не удалось загрузить данные: ${errorMessage(error)}`);
      }
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (authStatus === 'signed-in') {
      void refreshData();
    }

    // refreshData intentionally runs only when auth status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const syncEvents = async () => {
    try {
      const pulse = await goGetPulse();

      setEvents(
        (pulse.events || [])
          .map(toEvent)
          .sort((a, b) =>
            `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
          )
      );

      setNotifications(pulse.notifications || []);
    } catch (error) {
      console.warn('GO events sync failed:', error);
    }
  };

  // Лёгкий опрос: события и уведомления раз в 30 секунд, только пока
  // приложение открыто. Анкеты и мэтчи — когда изменился счётчик мэтчей,
  // при возврате в приложение и изредка по таймеру.
  useEffect(() => {
    if (authStatus !== 'signed-in' || !initialLoaded) return;

    let stopped = false;
    let inFlight = false;
    let ticks = 0;
    let lastMatchCount: number | null = null;
    let hiddenAt = 0;

    const pullFull = async () => {
      const data = await goGetLiveUpdates();

      if (stopped) return;

      const publicPeople = (data.people || []).map(toPerson);
      const swiped = data.swipedUids || [];

      setAllPeople(publicPeople);

      setPeople(
        publicPeople.filter((person) => !swiped.includes(person.uid))
      );

      setEvents(
        (data.events || [])
          .map(toEvent)
          .sort((a, b) =>
            `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
          )
      );

      setMatches(data.matches || []);
      setNotifications(data.notifications || []);
      setClubJoined(data.clubMemberships || []);
      setClubCounts(data.clubCounts || {});
      setCommunityClubs((data.clubs || []).map(toClub));
      setRegisteredUserCount(Number(data.totalUsers || 0));
    };

    const pull = async (full: boolean) => {
      if (
        stopped ||
        inFlight ||
        document.visibilityState === 'hidden'
      ) {
        return;
      }

      inFlight = true;

      try {
        if (full) {
          await pullFull();
          return;
        }

        const pulse = await goGetPulse();

        if (stopped) return;

        ticks += 1;

        if (joinBusy.current.size === 0) {
          setEvents(
            (pulse.events || [])
              .map(toEvent)
              .sort((a, b) =>
                `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
              )
          );
        }

        setNotifications(pulse.notifications || []);

        const matchesChanged =
          lastMatchCount !== null && pulse.matchCount !== lastMatchCount;

        lastMatchCount = pulse.matchCount;

        if (matchesChanged || ticks % 6 === 0) {
          await pullFull();
        }
      } catch (error) {
        console.warn('GO live refresh failed:', error);
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }

      void pull(hiddenAt > 0 && Date.now() - hiddenAt > 60000);
    };

    void pull(false);

    const timer = window.setInterval(() => void pull(false), 30000);

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopped = true;

      window.clearInterval(timer);

      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange
      );
    };
  }, [authStatus, initialLoaded]);

  // Telegram back button.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) return;

    const handleBack = () => {
      if (confirm) {
        if (!confirmBusy) setConfirm(null);
      } else if (groupId) {
        setGroupId(null);
      } else if (notificationsOpen) {
        setNotificationsOpen(false);
      } else if (viewPost) {
        setViewPost(null);
      } else if (eventsOpen) {
        setEventsOpen(false);
      } else if (detail) {
        setDetail(null);
      } else if (tab === 'create' && createStarted) {
        setCreateStarted(false);
      } else if (tab !== 'home') {
        setTab('home');
        setNotice('');
      }
    };

    if (
      confirm ||
      groupId ||
      detail ||
      notificationsOpen ||
      viewPost ||
      eventsOpen ||
      tab !== 'home'
    ) {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }

    tg.BackButton.onClick(handleBack);

    return () => tg.BackButton.offClick(handleBack);
  }, [detail, notificationsOpen, viewPost, eventsOpen, createStarted, tab, groupId, confirm, confirmBusy]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setNotice('');
    setDetail(null);
    setNotificationsOpen(false);
    setEventsOpen(false);
    setCreateStarted(false);
  };

  const startCreate = () => {
    changeTab('create');
    setCreateStarted(true);
  };

  const startEventInClub = (club: Club) => {
    const category = CATEGORIES.includes(club.category || '')
      ? (club.category as string)
      : 'Встреча';

    setEventForm((old) => ({
      ...old,
      category,
    }));

    setDetail(null);
    setTab('create');
    setCreateStarted(true);
  };

  const submitSwipe = async (
    person: Person,
    direction: 'left' | 'right'
  ) => {
    if (swipeLock) return;

    if (!firebaseConfigured || person.uid.startsWith('demo-')) {
      setPeople((old) =>
        old.filter((item) => item.uid !== person.uid)
      );

      setNotice(
        direction === 'right'
          ? `Интерес отмечен: ${person.name}. Демо-режим не сохраняет совпадения.`
          : 'Анкета пропущена'
      );

      setDetail(null);
      return;
    }

    if (authStatus !== 'signed-in') {
      setNotice('Сначала войди через Telegram');
      return;
    }

    if (!profile) {
      setNotice('Сначала заполни свою анкету в разделе «Профиль»');
      setDetail(null);
      setTab('profile');
      return;
    }

    setSwipeLock(true);

    try {
      const result = await goSwipe({
        targetUid: person.uid,
        direction,
      });

      setPeople((old) =>
        old.filter((item) => item.uid !== person.uid)
      );

      setDetail(null);

      setNotice(
        direction === 'right'
          ? result.matched
            ? `Есть взаимное совпадение с ${person.name}!`
            : `Интерес отправлен: ${person.name}`
          : 'Анкета пропущена'
      );

      if (result.matched) {
        await refreshData();
      }
    } catch (error) {
      setNotice(
        `Не удалось сохранить действие: ${errorMessage(error)}`
      );
    } finally {
      setSwipeLock(false);
      setSwipeDirection('');
      applyDrag(0, false);
    }
  };

  const finishSwipe = async (direction: 'left' | 'right') => {
    if (swipeDirection || swipeLock || !currentPerson) return;

    setSwipeDirection(direction);

    try {
      await submitSwipe(currentPerson, direction);
    } finally {
      setSwipeDirection('');
      applyDrag(0, false);
    }
  };

  // Перетаскивание карточки меняет DOM напрямую, без перерисовки всего App.
  const applyDrag = (value: number, animate: boolean) => {
    dragRef.current = value;

    const card = cardRef.current;

    if (card) {
      card.style.transition = animate
        ? 'transform .28s cubic-bezier(.2,.8,.2,1)'
        : 'none';
      card.style.transform = `translateX(${value}px) rotate(${value / 18}deg)`;
    }

    if (hintNoRef.current) {
      hintNoRef.current.style.opacity = String(
        Math.min(1, Math.max(0, -value / 90))
      );
    }

    if (hintYesRef.current) {
      hintYesRef.current.style.opacity = String(
        Math.min(1, Math.max(0, value / 90))
      );
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    startX.current = event.clientX;
    moved.current = false;

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startX.current && !swipeLock) {
      if (Math.abs(event.clientX - startX.current) > 6) {
        moved.current = true;
      }

      applyDrag(
        Math.max(
          -150,
          Math.min(150, event.clientX - startX.current)
        ),
        false
      );
    }
  };

  const onPointerUp = () => {
    if (!moved.current && currentPerson && !swipeLock) {
      startX.current = 0;
      applyDrag(0, true);
      openPerson(currentPerson.uid);
      return;
    }

    if (dragRef.current > 90) {
      void finishSwipe('right');
    } else if (dragRef.current < -90) {
      void finishSwipe('left');
    } else {
      applyDrag(0, true);
    }

    startX.current = 0;
  };

  const joinEvent = async (eventId: string) => {
    const item = events.find((event) => event.id === eventId);
    if (!item) return;

    if (!firebaseConfigured || eventId.startsWith('demo-')) {
      setEvents((old) =>
        old.map((event) =>
          event.id === eventId
            ? {
                ...event,
                joined: true,
                participantCount: event.joined
                  ? event.participantCount
                  : event.participantCount + 1,
                people: `${
                  event.joined
                    ? event.participantCount
                    : event.participantCount + 1
                } из ${event.capacity} участников`,
              }
            : event
        )
      );

      setNotice('Ты добавлен в список участников (демо-режим).');
      return;
    }

    if (authStatus !== 'signed-in') {
      setNotice('Сначала войди через Telegram');
      return;
    }

    if (
      item.joined ||
      joinBusy.current.has(eventId) ||
      item.participantCount >= item.capacity
    ) {
      return;
    }

    // Оптимистичное обновление: интерфейс отвечает сразу, при ошибке откатываем.
    joinBusy.current.add(eventId);

    setEvents((old) =>
      old.map((event) =>
        event.id === eventId
          ? withJoin(event, true, event.participantCount + 1)
          : event
      )
    );

    try {
      const result = await goJoinEvent({ eventId });

      setEvents((old) =>
        old.map((event) =>
          event.id === eventId
            ? withJoin(event, true, Number.isFinite(result.participantCount) ? result.participantCount : event.participantCount)
            : event
        )
      );

      setNotice(
        result.joined
          ? 'Ты добавлен в список участников.'
          : 'Ты уже участвуешь в этом событии.'
      );
    } catch (error) {
      setEvents((old) =>
        old.map((event) => (event.id === eventId ? item : event))
      );

      setNotice(
        `Не удалось присоединиться: ${errorMessage(error)}`
      );
    } finally {
      joinBusy.current.delete(eventId);
    }
  };

  const leaveEvent = async (eventId: string): Promise<boolean> => {
    const item = events.find((event) => event.id === eventId);
    if (!item) return false;

    if (!firebaseConfigured || eventId.startsWith('demo-')) {
      setEvents((old) =>
        old.map((event) =>
          event.id === eventId
            ? withJoin(event, false, event.participantCount - 1)
            : event
        )
      );

      setNotice('Ты вышел из события (демо-режим).');
      return true;
    }

    try {
      const result = await goLeaveEvent({ eventId });

      setEvents((old) =>
        old.map((event) =>
          event.id === eventId
            ? withJoin(event, false, Number.isFinite(result.participantCount) ? result.participantCount : event.participantCount - 1)
            : event
        )
      );

      setNotice('Ты вышел из события.');
      return true;
    } catch (error) {
      setNotice(`Не удалось выйти: ${errorMessage(error)}`);
      return false;
    }
  };

  const deleteEvent = async (eventId: string): Promise<boolean> => {
    if (!firebaseConfigured || eventId.startsWith('demo-')) {
      setEvents((old) => old.filter((event) => event.id !== eventId));
      setNotice('Событие удалено (демо-режим).');
      return true;
    }

    try {
      await goDeleteEvent({ eventId });

      setEvents((old) => old.filter((event) => event.id !== eventId));
      setNotice('Событие удалено.');
      return true;
    } catch (error) {
      setNotice(`Не удалось удалить событие: ${errorMessage(error)}`);
      return false;
    }
  };

  const runConfirm = async () => {
    if (!confirm || confirmBusy) return;

    setConfirmBusy(true);

    const ok =
      confirm.kind === 'leave'
        ? await leaveEvent(confirm.id)
        : await deleteEvent(confirm.id);

    setConfirmBusy(false);
    setConfirm(null);

    if (ok) {
      setGroupId(null);
      setDetail(null);
    }
  };

  const retryBoot = () => {
    setBootError('');

    if (authStatus === 'signed-in') {
      void refreshData();
      return;
    }

    setAuthStatus('checking');
    setBootNonce((value) => value + 1);
  };

  const createEvent = async () => {
    if (
      !eventForm.title.trim() ||
      !eventForm.description.trim() ||
      !eventForm.date ||
      !eventForm.time ||
      !eventForm.place.trim() ||
      !Number.isInteger(Number(eventForm.capacity)) ||
      Number(eventForm.capacity) < 2 ||
      Number(eventForm.capacity) > 200
    ) {
      setNotice('Заполни все поля события');
      return;
    }

    if (!firebaseConfigured || authStatus !== 'signed-in') {
      setNotice(
        'Для публикации события нужен вход через Telegram и Firebase'
      );
      return;
    }

    if (!profile) {
      setNotice('Сначала заполни свою анкету в разделе «Профиль»');
      setTab('profile');
      return;
    }

    try {
      await goCreateEvent({
        title: eventForm.title,
        description: eventForm.description,
        category: eventForm.category,
        date: eventForm.date,
        time: eventForm.time,
        place: eventForm.place,
        capacity: Number(eventForm.capacity),
      });

      setEventForm({
        title: '',
        description: '',
        category: 'Встреча',
        date: '',
        time: '',
        place: '',
        capacity: '12',
      });

      setEventStep(0);
      setCreateStarted(false);

      await refreshData();

      setNotice('Событие опубликовано. Ты добавлен в участники.');
      setTab('home');
    } catch (error) {
      setNotice(
        `Не удалось опубликовать событие: ${errorMessage(error)}`
      );
    }
  };

  const nextEventStep = () => {
    if (eventStep === 0 && !eventForm.title.trim()) {
      setNotice('Сначала придумай название события');
      return;
    }

    if (
      eventStep === 1 &&
      (
        !Number.isInteger(Number(eventForm.capacity)) ||
        Number(eventForm.capacity) < 2 ||
        Number(eventForm.capacity) > 200
      )
    ) {
      setNotice('Укажи от 2 до 200 участников');
      return;
    }

    if (eventStep === 2 && !eventForm.time) {
      setNotice('Выбери время встречи');
      return;
    }

    if (
      eventStep === 3 &&
      eventForm.date &&
      eventForm.date < todayStr()
    ) {
      setNotice('Эта дата уже прошла');
      return;
    }

    if (
      eventStep === 3 &&
      (!eventForm.date || !eventForm.place.trim())
    ) {
      setNotice('Укажи дату и публичное место встречи');
      return;
    }

    setEventStep((step) => Math.min(4, step + 1));
  };

  const previousEventStep = () =>
    setEventStep((step) => Math.max(0, step - 1));

  const toggleClub = async (clubId: string) => {
    if (!firebaseConfigured || authStatus !== 'signed-in') {
      setNotice(
        'Для вступления в сообщество нужен вход через Telegram'
      );
      return;
    }

    try {
      const result = await goToggleClub({ clubId });

      setClubJoined((old) =>
        result.joined
          ? [...new Set([...old, clubId])]
          : old.filter((id) => id !== clubId)
      );

      setClubCounts((old) => ({
        ...old,
        [clubId]: result.count,
      }));

      setNotice(
        result.joined
          ? 'Ты вступил в сообщество.'
          : 'Ты покинул сообщество.'
      );
    } catch (error) {
      setNotice(
        `Не удалось изменить участие: ${errorMessage(error)}`
      );
    }
  };

  const createClub = async () => {
    const title = clubForm.title.trim();
    const description = clubForm.description.trim();

    if (
      title.length < 3 ||
      !description ||
      description.length < 10
    ) {
      setNotice(
        'Укажи название от 3 символов и описание от 10 символов'
      );
      return;
    }

    if (authStatus !== 'signed-in' || !profile) {
      setNotice(
        'Сначала войди через Telegram и создай анкету'
      );
      return;
    }

    setClubCreating(true);

    try {
      await goCreateClub({
        title,
        description,
        category: clubForm.category,
      });

      setClubForm({
        title: '',
        description: '',
        category: 'Общение',
      });

      setClubCreateOpen(false);

      await refreshData();

      setNotice(
        'Сообщество создано. Ты автоматически вступил в него.'
      );
    } catch (error) {
      setNotice(
        `Не удалось создать сообщество: ${errorMessage(error)}`
      );
    } finally {
      setClubCreating(false);
    }
  };

  const saveProfile = async () => {
    const age = Number(profileForm.age);

    if (
      !profileForm.name.trim() ||
      !Number.isInteger(age) ||
      age < 13 ||
      age > 17
    ) {
      setNotice('Укажи имя и возраст от 13 до 17 лет');
      return;
    }

    if (authStatus !== 'signed-in') {
      setNotice('Для сохранения анкеты нужен вход через Telegram');
      return;
    }

    try {
      await goSaveProfile({
        name: profileForm.name.trim(),
        age,
        city: profileForm.city.trim(),
        bio: profileForm.bio.trim(),
        interests: profileForm.interests
          .split(/[,;\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
      });

      await refreshData();

      setNotice(
        'Анкета сохранена. Теперь тебя могут найти другие участники GO.'
      );

      setProfileEditing(false);
    } catch (error) {
      setNotice(
        `Не удалось сохранить анкету: ${errorMessage(error)}`
      );
    }
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;

    if (!profile || !storage || authStatus !== 'signed-in') {
      setNotice('Сначала сохрани анкету и войди через Telegram');
      return;
    }

    setPhotoBusy(true);

    try {
      const blob = await prepareImage(file);

      const imageRef = storageRef(
        storage,
        `profilePhotos/${profile.uid}/avatar/${Date.now()}.jpg`
      );

      const uploaded = await uploadBytes(
        imageRef,
        blob,
        { contentType: 'image/jpeg' }
      );

      const photoUrl = await getDownloadURL(uploaded.ref);

      await goSaveProfile({
        name: profile.name,
        age: profile.age,
        city: profile.city || '',
        bio: profile.bio || '',
        interests: profile.interests || [],
        photoUrl,
      });

      await refreshData();

      setNotice('Фото профиля обновлено');
    } catch (error) {
      setNotice(
        `Не удалось загрузить фото: ${errorMessage(error)}`
      );
    } finally {
      setPhotoBusy(false);

      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  const createPhotoPost = async (file: File | undefined) => {
    if (!file) return;

    if (!profile || !storage || authStatus !== 'signed-in') {
      setNotice('Сначала создай и сохрани анкету');
      return;
    }

    setPhotoBusy(true);

    try {
      const blob = await prepareImage(file);

      const imageRef = storageRef(
        storage,
        `profilePhotos/${profile.uid}/posts/${Date.now()}.jpg`
      );

      const uploaded = await uploadBytes(
        imageRef,
        blob,
        { contentType: 'image/jpeg' }
      );

      const photoUrl = await getDownloadURL(uploaded.ref);

      await goCreatePhotoPost({
        photoUrl,
        caption: '',
      });

      await refreshData();

      setNotice('Фото опубликовано в профиле');
    } catch (error) {
      setNotice(
        `Не удалось опубликовать фото: ${errorMessage(error)}`
      );
    } finally {
      setPhotoBusy(false);

      if (postInputRef.current) {
        postInputRef.current.value = '';
      }
    }
  };

  const deletePost = async (post: ApiPhotoPost) => {
    if (!window.confirm('Удалить публикацию?')) return;

    try {
      await goDeletePhotoPost({ postId: post.id });

      if (storage) {
        try {
          await deleteObject(storageRef(storage, post.photoUrl));
        } catch {
          // Файл мог уже удалиться.
        }
      }

      setViewPost(null);

      await refreshData();

      setNotice('Публикация удалена');
    } catch (error) {
      setNotice(
        `Не удалось удалить: ${errorMessage(error)}`
      );
    }
  };

  const openNotifications = async () => {
    setNotificationsOpen(true);

    const unreadIds = notifications
      .filter((item) => !item.read)
      .map((item) => item.id);

    if (
      unreadIds.length === 0 ||
      authStatus !== 'signed-in'
    ) {
      return;
    }

    try {
      await goMarkNotificationsRead({
        notificationIds: unreadIds,
      });

      setNotifications((old) =>
        old.map((item) => ({
          ...item,
          read: true,
        }))
      );
    } catch (error) {
      console.error(
        'Notification read status update failed:',
        error
      );
    }
  };

  const openPerson = (uid: string) => {
    setDetail({
      type: 'person',
      uid,
    });

    setPersonPosts({
      uid,
      posts: [],
    });

    if (uid.startsWith('tg_') && authStatus === 'signed-in') {
      goGetPosts({ targetUid: uid })
        .then((result) => {
          setPersonPosts({
            uid,
            posts: result.posts || [],
          });
        })
        .catch(() => undefined);
    }
  };

  const openEvent = (id: string) => {
    setDetail({
      type: 'event',
      id,
    });
  };

  const openClub = (id: string) => {
    setDetail({
      type: 'club',
      id,
    });
  };

  const openTelegramChat = (username: string) => {
    const clean = username.trim().replace(/^@/, '');

    if (!clean) return;

    const url = `https://t.me/${encodeURIComponent(clean)}`;
    const tg = window.Telegram?.WebApp;

    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const matchedPeople = matches
    .map((match) => {
      // Сервер уже передал профиль напрямую из документа мэтча.
      if (match.profile) {
        return toPerson(match.profile);
      }

      // Резервный вариант для старых записей.
      const otherUid = match.memberUids.find(
        (uid) => uid !== profile?.uid
      );

      return otherUid
        ? allPeople.find((person) => person.uid === otherUid)
        : undefined;
    })
    .filter(
      (person): person is Person => Boolean(person)
    );

  const detailPerson = detail?.type === 'person'
    ? allPeople.find((person) => person.uid === detail.uid) ||
      people.find((person) => person.uid === detail.uid)
    : undefined;

  const detailEvent = detail?.type === 'event'
    ? events.find((event) => event.id === detail.id)
    : undefined;

  const detailClub = detail?.type === 'club'
    ? communityClubs.find((club) => club.id === detail.id)
    : undefined;

  const clubEvents = detailClub
    ? upcomingEvents.filter(
        (event) => eventInClub(event, detailClub)
      )
    : [];

  const heroEvents = filteredEvents.slice(0, 3);
  const listEvents = filteredEvents.slice(3, 11);

  const eventFilters = [
    ['all', 'Все'],
    ['near', 'Рядом'],
    ['you', 'Для тебя'],
    ['today', 'Сегодня'],
    ['week', '7 дней'],
  ] as const;

  const detailMatch = detailPerson
    ? scorePerson(profile, detailPerson)
    : null;

  const detailIsMatched = detailPerson
    ? matchedPeople.some((person) => person.uid === detailPerson.uid)
    : false;

  const showSplash =
    !initialLoaded &&
    (authStatus === 'checking' ||
      authStatus === 'signed-in' ||
      (authStatus === 'error' && Boolean(bootError)));

  if (showSplash) {
    return <Splash error={bootError} onRetry={retryBoot} />;
  }

  if (!introSeen && authStatus === 'signed-in') {
    return (
      <Intro
        onDone={() => {
          try {
            localStorage.setItem('go_intro_seen', '1');
          } catch {
            // хранилище недоступно — покажем заставку снова в следующий раз
          }

          setIntroSeen(true);
        }}
      />
    );
  }

  const confirmEvent = confirm
    ? events.find((event) => event.id === confirm.id)
    : undefined;

  const shareEvent = async (event: EventItem) => {
    const text = `${event.title} — ${displayDate(event.date)}, ${event.time}, ${event.place}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Описание события скопировано.');
      }
    } catch {
      // пользователь закрыл окно «Поделиться»
    }
  };

  const visibleClubs = communityClubs.filter(
    (club) =>
      (clubCat === 'Все' || club.category === clubCat) &&
      (club.title.toLowerCase().includes(query.toLowerCase()) ||
        club.description.toLowerCase().includes(query.toLowerCase()))
  );

  const clubCategories = [
    'Все',
    ...Array.from(
      new Set(
        communityClubs
          .map((club) => club.category || '')
          .filter(Boolean)
      )
    ),
  ];

  return (
    <div className={`app-shell${kbOpen ? ' kb-open' : ''}`}>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => changeTab('home')}
          aria-label="На главную"
        >
          <span className="brand-g">
            G<i />
          </span>
        </button>

        <button
          className="icon-button top-action"
          aria-label="Уведомления"
          onClick={() => void openNotifications()}
        >
          <Bell size={19} />

          {unreadCount > 0 && (
            <span
              className="notif-dot"
              aria-label={`${unreadCount} непрочитанных`}
            />
          )}
        </button>
      </header>

      {!firebaseConfigured && (
        <div className="setup-banner">
          <span className="pulse" />
          Firebase не настроен: загрузка и публикация данных недоступны.
        </div>
      )}

      <main className="main-content">
        {tab === 'home' && (
          <section className="screen screen-home">
            {authStatus === 'signed-in' && !dataLoading && !profile && (
              <button
                className="onboard-card"
                onClick={() => changeTab('profile')}
              >
                <span className="onboard-icon">
                  <UserRound size={20} />
                </span>

                <span>
                  <b>Заполни анкету</b>
                  <small>
                    Так мы подберём людей и события по интересам и возрасту
                  </small>
                </span>

                <ChevronRight size={18} />
              </button>
            )}

            {heroEvents.length > 0 && (
              <div className="hero-wrap">
                <div
                  className="hero-track"
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    const index = Math.round(el.scrollLeft / el.clientWidth);

                    if (index !== heroIdx) setHeroIdx(index);
                  }}
                >
                  {heroEvents.map((event) => (
                    <EventTile
                      key={event.id}
                      event={event}
                      onOpen={openEvent}
                    />
                  ))}
                </div>

                {heroEvents.length > 1 && (
                  <div className="hero-dots" aria-hidden="true">
                    {heroEvents.map((event, index) => (
                      <i
                        key={event.id}
                        className={index === heroIdx ? 'on' : ''}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="chip-row chip-scroll">
              {eventFilters.map(([id, label]) => (
                <button
                  key={id}
                  className={`chip ${eventFilter === id ? 'on' : ''}`}
                  onClick={() => setEventFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {filteredEvents.length > 0 ? (
              listEvents.length > 0 && (
                <section className="section">
                  <div className="section-heading">
                    <h2>Ближайшие события</h2>

                    <button
                      className="text-button"
                      onClick={() => setEventsOpen(true)}
                    >
                      Смотреть все
                      <ArrowRight size={14} />
                    </button>
                  </div>

                  <div className="event-list">
                    {listEvents.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        onOpen={openEvent}
                      />
                    ))}
                  </div>
                </section>
              )
            ) : upcomingEvents.length > 0 ? (
              <div className="empty-card">
                <CalendarDays size={26} />
                <b>По этому фильтру ничего нет</b>
                <span>Попробуй другой фильтр или покажи все события</span>
                <button
                  className="primary"
                  onClick={() => setEventFilter('all')}
                >
                  Показать все
                </button>
              </div>
            ) : (
              <div className="empty-card">
                <CalendarDays size={26} />
                <b>Пока нет событий</b>
                <span>
                  Создай первое — другие участники увидят его здесь
                </span>
                <button className="primary" onClick={startCreate}>
                  Создать событие
                </button>
              </div>
            )}

            <div className="quick-actions">
              <button onClick={() => changeTab('people')}>
                <Users size={19} />
                <span>Найти людей</span>
              </button>

              <button onClick={startCreate}>
                <Plus size={19} />
                <span>Создать событие</span>
              </button>

              <button onClick={() => changeTab('communities')}>
                <UsersRound size={19} />
                <span>Клубы</span>
              </button>
            </div>

            <section className="section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">ПОДОБРАНО ДЛЯ ТЕБЯ</div>
                  <h2>Люди для команды</h2>
                </div>

                <button
                  className="text-button"
                  onClick={() => changeTab('people')}
                >
                  Смотреть
                  <ArrowUpRight size={14} />
                </button>
              </div>

              <div className="people-preview">
                {rankedPeople.slice(0, 3).map((person) => {
                  const match = scorePerson(profile, person);

                  return (
                    <button
                      className="mini-person"
                      key={person.uid}
                      onClick={() => {
                        setTab('people');
                        openPerson(person.uid);
                      }}
                    >
                      <span className={`mini-avatar ${person.color}`}>
                        {person.photoUrl ? (
                          <img src={person.photoUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                          person.initials
                        )}
                      </span>

                      <span>
                        <b>{person.name}, {person.age}</b>
                        <small>{matchLine(person)}</small>
                      </span>

                      {match.percent > 0 && (
                        <i className="match-pill">
                          {match.percent}%
                        </i>
                      )}

                      <ChevronRight size={17} />
                    </button>
                  );
                })}

                {rankedPeople.length === 0 && (
                  <p className="muted">
                    Новых анкет пока нет. Загляни позже.
                  </p>
                )}
              </div>
            </section>
          </section>
        )}

        {tab === 'people' && (
          <section className="screen people-page">
            <div className="eyebrow">
              СОВПАДЕНИЕ ПО ИНТЕРЕСАМ
            </div>

            <div className="title-row">
              <div>
                <h1 className="page-title">
                  Твоя будущая<br />
                  <span>команда.</span>
                </h1>

                <p className="muted">
                  Свайпай анкеты, чтобы найти компанию.
                </p>
              </div>

              <button
                className="filter-button"
                aria-label="Фильтры"
                onClick={() => setShowFilters((value) => !value)}
              >
                <SlidersHorizontal size={19} />
              </button>
            </div>

            {showFilters && (
              <>
                <div className="community-search">
                  <Search size={18} />

                  <input
                    value={peopleQuery}
                    onChange={(event) => setPeopleQuery(event.target.value)}
                    placeholder="Имя, город или интерес"
                  />
                </div>

                <div className="chip-row filters-row">
                  <button
                    className={`chip ${onlyMyCity ? 'on' : ''}`}
                    disabled={!profile?.city}
                    onClick={() => setOnlyMyCity((value) => !value)}
                  >
                    <MapPin size={12} />
                    Рядом: мой город
                  </button>

                  {([
                    ['any', 'Любой возраст'],
                    ['1', '±1 год'],
                    ['2', '±2 года'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      className={`chip ${ageRange === id ? 'on' : ''}`}
                      onClick={() => setAgeRange(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {matchedPeople.length > 0 && (
              <section className="section">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">
                      ВЗАИМНЫЙ ИНТЕРЕС
                    </div>
                    <h2>Совпадения</h2>
                  </div>
                </div>

                <div className="people-preview">
                  {matchedPeople.map((person) => (
                    <div
                      className="mini-person match-person"
                      key={person.uid}
                    >
                      <span
                        className={`mini-avatar ${person.color}`}
                        onClick={() => openPerson(person.uid)}
                        role="button"
                        tabIndex={0}
                      >
                        {person.photoUrl ? (
                          <img src={person.photoUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                          person.initials
                        )}
                      </span>

                      <span
                        className="match-person-info"
                        onClick={() => openPerson(person.uid)}
                        role="button"
                        tabIndex={0}
                      >
                        <b>{person.name}, {person.age}</b>
                        <small>
                          {person.username
                            ? `@${person.username}`
                            : 'Telegram username не указан или скрыт'}
                        </small>
                      </span>

                      {person.username ? (
                        <button
                          className="ig-btn ig-btn-accent match-message"
                          type="button"
                          onClick={() => openTelegramChat(person.username || '')}
                          aria-label={`Написать ${person.name}`}
                        >
                          <Send size={15} />
                          Написать
                        </button>
                      ) : (
                        <Check size={17} />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {currentPerson ? (
              <>
                <div className="swipe-stage">
                  <div
                    className="swipe-hint hint-no"
                    ref={hintNoRef}
                    style={{ opacity: 0 }}
                  >
                    ПРОПУСК
                  </div>

                  <div
                    className="swipe-hint hint-yes"
                    ref={hintYesRef}
                    style={{ opacity: 0 }}
                  >
                    ИНТЕРЕСНО
                  </div>

                  <div
                    className="person-card"
                    key={currentPerson.uid}
                    ref={cardRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                      applyDrag(0, true);
                      startX.current = 0;
                    }}
                    style={
                      swipeDirection
                        ? {
                            transform: `translateX(${
                              swipeDirection === 'right' ? 520 : -520
                            }px) rotate(${
                              swipeDirection === 'right' ? 18 : -18
                            }deg)`,
                            transition: 'transform .23s ease-in',
                          }
                        : undefined
                    }
                  >
                    <div className={`person-art ${currentPerson.color}`}>
                      <div className="person-art-orb" />

                      {currentPerson.photoUrl ? (
                        <img
                          className="person-photo"
                          src={currentPerson.photoUrl}
                          alt={currentPerson.name}
                          draggable={false}
                        />
                      ) : (
                        <div className="person-avatar">
                          {currentPerson.initials}
                        </div>
                      )}

                      <div className="person-shade" />

                      <div className="person-badges">
                        <span className="person-number">
                          <Sparkles size={11} />
                          {currentMatch && currentMatch.percent > 0
                            ? `${currentMatch.percent}% совпадение`
                            : 'GO'}
                        </span>

                        {Boolean(profile?.city) &&
                          norm(profile?.city || '') === norm(currentPerson.city) && (
                            <span className="person-near">
                              <MapPin size={11} />
                              В твоём городе
                            </span>
                          )}
                      </div>

                      <div className="person-overlay">
                        <h2>
                          {currentPerson.name}
                          <span>, {currentPerson.age}</span>
                        </h2>

                        <div className="person-meta">
                          <span className="online-pill">
                            <i />
                            В поиске компании
                          </span>

                          <span className="person-location">
                            <MapPin size={12} />
                            {currentPerson.city}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="person-info">
                      {currentPerson.interests.length > 0 && (
                        <div className="tags">
                          {currentPerson.interests.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className={
                                currentMatch?.shared.some(
                                  (shared) => sameInterest(shared, tag)
                                )
                                  ? 'tag-shared'
                                  : ''
                              }
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <button className="profile-open" type="button">
                        Открыть анкету
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="swipe-actions">
                  <button
                    className="skip"
                    onClick={() => void finishSwipe('left')}
                    aria-label="Пропустить"
                    disabled={swipeLock}
                  >
                    <X size={23} />
                  </button>

                  <button
                    className="like"
                    onClick={() => void finishSwipe('right')}
                    aria-label="Найти компанию"
                    disabled={swipeLock}
                  >
                    <Users size={20} />
                    <span>Найти компанию</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="section">
                <div className="placeholder-icon">
                  <UsersRound size={27} />
                </div>

                <h2>
                  {people.length === 0
                    ? 'Пока больше никого нет.'
                    : 'Нет анкет по этому запросу.'}
                </h2>

                <p className="muted">
                  Новые участники появятся здесь после заполнения своих анкет.
                </p>

                {(peopleQuery || onlyMyCity || ageRange !== 'any') && (
                  <button
                    className="primary"
                    onClick={() => {
                      setPeopleQuery('');
                      setOnlyMyCity(false);
                      setAgeRange('any');
                    }}
                  >
                    Сбросить фильтры
                  </button>
                )}
              </div>
            )}

            <p className="safety-note">
              GO — для дружбы, общих интересов и совместных активностей.
            </p>
          </section>
        )}

        {tab === 'create' && (
          <section className="screen placeholder-page create-page">
            {!createStarted ? (
              <>
                <div className="eyebrow">
                  ТВОЯ ИДЕЯ — ТВОЁ СОБЫТИЕ
                </div>

                <h1 className="page-title">
                  Создай<br />
                  <span>движение.</span>
                </h1>

                <p>
                  Собери людей на игру, прогулку или проект. Это займёт минуту.
                </p>

                <div className="create-steps">
                  {[
                    'Название',
                    'Участники',
                    'Время',
                    'Дата и место',
                    'Описание',
                  ].map((label, index) => (
                    <div key={label}>
                      <b>{index + 1}</b>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>

                <button
                  className="primary full"
                  onClick={() => setCreateStarted(true)}
                >
                  Создать событие
                  <ArrowRight size={16} />
                </button>

                <p className="safety-note">
                  Встречайтесь в общественных местах. Не публикуй домашние адреса.
                </p>
              </>
            ) : (
              <>
                <div className="wizard-heading">
                  <span>ШАГ {eventStep + 1} ИЗ 5</span>                  <b>
                    {[
                      'Название',
                      'Участники',
                      'Время',
                      'Дата и место',
                      'Описание',
                    ][eventStep]}
                  </b>
                </div>

                <div
                  className="wizard-progress"
                  aria-label={`Шаг ${eventStep + 1} из 5`}
                >
                  {[0, 1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={step <= eventStep ? 'filled' : ''}
                    />
                  ))}
                </div>

                <div className="wizard-card" key={eventStep}>
                  {eventStep === 0 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">01</div>

                      <h2>Как назовём встречу?</h2>

                      <p>
                        Название должно коротко объяснять,
                        что вы собираетесь делать.
                      </p>

                      <label>
                        Название события
                        <input
                          autoFocus
                          value={eventForm.title}
                          onChange={(event) =>
                            setEventForm((old) => ({
                              ...old,
                              title: event.target.value,
                            }))
                          }
                          placeholder="Например, прогулка и фото"
                          maxLength={70}
                        />
                      </label>
                    </div>
                  )}

                  {eventStep === 1 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">02</div>

                      <h2>Сколько человек собираем?</h2>

                      <p>
                        Ты автоматически попадёшь в список участников после публикации.
                      </p>

                      <label>
                        Максимум участников
                        <input
                          inputMode="numeric"
                          type="number"
                          min="2"
                          max="200"
                          value={eventForm.capacity}
                          onChange={(event) =>
                            setEventForm((old) => ({
                              ...old,
                              capacity: event.target.value,
                            }))
                          }
                          placeholder="12"
                        />
                      </label>

                      <span className="wizard-hint">
                        От 2 до 200 человек
                      </span>
                    </div>
                  )}

                  {eventStep === 2 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">03</div>

                      <h2>Во сколько встречаемся?</h2>

                      <p>
                        Выбери время начала встречи.
                      </p>

                      <label>
                        Время
                        <input
                          type="time"
                          value={eventForm.time}
                          onChange={(event) =>
                            setEventForm((old) => ({
                              ...old,
                              time: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}

                  {eventStep === 3 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">04</div>

                      <h2>Где и когда?</h2>

                      <p>
                        Укажи общественное место, доступное всем участникам.
                      </p>

                      <label>
                        Дата
                        <input
                          type="date"
                          min={todayStr()}
                          value={eventForm.date}
                          onChange={(event) =>
                            setEventForm((old) => ({
                              ...old,
                              date: event.target.value,
                            }))
                          }
                        />
                      </label>

                      <label>
                        Публичное место встречи
                        <input
                          value={eventForm.place}
                          onChange={(event) =>
                            setEventForm((old) => ({
                              ...old,
                              place: event.target.value,
                            }))
                          }
                          placeholder="Например, городской парк"
                          maxLength={100}
                        />
                      </label>

                      <span className="wizard-hint">
                        Не указывай домашний адрес. Город события берётся из твоей анкеты.
                      </span>
                    </div>
                  )}

                  {eventStep === 4 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">05</div>

                      <h2>Расскажи подробности</h2>

                      <p>
                        Что будете делать и кому подойдёт встреча?
                      </p>

                      <label>
                        Описание
                        <textarea
                          value={eventForm.description}
                          onChange={(event) =>
                            setEventForm((old) => ({
                              ...old,
                              description: event.target.value,
                            }))
                          }
                          placeholder="Расскажи немного о встрече..."
                          rows={4}
                          maxLength={500}
                        />
                      </label>

                      <div className="chip-label">
                        Категория — по ней событие попадёт в клуб и рекомендации
                      </div>

                      <div className="chip-row">
                        {CATEGORIES.map((category) => (
                          <button
                            type="button"
                            key={category}
                            className={
                              `chip ${
                                eventForm.category === category ? 'on' : ''
                              }`
                            }
                            onClick={() =>
                              setEventForm((old) => ({
                                ...old,
                                category,
                              }))
                            }
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="wizard-actions">
                  <button
                    className="wizard-back"
                    onClick={
                      eventStep === 0
                        ? () => setCreateStarted(false)
                        : previousEventStep
                    }
                  >
                    {eventStep === 0 ? 'Отмена' : 'Назад'}
                  </button>

                  {eventStep < 4 ? (
                    <button
                      className="primary wizard-next"
                      onClick={nextEventStep}
                    >
                      Далее
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      className="primary wizard-next"
                      onClick={() => void createEvent()}
                      disabled={dataLoading || photoBusy}
                    >
                      Опубликовать
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'communities' && (
          <section className="screen communities-page">
            <h1 className="page-title">Клубы и сообщества</h1>

            <p className="muted small">
              В GO уже {registeredUserCount} участников
            </p>

            <div className="community-search">
              <Search size={18} />

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск сообществ"
              />
            </div>

            <div className="chip-row chip-scroll">
              {clubCategories.map((category) => (
                <button
                  key={category}
                  className={`chip ${clubCat === category ? 'on' : ''}`}
                  onClick={() => setClubCat(category)}
                >
                  {category}
                </button>
              ))}
            </div>

            <button
              className="primary full community-add-button"
              onClick={() => setClubCreateOpen((open) => !open)}
            >
              <Plus size={16} />
              {clubCreateOpen
                ? 'Скрыть форму'
                : 'Создать сообщество'}
            </button>

            {clubCreateOpen && (
              <div className="form-preview community-create-form">
                <label>
                  Название сообщества
                  <input
                    value={clubForm.title}
                    onChange={(event) =>
                      setClubForm((old) => ({
                        ...old,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Например, любители кино"
                    maxLength={40}
                  />
                </label>

                <label>
                  Категория
                  <select
                    value={clubForm.category}
                    onChange={(event) =>
                      setClubForm((old) => ({
                        ...old,
                        category: event.target.value,
                      }))
                    }
                  >
                    {CLUB_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Описание
                  <textarea
                    value={clubForm.description}
                    onChange={(event) =>
                      setClubForm((old) => ({
                        ...old,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Чем занимается сообщество и кого вы ищете?"
                    rows={3}
                    maxLength={300}
                  />
                </label>

                <button
                  className="primary full"
                  onClick={() => void createClub()}
                  disabled={clubCreating}
                >
                  {clubCreating
                    ? 'Создаём…'
                    : 'Опубликовать сообщество'}
                  <Plus size={16} />
                </button>
              </div>
            )}

            <div className="community-list">
              {visibleClubs.map((club) => (
                <div
                  className="community-card"
                  key={club.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openClub(club.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openClub(club.id);
                  }}
                >
                  <span className={`community-thumb ${club.icon}`}>
                    <EventArt category={club.category || ''} />
                    <span className="community-thumb-icon">
                      <ClubIcon id={club.icon} size={22} />
                    </span>
                  </span>

                  <span className="community-copy">
                    <b>{club.title}</b>

                    <small>
                      {Number(clubCounts[club.id] || 0)} участников
                      {' · '}
                      {
                        upcomingEvents.filter(
                          (event) => eventInClub(event, club)
                        ).length
                      } событий
                    </small>

                    <span className="community-actions">
                      <button
                        className={`join-pill${
                          clubJoined.includes(club.id) ? ' on' : ''
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleClub(club.id);
                        }}
                      >
                        {clubJoined.includes(club.id) ? 'Ты в клубе' : 'Вступить'}
                      </button>
                    </span>
                  </span>

                  <ChevronRight size={18} />
                </div>
              ))}

              {visibleClubs.length === 0 && (
                <p className="muted">
                  Сообщества не найдены.
                </p>
              )}
            </div>
          </section>
        )}

        {tab === 'profile' && (
          <section className="screen ig-profile">
            <input
              ref={avatarInputRef}
              className="visually-hidden-input"
              type="file"
              accept="image/*"
              onChange={(event) =>
                void uploadAvatar(event.target.files?.[0])
              }
            />

            <input
              ref={postInputRef}
              className="visually-hidden-input"
              type="file"
              accept="image/*"
              onChange={(event) =>
                void createPhotoPost(event.target.files?.[0])
              }
            />

            {profile && !profileEditing ? (
              <>
                <div className="ig-head">
                  <button
                    className="ig-avatar-ring"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={photoBusy}
                    aria-label="Сменить фото профиля"
                  >
                    <span className="ig-avatar">
                      {profile.photoUrl ? (
                        <img src={profile.photoUrl} alt="" />
                      ) : (
                        initialsFor(profile.name)
                      )}
                    </span>

                    <span className="ig-avatar-plus">
                      <Camera size={13} />
                    </span>
                  </button>

                  <div className="ig-stats">
                    <div>
                      <b>{photoPosts.length}</b>
                      <span>публикации</span>
                    </div>

                    <div>
                      <b>{matches.length}</b>
                      <span>совпадения</span>
                    </div>

                    <div>
                      <b>{events.filter((event) => event.joined).length}</b>
                      <span>события</span>
                    </div>
                  </div>
                </div>

                <div className="ig-bio">
                  <h1>
                    {profile.name}, {profile.age}
                  </h1>

                  {profile.city && (
                    <div className="ig-city">
                      <MapPin size={13} />
                      {profile.city}
                    </div>
                  )}

                  <p>
                    {profile.bio || 'Добавь пару слов о себе.'}
                  </p>

                  {(profile.interests || []).length > 0 && (
                    <div className="tags">
                      {profile.interests.map((interest) => (
                        <span key={interest}>
                          {interest}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="ig-actions">
                  <button
                    className="ig-btn"
                    onClick={() => setProfileEditing(true)}
                  >
                    <Settings size={15} />
                    Изменить анкету
                  </button>

                  <button
                    className="ig-btn ig-btn-accent"
                    onClick={() => postInputRef.current?.click()}
                    disabled={photoBusy}
                  >
                    <Plus size={15} />
                    {photoBusy ? 'Загрузка…' : 'Фото'}
                  </button>
                </div>

                <div className="ig-tab">
                  <LayoutGrid size={20} />
                </div>

                {photoPosts.length > 0 ? (
                  <div className="ig-grid">
                    {photoPosts.map((post) => (
                      <button
                        className="ig-tile"
                        key={post.id}
                        onClick={() => setViewPost(post)}
                      >
                        <img
                          src={post.photoUrl}
                          alt={post.caption || 'Публикация'}
                          loading="lazy"
                          decoding="async"
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="ig-empty">
                    <div className="ig-empty-icon">
                      <Camera size={26} />
                    </div>

                    <b>Пока нет публикаций</b>

                    <span>
                      Поделись первым фото — оно появится здесь
                    </span>

                    <button
                      className="primary"
                      onClick={() => postInputRef.current?.click()}
                    >
                      Опубликовать фото
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="eyebrow">ТВОЯ АНКЕТА</div>

                <h1 className="page-title">
                  {profile ? 'Изменить' : 'Расскажи'}<br />
                  <span>о себе.</span>
                </h1>

                <div className="form-preview">
                  {profile && (
                    <button
                      type="button"
                      className="avatar-upload-button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={photoBusy}
                    >
                      <Camera size={17} />
                      {photoBusy
                        ? 'Загружаем фото...'
                        : 'Изменить фото профиля'}
                    </button>
                  )}

                  <label>
                    Имя
                    <input
                      value={profileForm.name}
                      onChange={(event) =>
                        setProfileForm((old) => ({
                          ...old,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Как тебя зовут?"
                      maxLength={40}
                    />
                  </label>

                  <label>
                    Возраст (13–17)
                    <input
                      type="number"
                      min="13"
                      max="17"
                      value={profileForm.age}
                      onChange={(event) =>
                        setProfileForm((old) => ({
                          ...old,
                          age: event.target.value,
                        }))
                      }
                      placeholder="Например, 16"
                    />
                  </label>

                  <label>
                    Город
                    <select
                      value={cityOther ? '__other' : profileForm.city}
                      onChange={(event) => {
                        const value = event.target.value;

                        if (value === '__other') {
                          setCityOther(true);

                          setProfileForm((old) => ({
                            ...old,
                            city: '',
                          }));
                        } else {
                          setCityOther(false);

                          setProfileForm((old) => ({
                            ...old,
                            city: value,
                          }));
                        }
                      }}
                    >
                      <option value="">Выбери город</option>

                      {CITIES.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}

                      <option value="__other">
                        Другой город…
                      </option>
                    </select>
                  </label>

                  {cityOther && (
                    <label>
                      Название города
                      <input
                        value={profileForm.city}
                        onChange={(event) =>
                          setProfileForm((old) => ({
                            ...old,
                            city: event.target.value,
                          }))
                        }
                        placeholder="Например, Тарко-Сале"
                        maxLength={60}
                      />
                    </label>
                  )}

                  <label>
                    О себе
                    <textarea
                      value={profileForm.bio}
                      onChange={(event) =>
                        setProfileForm((old) => ({
                          ...old,
                          bio: event.target.value,
                        }))
                      }
                      placeholder="Расскажи, что тебе интересно..."
                      rows={3}
                      maxLength={300}
                    />
                  </label>

                  <label>
                    Интересы через запятую
                    <input
                      value={profileForm.interests}
                      onChange={(event) =>
                        setProfileForm((old) => ({
                          ...old,
                          interests: event.target.value,
                        }))
                      }
                      placeholder="Музыка, игры, прогулки"
                    />
                  </label>

                  <button
                    className="primary"
                    onClick={() => void saveProfile()}
                    disabled={photoBusy}
                  >
                    Сохранить
                    <Check size={16} />
                  </button>

                  {profile && (
                    <button
                      className="text-button"
                      onClick={() => setProfileEditing(false)}
                    >
                      Отмена
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {notice && (
        <button
          className="toast"
          onClick={() => setNotice('')}
        >
          <Check size={16} />
          {notice}
          <X size={15} />
        </button>
      )}

      <nav className="bottom-nav" aria-label="Основная навигация">
        {nav.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`${tab === id ? 'active' : ''}${id === 'create' ? ' nav-create' : ''}`}
            onClick={() => changeTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            <span className="nav-icon">
              <Icon
                size={20}
                strokeWidth={tab === id ? 2.4 : 1.8}
              />
            </span>

            <span>{label}</span>
          </button>
        ))}
      </nav>

      {groupId && profile && (
        <Suspense
          fallback={
            <div className="group-screen">
              <div className="group-state">Загрузка…</div>
            </div>
          }
        >
          <GroupScreen
            eventId={groupId}
            fallbackTitle={
              events.find((event) => event.id === groupId)?.title ||
              'Событие'
            }
            me={profile}
            onClose={() => setGroupId(null)}
            onAccessLost={(message) => {
              setGroupId(null);
              setNotice(message);
              void syncEvents();
            }}
            onLeave={() => setConfirm({ kind: 'leave', id: groupId })}
            onDelete={() => setConfirm({ kind: 'delete', id: groupId })}
            onCountChange={(eventId, count) =>
              setEvents((old) =>
                old.map((event) =>
                  event.id === eventId
                    ? { ...event, participantCount: count, people: `${count} из ${event.capacity} участников` }
                    : event
                )
              )
            }
          />
        </Suspense>
      )}

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'leave'
              ? 'Покинуть событие?'
              : 'Удалить событие?'
          }
          text={
            confirm.kind === 'leave'
              ? `Ты выйдешь из «${confirmEvent?.title || 'события'}» и потеряешь доступ к чату группы.`
              : `«${confirmEvent?.title || 'Событие'}» исчезнет у всех участников вместе с перепиской. Это действие нельзя отменить.`
          }
          confirmLabel={confirm.kind === 'leave' ? 'Покинуть' : 'Удалить'}
          busy={confirmBusy}
          onConfirm={() => void runConfirm()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {detail?.type === 'event' && detailEvent && (
        <div className="fs-screen event-page">
          <div className="ep-cover">
            <EventArt category={detailEvent.category} />
            <div className="ep-shade" />

            <div className="ep-bar">
              <button
                className="ep-btn"
                onClick={() => {
                  setEventMenu(false);
                  setDetail(null);
                }}
                aria-label="Назад"
              >
                <ChevronLeft size={22} />
              </button>

              <span className="ep-bar-right">
                <button
                  className="ep-btn"
                  onClick={() => void shareEvent(detailEvent)}
                  aria-label="Поделиться"
                >
                  <Share2 size={18} />
                </button>

                <button
                  className="ep-btn"
                  onClick={() => setEventMenu((open) => !open)}
                  aria-label="Ещё"
                >
                  <Ellipsis size={20} />
                </button>
              </span>
            </div>

            {eventMenu && (
              <div className="ep-menu">
                <button
                  onClick={() => {
                    setEventMenu(false);
                    void shareEvent(detailEvent);
                  }}
                >
                  <Share2 size={15} />
                  Поделиться
                </button>

                {detailEvent.joined &&
                  Boolean(profile?.uid) &&
                  detailEvent.createdBy !== profile?.uid && (
                    <button
                      className="danger"
                      onClick={() => {
                        setEventMenu(false);
                        setConfirm({ kind: 'leave', id: detailEvent.id });
                      }}
                    >
                      <LogOut size={15} />
                      Покинуть событие
                    </button>
                  )}

                {Boolean(profile?.uid) &&
                  detailEvent.createdBy === profile?.uid && (
                    <button
                      className="danger"
                      onClick={() => {
                        setEventMenu(false);
                        setConfirm({ kind: 'delete', id: detailEvent.id });
                      }}
                    >
                      <Trash2 size={15} />
                      Удалить событие
                    </button>
                  )}
              </div>
            )}

            <DateBadge date={detailEvent.date} />
          </div>

          <div className="ep-body">
            <div className="eyebrow">{detailEvent.category}</div>

            <h1>{detailEvent.title}</h1>

            <div className="ep-facts">
              <span>
                <MapPin size={16} />
                {detailEvent.place}
              </span>

              <span>
                <Clock3 size={16} />
                {displayDate(detailEvent.date)} · {detailEvent.time}
              </span>
            </div>

            <div className="ep-people">
              <AvatarStack count={detailEvent.participantCount} />
              <span>{detailEvent.people}</span>
            </div>

            <p className="ep-desc">{detailEvent.description}</p>

            {!detailEvent.joined && (
              <button
                className="ep-cta"
                onClick={() => void joinEvent(detailEvent.id)}
                disabled={
                  detailEvent.participantCount >= detailEvent.capacity
                }
              >
                {detailEvent.participantCount >= detailEvent.capacity
                  ? 'Мест больше нет'
                  : 'Присоединиться'}
              </button>
            )}

            {detailEvent.joined &&
              !detailEvent.id.startsWith('demo-') && (
                <button
                  className="ep-cta"
                  onClick={() => {
                    if (joinBusy.current.has(detailEvent.id)) {
                      setNotice('Подожди секунду — присоединяемся…');
                      return;
                    }

                    setGroupId(detailEvent.id);
                    setDetail(null);
                  }}
                >
                  <MessageCircle size={18} />
                  Открыть группу
                </button>
              )}

            <div className="ep-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={eventTab === 'about'}
                className={eventTab === 'about' ? 'on' : ''}
                onClick={() => setEventTab('about')}
              >
                О событии
              </button>

              <button
                role="tab"
                aria-selected={eventTab === 'members'}
                className={eventTab === 'members' ? 'on' : ''}
                onClick={() => setEventTab('members')}
              >
                Участники
              </button>
            </div>

            {eventTab === 'about' ? (
              <div className="ep-panel">
                <div className="ep-row">
                  <CalendarDays size={16} />
                  <span>
                    {displayDate(detailEvent.date)}, {detailEvent.time}
                  </span>
                </div>

                <div className="ep-row">
                  <MapPin size={16} />
                  <span>{detailEvent.place}</span>
                </div>

                {detailEvent.city && (
                  <div className="ep-row">
                    <Compass size={16} />
                    <span>{detailEvent.city}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="ep-panel">
                <div className="fill-bar">
                  <i
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (detailEvent.participantCount /
                            Math.max(1, detailEvent.capacity)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>

                <p className="muted">
                  {detailEvent.joined
                    ? 'Полный список участников — в группе события.'
                    : 'Список участников откроется после вступления в событие.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {detail?.type === 'club' && (
        <div
          className="detail-backdrop"
          onClick={() => setDetail(null)}
        >
          <section
            className="detail-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-handle" />

            <button
              className="detail-close"
              onClick={() => setDetail(null)}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>


            {detail.type === 'club' && detailClub && (
              <div className="detail-content club-detail">
                <div className={`community-symbol big ${detailClub.icon}`}>
                  <ClubIcon id={detailClub.icon} size={28} />
                </div>

                <div className="eyebrow">
                  КЛУБ GO
                </div>

                <h1>{detailClub.title}</h1>

                <div className="muted">
                  {Number(clubCounts[detailClub.id] || 0)} участников
                </div>

                <p>{detailClub.description}</p>

                <div className="club-benefits">
                  {detailClub.perks.map((perk) => (
                    <span key={perk}>
                      <Check size={15} />
                      {perk}
                    </span>
                  ))}
                </div>

                <h3>События клуба</h3>

                {clubEvents.length > 0 ? (
                  <div className="people-preview">
                    {clubEvents.slice(0, 4).map((event) => (
                      <button
                        className="mini-person"
                        key={event.id}
                        onClick={() => openEvent(event.id)}
                      >
                        <span className={`mini-avatar event-${event.color}`}>
                          <CalendarDays size={18} />
                        </span>

                        <span>
                          <b>{event.title}</b>
                          <small>
                            {displayDate(event.date)} · {event.time} · {event.place}
                          </small>
                        </span>

                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    Пока нет событий. Создай первое для этого клуба.
                  </p>
                )}

                <button
                  className="primary full"
                  onClick={() => void toggleClub(detailClub.id)}
                >
                  {clubJoined.includes(detailClub.id)
                    ? 'Покинуть клуб'
                    : 'Вступить в клуб'}

                  <ArrowRight size={17} />
                </button>

                <button
                  className="ig-btn club-create"
                  onClick={() => startEventInClub(detailClub)}
                >
                  <Plus size={15} />
                  Создать событие в клубе
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {detail?.type === 'person' && detailPerson && (
        <div className="fs-screen" role="dialog" aria-modal="true">
          <button
            className="fs-back"
            onClick={() => setDetail(null)}
            aria-label="Назад"
          >
            <ChevronLeft size={22} />
          </button>

          <div className="fs-inner">
            <div className="fs-hero">
              <div className="fs-gallery">
                <div className={`fs-slide ${detailPerson.color}`}>
                  {detailPerson.photoUrl ? (
                    <img
                      src={detailPerson.photoUrl}
                      alt={detailPerson.name}
                    />
                  ) : (
                    <div className="person-avatar large">
                      {detailPerson.initials}
                    </div>
                  )}
                </div>

                {personPosts.uid === detailPerson.uid &&
                  personPosts.posts.map((post) => (
                    <div
                      className={`fs-slide ${detailPerson.color}`}
                      key={post.id}
                    >
                      <img
                        src={post.photoUrl}
                        alt={post.caption || 'Публикация'}
                        loading="lazy"
                      />
                    </div>
                  ))}
              </div>

              <div className="fs-fade" />
            </div>

            <div className="fs-card">
              <div className="eyebrow">Анкета участника</div>

              <h1 className="fs-name">
                {detailPerson.name}
                <span>, {detailPerson.age}</span>
              </h1>

              <div className="fs-meta">
                <span className="online-pill">
                  <i />
                  {detailPerson.activity}
                </span>

                <span className="fs-chip">
                  <MapPin size={12} />
                  {detailPerson.city}
                </span>

                {detailMatch && detailMatch.percent > 0 && (
                  <span className="fs-chip">
                    <Sparkles size={12} />
                    {detailMatch.percent}% совпадение
                  </span>
                )}

                {detailPerson.username && (
                  <span className="fs-chip">
                    <Send size={12} />
                    @{detailPerson.username}
                  </span>
                )}
              </div>

              <div className="fs-block">
                <h3>О себе</h3>
                <p>{detailPerson.bio}</p>
              </div>

              {detailPerson.interests.length > 0 && (
                <div className="fs-block">
                  <h3>Интересы</h3>

                  <div className="tags">
                    {detailPerson.interests.map((tag) => (
                      <span
                        key={tag}
                        className={
                          detailMatch?.shared.some(
                            (shared) => sameInterest(shared, tag)
                          )
                            ? 'tag-shared'
                            : ''
                        }
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {personPosts.uid === detailPerson.uid &&
                personPosts.posts.length > 0 && (
                  <div className="fs-block">
                    <h3>Публикации</h3>

                    <div className="ig-grid">
                      {personPosts.posts.map((post) => (
                        <div className="ig-tile" key={post.id}>
                          <img
                            src={post.photoUrl}
                            alt={post.caption || 'Публикация'}
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>

          <div className="fs-actions">
            {detailIsMatched ? (
              detailPerson.username ? (
                <button
                  className="primary"
                  onClick={() => openTelegramChat(detailPerson.username || '')}
                >
                  <Send size={16} />
                  Написать в Telegram
                </button>
              ) : (
                <div className="muted">
                  У вас взаимный интерес. Username скрыт или не указан.
                </div>
              )
            ) : (
              <>
                <button
                  className="ghost"
                  onClick={() => void submitSwipe(detailPerson, 'left')}
                  disabled={swipeLock}
                  aria-label="Пропустить"
                >
                  <X size={18} />
                </button>

                <button
                  className="primary"
                  onClick={() => void submitSwipe(detailPerson, 'right')}
                  disabled={swipeLock}
                >
                  Предложить активность
                  <Users size={17} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {eventsOpen && (
        <div
          className="detail-backdrop"
          onClick={() => setEventsOpen(false)}
        >
          <section
            className="detail-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-handle" />

            <button
              className="detail-close"
              onClick={() => setEventsOpen(false)}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>

            <div className="detail-content">
              <div className="eyebrow">
                ВСЕ СОБЫТИЯ
              </div>

              <h1>Ближайшие встречи</h1>

              <div className="chip-row">
                {([
                  ['all', 'Все'],
                  ['near', 'Рядом'],
                  ['you', 'Для тебя'],
                  ['today', 'Сегодня'],
                  ['week', '7 дней'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    className={`chip ${eventFilter === id ? 'on' : ''}`}
                    onClick={() => setEventFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {filteredEvents.length > 0 ? (
                <div className="people-preview">
                  {filteredEvents.map((event) => (
                    <button
                      className="mini-person"
                      key={event.id}
                      onClick={() => {
                        setEventsOpen(false);
                        openEvent(event.id);
                      }}
                    >
                      <span className={`mini-avatar event-${event.color}`}>
                        <CalendarDays size={18} />
                      </span>

                      <span>
                        <b>
                          {event.title}
                          {event.forYou ? ' ★' : ''}
                        </b>

                        <small>
                          {displayDate(event.date)} · {event.time} · {event.place} · {event.participantCount}/{event.capacity}
                        </small>
                      </span>

                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Ничего не найдено. Попробуй другой фильтр или создай своё событие.
                </p>
              )}

              <button
                className="primary full"
                onClick={() => {
                  setEventsOpen(false);
                  startCreate();
                }}
              >
                Создать событие
                <Plus size={16} />
              </button>
            </div>
          </section>
        </div>
      )}

      {viewPost && (
        <div
          className="detail-backdrop"
          onClick={() => setViewPost(null)}
        >
          <section
            className="ig-viewer"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="detail-close"
              onClick={() => setViewPost(null)}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>

            <img
              src={viewPost.photoUrl}
              alt={viewPost.caption || ''}
            />

            <div className="ig-viewer-bar">
              <span>
                {viewPost.createdAt
                  ? new Date(viewPost.createdAt).toLocaleDateString(
                      'ru-RU',
                      {
                        day: 'numeric',
                        month: 'long',
                      }
                    )
                  : ''}
              </span>

              <button onClick={() => void deletePost(viewPost)}>
                <Trash2 size={17} />
                Удалить
              </button>
            </div>
          </section>
        </div>
      )}

      {notificationsOpen && (
        <div
          className="detail-backdrop"
          onClick={() => setNotificationsOpen(false)}
        >
          <section
            className="detail-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-handle" />

            <button
              className="detail-close"
              onClick={() => setNotificationsOpen(false)}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>

            <div className="detail-content">
              <div className="eyebrow">
                ВСЁ ВАЖНОЕ В ОДНОМ МЕСТЕ
              </div>

              <h1>Уведомления</h1>

              {notifications.length > 0 ? (
                <div className="people-preview">
                  {notifications.map((item) => (
                    <div className="mini-person" key={item.id}>
                      <span className="mini-avatar blue">
                        <Bell size={18} />
                      </span>

                      <span>
                        <b>{item.title}</b>
                        <small>{item.text}</small>
                      </span>

                      {!item.read && (
                        <span className="status-on" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Пока уведомлений нет. Когда появится взаимное совпадение
                  или важное событие, оно отобразится здесь.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}