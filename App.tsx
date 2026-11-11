import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowRight, ArrowUpRight, Bell, CalendarDays, Check,
  ChevronRight, Compass, MapPin, Plus, Search,
  Settings, Sparkles, Users, UsersRound, UserRound,
  X, Clock3, SlidersHorizontal, LayoutGrid, Trash2, Camera, Star, Gamepad2, Palette, Cpu
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
  goGetPosts,
  goJoinEvent,
  goMarkNotificationsRead,
  goSaveProfile,
  goSwipe,
  goToggleClub,
  type ApiMatch,
  type ApiNotification,
  type ApiPhotoPost,
  type ApiProfile,
  type GoData,
} from './goApi';

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
};

type Club = {
  id: string;
  title: string;
  members: string;
  description: string;
  icon: string;
  keywords: string[];
  perks: string[];
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

const CATEGORIES = ['Встреча', 'Игры', 'Творчество', 'Технологии', 'Спорт'];

const clubs: Club[] = [
  {
    id: 'gaming', title: 'Игровой клуб', members: '',
    description: 'Для тех, кто любит настолки и видеоигры. Находи команду и ходи на игровые встречи.',
    icon: 'game', keywords: ['игр', 'настол', 'гейм', 'турнир', 'game'],
    perks: ['Все игровые события в одном месте', 'Такие события появляются у тебя в «Для тебя»', 'Можно создать игровую встречу прямо из клуба'],
  },
  {
    id: 'art', title: 'Арт-комьюнити', members: '',
    description: 'Рисование, фото, дизайн и музыка. Для тех, кто любит создавать и делиться.',
    icon: 'art', keywords: ['твор', 'рис', 'арт', 'фото', 'дизайн', 'музык'],
    perks: ['Творческие встречи и прогулки с фото', 'Такие события появляются у тебя в «Для тебя»', 'Можно создать встречу прямо из клуба'],
  },
  {
    id: 'tech', title: 'Технологии', members: '',
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
  const Icon = id === 'game' ? Gamepad2 : id === 'art' ? Palette : Cpu;
  return <Icon size={size} />;
}

const norm = (value: string) => value.trim().toLowerCase();

function sameInterest(a: string, b: string) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}

function scorePerson(me: ApiProfile | null, p: Person) {
  if (!me) return { score: 0, percent: 0, shared: [] as string[] };
  const mine = me.interests || [];
  const shared = p.interests.filter((tag) => mine.some((m) => sameInterest(m, tag)));
  let score = shared.length * 3;
  const sameCity = Boolean(me.city && p.city && norm(me.city) === norm(p.city));
  if (sameCity) score += 3;
  const diff = Math.abs((me.age || 0) - p.age);
  score += diff === 0 ? 3 : diff === 1 ? 2 : diff <= 2 ? 1 : 0;
  if (p.photoUrl) score += 1;
  const maxScore = Math.min(5, Math.max(1, mine.length, p.interests.length)) * 3 + 7;
  const percent = Math.max(5, Math.min(99, Math.round((score / maxScore) * 100)));
  return { score, percent, shared };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isUpcoming(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date >= todayStr() : true;
}

function withinDays(date: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const diff = (new Date(`${date}T12:00:00`).getTime() - Date.now()) / 86400000;
  return diff <= days;
}

function eventInClub(event: EventItem, club: Club) {
  const text = norm(`${event.category} ${event.title}`);
  return club.keywords.some((word) => text.includes(word));
}

function isForYou(me: ApiProfile | null, joined: string[], event: EventItem) {
  const byClub = clubs.some((club) => joined.includes(club.id) && eventInClub(event, club));
  const text = norm(`${event.title} ${event.category} ${event.description}`);
  const byInterest = (me?.interests || []).some((tag) => {
    const n = norm(tag);
    return n.length >= 3 && text.includes(n);
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
  };
}

function eventColor(category: string) {
  const value = category.toLowerCase();

  if (value.includes('тех') || value.includes('код') || value.includes('онлайн') || value.includes('спорт')) {
    return 'orange';
  }

  if (value.includes('твор') || value.includes('фото') || value.includes('арт')) {
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
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.85));
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [dragX, setDragX] = useState(0);
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
  const [personPosts, setPersonPosts] = useState<{ uid: string; posts: ApiPhotoPost[] }>({ uid: '', posts: [] });
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
  const moved = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const postInputRef = useRef<HTMLInputElement>(null);

  const rankedPeople = [...people]
    .map((person) => ({ person, score: scorePerson(profile, person).score }))
    .sort((x, y) => y.score - x.score)
    .map((item) => item.person);

  const matchLine = (person: Person) => {
    const m = scorePerson(profile, person);
    return m.shared.length
      ? `Общее: ${m.shared.slice(0, 2).join(', ')}`
      : person.interests[0] || 'Новые знакомства';
  };

  const upcomingEvents: EventItem[] = events
    .filter((event) => isUpcoming(event.date))
    .map((event) => ({
      ...event,
      forYou: isForYou(profile, clubJoined, event),
      nearby: Boolean(profile?.city && event.city && norm(profile.city) === norm(event.city)),
    }))
    .sort((x, y) => Number(Boolean(y.nearby)) - Number(Boolean(x.nearby)) || `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`));

  const filteredEvents = upcomingEvents.filter((event) =>
    eventFilter === 'all' ? true
      : eventFilter === 'you' ? Boolean(event.forYou)
      : eventFilter === 'near' ? Boolean(event.nearby)
      : eventFilter === 'today' ? event.date === todayStr()
      : withinDays(event.date, 7)
  );

  const passesFilters = (person: Person) => {
    if (onlyMyCity && profile?.city && norm(person.city) !== norm(profile.city)) return false;
    if (ageRange !== 'any' && profile && Math.abs(person.age - profile.age) > Number(ageRange)) return false;
    return true;
  };

  const swipePeople = rankedPeople.filter(passesFilters);

  const currentPerson = swipePeople.find((person) => {
    const search = peopleQuery.trim().toLowerCase();

    if (!search) return true;

    return [person.name, person.city, person.bio, ...person.interests]
      .some((value) => value.toLowerCase().includes(search));
  });

  const unreadCount = notifications.filter((item) => !item.read).length;
  const currentMatch = currentPerson ? scorePerson(profile, currentPerson) : null;

  // Скрываем нижнюю панель, пока открыта клавиатура.
  useEffect(() => {
    const isField = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'TEXTAREA' ||
        (target.tagName === 'INPUT' && !['file', 'checkbox', 'radio'].includes((target as HTMLInputElement).type)));
    const onIn = (event: FocusEvent) => {
      if (isField(event.target)) setKbOpen(true);
    };
    const onOut = () => {
      setTimeout(() => setKbOpen(isField(document.activeElement)), 80);
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
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Telegram Mini App setup.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) return;

    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    tg.setHeaderColor?.('#090a0f');
    tg.setBackgroundColor?.('#090a0f');

    const telegramName = [
      tg.initDataUnsafe?.user?.first_name,
      tg.initDataUnsafe?.user?.last_name,
    ].filter(Boolean).join(' ').trim();

    if (telegramName) {
      setProfileForm((old) =>
        old.name ? old : { ...old, name: telegramName }
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
          setNotice(`Ошибка входа: ${errorMessage(error)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        data.events.map(toEvent).sort((x, y) => `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`))
      );
      setMatches(data.matches || []);
      setNotifications(data.notifications || []);
      setClubJoined(data.clubMemberships || []);
      setClubCounts(data.clubCounts || {});
      setPhotoPosts(data.photoPosts || []);

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

        setCityOther(Boolean(data.profile.city) && !CITIES.includes(data.profile.city));
        setProfileEditing(false);
      } else {
        setProfileEditing(true);
      }
    } catch (error) {
      console.error('GO data loading error:', error);
      setNotice(`Не удалось загрузить данные: ${errorMessage(error)}`);
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

  // Telegram back button.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const handleBack = () => {
      if (notificationsOpen) setNotificationsOpen(false);
      else if (viewPost) setViewPost(null);
      else if (eventsOpen) setEventsOpen(false);
      else if (detail) setDetail(null);
      else if (tab === 'create' && createStarted) setCreateStarted(false);
      else if (tab !== 'home') {
        setTab('home');
        setNotice('');
      }
    };

    if (detail || notificationsOpen || viewPost || eventsOpen || tab !== 'home') tg.BackButton.show();
    else tg.BackButton.hide();

    tg.BackButton.onClick(handleBack);

    return () => tg.BackButton.offClick(handleBack);
  }, [detail, notificationsOpen, viewPost, eventsOpen, createStarted, tab]);

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
    setEventForm((old) => ({ ...old, category: club.title === 'Игровой клуб' ? 'Игры' : club.id === 'art' ? 'Творчество' : 'Технологии' }));
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
      setDragX(0);
    }
  };

  const finishSwipe = async (direction: 'left' | 'right') => {
    if (swipeDirection || swipeLock || !currentPerson) return;

    setSwipeDirection(direction);
    try {
      await submitSwipe(currentPerson, direction);
    } finally {
      setSwipeDirection('');
      setDragX(0);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    startX.current = event.clientX;
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startX.current && !swipeLock) {
      if (Math.abs(event.clientX - startX.current) > 6) moved.current = true;
      setDragX(
        Math.max(
          -150,
          Math.min(150, event.clientX - startX.current)
        )
      );
    }
  };

  const onPointerUp = () => {
    if (!moved.current && currentPerson && !swipeLock) {
      startX.current = 0;
      setDragX(0);
      openPerson(currentPerson.uid);
      return;
    }
    if (dragX > 90) {
      void finishSwipe('right');
    } else if (dragX < -90) {
      void finishSwipe('left');
    } else {
      setDragX(0);
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

    try {
      await goJoinEvent({ eventId });
      await refreshData();
      setNotice('Ты добавлен в список участников.');
    } catch (error) {
      setNotice(
        `Не удалось присоединиться: ${errorMessage(error)}`
      );
    }
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
    if (eventStep === 1 && (!Number.isInteger(Number(eventForm.capacity)) || Number(eventForm.capacity) < 2 || Number(eventForm.capacity) > 200)) {
      setNotice('Укажи от 2 до 200 участников');
      return;
    }
    if (eventStep === 2 && !eventForm.time) {
      setNotice('Выбери время встречи');
      return;
    }
    if (eventStep === 3 && eventForm.date && eventForm.date < todayStr()) {
      setNotice('Эта дата уже прошла');
      return;
    }
    if (eventStep === 3 && (!eventForm.date || !eventForm.place.trim())) {
      setNotice('Укажи дату и публичное место встречи');
      return;
    }
    setEventStep((step) => Math.min(4, step + 1));
  };

  const previousEventStep = () => setEventStep((step) => Math.max(0, step - 1));

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
      setClubCounts((old) => ({ ...old, [clubId]: result.count }));

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
      const imageRef = storageRef(storage, `profilePhotos/${profile.uid}/avatar/${Date.now()}.jpg`);
      const uploaded = await uploadBytes(imageRef, blob, { contentType: 'image/jpeg' });
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
      setNotice(`Не удалось загрузить фото: ${errorMessage(error)}`);
    } finally {
      setPhotoBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
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
      const imageRef = storageRef(storage, `profilePhotos/${profile.uid}/posts/${Date.now()}.jpg`);
      const uploaded = await uploadBytes(imageRef, blob, { contentType: 'image/jpeg' });
      const photoUrl = await getDownloadURL(uploaded.ref);
      await goCreatePhotoPost({ photoUrl, caption: '' });
      await refreshData();
      setNotice('Фото опубликовано в профиле');
    } catch (error) {
      setNotice(`Не удалось опубликовать фото: ${errorMessage(error)}`);
    } finally {
      setPhotoBusy(false);
      if (postInputRef.current) postInputRef.current.value = '';
    }
  };

  const deletePost = async (post: ApiPhotoPost) => {
    if (!window.confirm('Удалить публикацию?')) return;
    try {
      await goDeletePhotoPost({ postId: post.id });
      if (storage) {
        try { await deleteObject(storageRef(storage, post.photoUrl)); } catch { /* файл мог уже удалиться */ }
      }
      setViewPost(null);
      await refreshData();
      setNotice('Публикация удалена');
    } catch (error) {
      setNotice(`Не удалось удалить: ${errorMessage(error)}`);
    }
  };

  const openNotifications = async () => {
    setNotificationsOpen(true);

    const unreadIds = notifications
      .filter((item) => !item.read)
      .map((item) => item.id);

    if (unreadIds.length === 0 || authStatus !== 'signed-in') {
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
    setDetail({ type: 'person', uid });
    setPersonPosts({ uid, posts: [] });
    if (uid.startsWith('tg_') && authStatus === 'signed-in') {
      goGetPosts({ targetUid: uid })
        .then((result) => setPersonPosts({ uid, posts: result.posts || [] }))
        .catch(() => undefined);
    }
  };

  const openEvent = (id: string) => {
    setDetail({ type: 'event', id });
  };

  const openClub = (id: string) => {
    setDetail({ type: 'club', id });
  };

  const matchedPeople = matches
    .map((match) => {
      const otherUid = match.memberUids.find(
        (uid) => uid !== profile?.uid
      );

      return otherUid
        ? allPeople.find((person) => person.uid === otherUid)
        : undefined;
    })
    .filter((person): person is Person => Boolean(person));

  const detailPerson = detail?.type === 'person'
    ? allPeople.find((person) => person.uid === detail.uid) ||
      people.find((person) => person.uid === detail.uid)
    : undefined;

  const detailEvent = detail?.type === 'event'
    ? events.find((event) => event.id === detail.id)
    : undefined;

  const detailClub = detail?.type === 'club'
    ? clubs.find((club) => club.id === detail.id)
    : undefined;

  const clubEvents = detailClub
    ? upcomingEvents.filter((event) => eventInClub(event, detailClub))
    : [];

  return (
    <div className={`app-shell${kbOpen ? ' kb-open' : ''}`}>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => changeTab('home')}
          aria-label="На главную"
        >
          <span className="brand-mark">G</span>
          <span>
            GO<span className="brand-dot">.</span>
          </span>
        </button>

        <div className="top-caption">
          Люди рядом. Интересы вместе.
        </div>

        <button
          className="icon-button top-action"
          aria-label="Уведомления"
          onClick={() => void openNotifications()}
        >
          <Bell size={19} />
          {unreadCount > 0 && (
            <span className="notif-dot" aria-label={`${unreadCount} непрочитанных`} />
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
            <div className="home-greet">
              <div className="eyebrow"><Sparkles size={14} /> {profile ? 'ТВОЯ ЛЕНТА' : 'ДОБРО ПОЖАЛОВАТЬ'}</div>
              <h1 className="home-title">
                {profile ? `Привет, ${profile.name.split(' ')[0]}` : 'Привет'}<span>.</span>
              </h1>
              <p className="muted">Люди, события и клубы по твоим интересам.</p>
            </div>

            {authStatus === 'signed-in' && !dataLoading && !profile && (
              <button className="onboard-card" onClick={() => changeTab('profile')}>
                <span className="onboard-icon"><UserRound size={20} /></span>
                <span>
                  <b>Заполни анкету</b>
                  <small>Так мы подберём людей и события по интересам и возрасту</small>
                </span>
                <ChevronRight size={18} />
              </button>
            )}

            <div className="quick-actions">
              <button onClick={() => changeTab('people')}><Users size={19} /><span>Найти людей</span></button>
              <button onClick={startCreate}><Plus size={19} /><span>Создать событие</span></button>
              <button onClick={() => changeTab('communities')}><UsersRound size={19} /><span>Клубы</span></button>
            </div>

            <section className="section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">БЛИЖАЙШИЕ</div>
                  <h2>События рядом</h2>
                </div>
                {upcomingEvents.length > 0 && (
                  <button className="text-button" onClick={() => setEventsOpen(true)}>
                    Все ({upcomingEvents.length}) <ArrowUpRight size={14} />
                  </button>
                )}
              </div>

              {upcomingEvents.length > 0 ? (
                <div className="event-rail">
                  {upcomingEvents.slice(0, 8).map((event) => (
                    <button
                      className={`event-card rail event-${event.color}`}
                      key={event.id}
                      onClick={() => openEvent(event.id)}
                    >
                      <div className="event-topline">
                        <span className="event-tags">
                          <span className="event-category">{event.category}</span>
                          {event.nearby && <span className="badge-near"><MapPin size={10} /> Рядом</span>}
                        </span>
                        {event.forYou ? (
                          <span className="badge-you"><Star size={11} /> Для тебя</span>
                        ) : (
                          <span className="event-arrow"><ArrowUpRight size={16} /></span>
                        )}
                      </div>
                      <div className="event-meta">
                        <CalendarDays size={13} />
                        {displayDate(event.date)} · {event.time}
                      </div>
                      <h3>{event.title}</h3>
                      <div className="event-bottom">
                        <span><MapPin size={13} /> {event.place}</span>
                        <b>{event.participantCount}/{event.capacity}</b>
                      </div>
                      <div className="fill-bar">
                        <i style={{ width: `${Math.min(100, Math.round((event.participantCount / Math.max(1, event.capacity)) * 100))}%` }} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-card">
                  <CalendarDays size={26} />
                  <b>Пока нет событий</b>
                  <span>Создай первое — другие участники увидят его здесь</span>
                  <button className="primary" onClick={startCreate}>Создать событие</button>
                </div>
              )}
            </section>

            <section className="section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">ПОДОБРАНО ДЛЯ ТЕБЯ</div>
                  <h2>Люди для команды</h2>
                </div>
                <button className="text-button" onClick={() => changeTab('people')}>
                  Смотреть <ArrowUpRight size={14} />
                </button>
              </div>

              <div className="people-preview">
                {rankedPeople.slice(0, 3).map((person) => {
                  const m = scorePerson(profile, person);
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
                        {person.photoUrl ? <img src={person.photoUrl} alt="" /> : person.initials}
                      </span>
                      <span>
                        <b>{person.name}, {person.age}</b>
                        <small>{matchLine(person)}</small>
                      </span>
                      {m.percent > 0 && <i className="match-pill">{m.percent}%</i>}
                      <ChevronRight size={17} />
                    </button>
                  );
                })}

                {rankedPeople.length === 0 && (
                  <p className="muted">Новых анкет пока нет. Загляни позже.</p>
                )}
              </div>
            </section>
          </section>
        )}

        {tab === 'people' && (
          <section className="screen people-page">
            <div className="eyebrow">СОВПАДЕНИЕ ПО ИНТЕРЕСАМ</div>

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
                  <button className={`chip ${onlyMyCity ? 'on' : ''}`} disabled={!profile?.city} onClick={() => setOnlyMyCity((value) => !value)}>
                    <MapPin size={12} /> Рядом: мой город
                  </button>
                  {([['any', 'Любой возраст'], ['1', '±1 год'], ['2', '±2 года']] as const).map(([id, label]) => (
                    <button key={id} className={`chip ${ageRange === id ? 'on' : ''}`} onClick={() => setAgeRange(id)}>{label}</button>
                  ))}
                </div>
              </>
            )}

            {matchedPeople.length > 0 && (
              <section className="section">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">ВЗАИМНЫЙ ИНТЕРЕС</div>
                    <h2>Совпадения</h2>
                  </div>
                </div>

                <div className="people-preview">
                  {matchedPeople.map((person) => (
                    <button
                      className="mini-person"
                      key={person.uid}
                      onClick={() => openPerson(person.uid)}
                    >
                      <span className={`mini-avatar ${person.color}`}>
                        {person.photoUrl ? <img src={person.photoUrl} alt="" /> : person.initials}
                      </span>

                      <span>
                        <b>{person.name}, {person.age}</b>
                        <small>
                          Взаимный интерес · общие активности
                        </small>
                      </span>

                      <Check size={17} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {currentPerson ? (
              <>
                <div className="swipe-stage">
                  <div className="swipe-hint hint-no" style={{ opacity: Math.min(1, Math.max(0, -dragX / 90)) }}>ПРОПУСК</div>
                  <div className="swipe-hint hint-yes" style={{ opacity: Math.min(1, Math.max(0, dragX / 90)) }}>ИНТЕРЕСНО</div>

                  <div
                    className="person-card"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                      setDragX(0);
                      startX.current = 0;
                    }}
                    style={{
                      transform: `translateX(${
                        swipeDirection === 'right'
                          ? 520
                          : swipeDirection === 'left'
                            ? -520
                            : dragX
                      }px) rotate(${
                        swipeDirection === 'right'
                          ? 18
                          : swipeDirection === 'left'
                            ? -18
                            : dragX / 18
                      }deg)`,

                      transition: swipeDirection
                        ? 'transform .23s ease-in'
                        : dragX === 0
                          ? 'transform .28s cubic-bezier(.2,.8,.2,1)'
                          : 'none',
                    }}
                  >
                    <div
                      className={`person-art ${currentPerson.color}`}
                    >
                      <div className="person-art-orb" />
                      <span className="person-number">{currentMatch && currentMatch.percent > 0 ? `${currentMatch.percent}% совпадение` : 'GO / PROFILE'}</span>

                      {currentPerson.photoUrl ? (
                        <img className="person-photo" src={currentPerson.photoUrl} alt={currentPerson.name} draggable={false} />
                      ) : (
                        <div className="person-avatar">{currentPerson.initials}</div>
                      )}

                      <span className="online-pill">
                        <i /> В поиске компании
                      </span>
                    </div>

                    <div
                      className="person-info"
                    >
                      <div className="person-location">
                        <MapPin size={13} /> {currentPerson.city}
                      </div>

                      <h2>
                        {currentPerson.name}, {currentPerson.age}
                      </h2>

                      <p>{currentPerson.bio}</p>

                      <div className="tags">
                        {currentPerson.interests.map((tag) => (
                          <span key={tag} className={currentMatch?.shared.some((s) => sameInterest(s, tag)) ? 'tag-shared' : ''}>{tag}</span>
                        ))}
                      </div>

                      <button className="profile-open" type="button">
                        Открыть анкету <ArrowUpRight size={15} />
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
                <div className="eyebrow">ТВОЯ ИДЕЯ — ТВОЁ СОБЫТИЕ</div>
                <h1 className="page-title">Создай<br /><span>движение.</span></h1>
                <p>Собери людей на игру, прогулку или проект. Это займёт минуту.</p>
                <div className="create-steps">
                  {['Название', 'Участники', 'Время', 'Дата и место', 'Описание'].map((label, index) => (
                    <div key={label}><b>{index + 1}</b><span>{label}</span></div>
                  ))}
                </div>
                <button className="primary full" onClick={() => setCreateStarted(true)}>
                  Создать событие <ArrowRight size={16} />
                </button>
                <p className="safety-note">Встречайтесь в общественных местах. Не публикуй домашние адреса.</p>
              </>
            ) : (
              <>
                <div className="wizard-heading">
                  <span>ШАГ {eventStep + 1} ИЗ 5</span>
                  <b>{['Название', 'Участники', 'Время', 'Дата и место', 'Описание'][eventStep]}</b>
                </div>
                <div className="wizard-progress" aria-label={`Шаг ${eventStep + 1} из 5`}>
                  {[0, 1, 2, 3, 4].map((step) => <span key={step} className={step <= eventStep ? 'filled' : ''} />)}
                </div>
                <div className="wizard-card" key={eventStep}>
                  {eventStep === 0 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">01</div>
                      <h2>Как назовём встречу?</h2>
                      <p>Название должно коротко объяснять, что вы собираетесь делать.</p>
                      <label>Название события
                        <input autoFocus value={eventForm.title} onChange={(event) => setEventForm((old) => ({ ...old, title: event.target.value }))} placeholder="Например, прогулка и фото" maxLength={70} />
                      </label>
                    </div>
                  )}
                  {eventStep === 1 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">02</div>
                      <h2>Сколько человек собираем?</h2>
                      <p>Ты автоматически попадёшь в список участников после публикации.</p>
                      <label>Максимум участников
                        <input inputMode="numeric" type="number" min="2" max="200" value={eventForm.capacity} onChange={(event) => setEventForm((old) => ({ ...old, capacity: event.target.value }))} placeholder="12" />
                      </label>
                      <span className="wizard-hint">От 2 до 200 человек</span>
                    </div>
                  )}
                  {eventStep === 2 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">03</div>
                      <h2>Во сколько встречаемся?</h2>
                      <p>Выбери время начала встречи.</p>
                      <label>Время
                        <input type="time" value={eventForm.time} onChange={(event) => setEventForm((old) => ({ ...old, time: event.target.value }))} />
                      </label>
                    </div>
                  )}
                  {eventStep === 3 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">04</div>
                      <h2>Где и когда?</h2>
                      <p>Укажи общественное место, доступное всем участникам.</p>
                      <label>Дата
                        <input type="date" min={todayStr()} value={eventForm.date} onChange={(event) => setEventForm((old) => ({ ...old, date: event.target.value }))} />
                      </label>
                      <label>Публичное место встречи
                        <input value={eventForm.place} onChange={(event) => setEventForm((old) => ({ ...old, place: event.target.value }))} placeholder="Например, городской парк" maxLength={100} />
                      </label>
                      <span className="wizard-hint">Не указывай домашний адрес. Город события берётся из твоей анкеты.</span>
                    </div>
                  )}
                  {eventStep === 4 && (
                    <div className="wizard-step">
                      <div className="wizard-step-number">05</div>
                      <h2>Расскажи подробности</h2>
                      <p>Что будете делать и кому подойдёт встреча?</p>
                      <label>Описание
                        <textarea value={eventForm.description} onChange={(event) => setEventForm((old) => ({ ...old, description: event.target.value }))} placeholder="Расскажи немного о встрече..." rows={4} maxLength={500} />
                      </label>
                      <div className="chip-label">Категория — по ней событие попадёт в клуб и рекомендации</div>
                      <div className="chip-row">
                        {CATEGORIES.map((category) => (
                          <button type="button" key={category} className={`chip ${eventForm.category === category ? 'on' : ''}`} onClick={() => setEventForm((old) => ({ ...old, category }))}>
                            {category}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="wizard-actions">
                  <button className="wizard-back" onClick={eventStep === 0 ? () => setCreateStarted(false) : previousEventStep}>
                    {eventStep === 0 ? 'Отмена' : 'Назад'}
                  </button>
                  {eventStep < 4 ? (
                    <button className="primary wizard-next" onClick={nextEventStep}>Далее <ArrowRight size={16} /></button>
                  ) : (
                    <button className="primary wizard-next" onClick={() => void createEvent()} disabled={dataLoading || photoBusy}>Опубликовать <ArrowRight size={16} /></button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'communities' && (
          <section className="screen communities-page">
            <div className="eyebrow">СВОИ ЛЮДИ</div>

            <h1 className="page-title">
              Найди свой<br />
              <span>клуб.</span>
            </h1>

            <p className="muted">
              Клубы собирают события по интересам. Вступи — и такие события появятся у тебя в «Для тебя».
            </p>

            <div className="community-search">
              <Search size={18} />

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск сообществ"
              />
            </div>

            <div className="community-list">
              {clubs
                .filter((club) =>
                  club.title.toLowerCase().includes(query.toLowerCase())
                )
                .map((club) => (
                  <button
                    className="community-card"
                    key={club.id}
                    onClick={() => openClub(club.id)}
                  >
                    <span className={`community-symbol ${club.icon}`}>
                      <ClubIcon id={club.icon} size={20} />
                    </span>

                    <span className="community-copy">
                      <b>{club.title}</b>
                      <small>{Number(clubCounts[club.id] || 0)} участников · {upcomingEvents.filter((event) => eventInClub(event, club)).length} событий{clubJoined.includes(club.id) ? ' · ты в клубе' : ''}</small>
                      <span>{club.description}</span>
                    </span>

                    <ChevronRight size={18} />
                  </button>
                ))}

              {clubs.filter((club) =>
                club.title.toLowerCase().includes(query.toLowerCase())
              ).length === 0 && (
                <p className="muted">Сообщества не найдены.</p>
              )}
            </div>
          </section>
        )}

        {tab === 'profile' && (
          <section className="screen ig-profile">
            <input ref={avatarInputRef} className="visually-hidden-input" type="file" accept="image/*" onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
            <input ref={postInputRef} className="visually-hidden-input" type="file" accept="image/*" onChange={(e) => void createPhotoPost(e.target.files?.[0])} />

            {profile && !profileEditing ? (
              <>
                <div className="ig-head">
                  <button className="ig-avatar-ring" onClick={() => avatarInputRef.current?.click()} disabled={photoBusy} aria-label="Сменить фото профиля">
                    <span className="ig-avatar">
                      {profile.photoUrl ? <img src={profile.photoUrl} alt="" /> : initialsFor(profile.name)}
                    </span>
                    <span className="ig-avatar-plus"><Camera size={13} /></span>
                  </button>
                  <div className="ig-stats">
                    <div><b>{photoPosts.length}</b><span>публикации</span></div>
                    <div><b>{matches.length}</b><span>совпадения</span></div>
                    <div><b>{events.filter((e) => e.joined).length}</b><span>события</span></div>
                  </div>
                </div>

                <div className="ig-bio">
                  <h1>{profile.name}, {profile.age}</h1>
                  {profile.city && <div className="ig-city"><MapPin size={13} /> {profile.city}</div>}
                  <p>{profile.bio || 'Добавь пару слов о себе.'}</p>
                  {(profile.interests || []).length > 0 && (
                    <div className="tags">{profile.interests.map((t) => <span key={t}>{t}</span>)}</div>
                  )}
                </div>

                <div className="ig-actions">
                  <button className="ig-btn" onClick={() => setProfileEditing(true)}><Settings size={15} /> Изменить анкету</button>
                  <button className="ig-btn ig-btn-accent" onClick={() => postInputRef.current?.click()} disabled={photoBusy}>
                    <Plus size={15} /> {photoBusy ? 'Загрузка…' : 'Фото'}
                  </button>
                </div>

                <div className="ig-tab"><LayoutGrid size={20} /></div>

                {photoPosts.length > 0 || photoBusy ? (
                  <div className="ig-grid">
                    {photoBusy && <div className="ig-tile ig-tile-loading">…</div>}
                    {photoPosts.map((post) => (
                      <button className="ig-tile" key={post.id} onClick={() => setViewPost(post)}>
                        <img src={post.photoUrl} alt={post.caption || 'Публикация'} loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="ig-empty">
                    <div className="ig-empty-icon"><Camera size={26} /></div>
                    <b>Пока нет публикаций</b>
                    <span>Поделись первым фото — оно появится здесь</span>
                    <button className="primary" onClick={() => postInputRef.current?.click()}>Опубликовать фото</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="eyebrow">ТВОЯ АНКЕТА</div>
                <h1 className="page-title">{profile ? 'Изменить' : 'Расскажи'}<br /><span>о себе.</span></h1>
                <div className="form-preview">
                  {profile && (
                    <button type="button" className="avatar-upload-button" onClick={() => avatarInputRef.current?.click()} disabled={photoBusy}>
                      <Camera size={17} /> {photoBusy ? 'Загружаем фото...' : 'Изменить фото профиля'}
                    </button>
                  )}
                  <label>Имя
                    <input value={profileForm.name} onChange={(e) => setProfileForm((o) => ({ ...o, name: e.target.value }))} placeholder="Как тебя зовут?" maxLength={40} />
                  </label>
                  <label>Возраст (13–17)
                    <input type="number" min="13" max="17" value={profileForm.age} onChange={(e) => setProfileForm((o) => ({ ...o, age: e.target.value }))} placeholder="Например, 16" />
                  </label>
                  <label>Город
                    <select
                      value={cityOther ? '__other' : profileForm.city}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '__other') {
                          setCityOther(true);
                          setProfileForm((o) => ({ ...o, city: '' }));
                        } else {
                          setCityOther(false);
                          setProfileForm((o) => ({ ...o, city: value }));
                        }
                      }}
                    >
                      <option value="">Выбери город</option>
                      {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                      <option value="__other">Другой город…</option>
                    </select>
                  </label>
                  {cityOther && (
                    <label>Название города
                      <input value={profileForm.city} onChange={(e) => setProfileForm((o) => ({ ...o, city: e.target.value }))} placeholder="Например, Тарко-Сале" maxLength={60} />
                    </label>
                  )}
                  <label>О себе
                    <textarea value={profileForm.bio} onChange={(e) => setProfileForm((o) => ({ ...o, bio: e.target.value }))} placeholder="Расскажи, что тебе интересно..." rows={3} maxLength={300} />
                  </label>
                  <label>Интересы через запятую
                    <input value={profileForm.interests} onChange={(e) => setProfileForm((o) => ({ ...o, interests: e.target.value }))} placeholder="Музыка, игры, прогулки" />
                  </label>
                  <button className="primary" onClick={() => void saveProfile()} disabled={photoBusy}>Сохранить <Check size={16} /></button>
                  {profile && <button className="text-button" onClick={() => setProfileEditing(false)}>Отмена</button>}
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
          <Check size={16} /> {notice} <X size={15} />
        </button>
      )}

      <nav className="bottom-nav" aria-label="Основная навигация">
        {nav.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
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

      {detail && (
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

            {detail.type === 'person' && detailPerson && (
              <>
                <div className={`detail-person-art ${detailPerson.color}`}>
                  {detailPerson.photoUrl ? (
                    <img className="person-detail-photo" src={detailPerson.photoUrl} alt={detailPerson.name} />
                  ) : (
                    <div className="person-avatar large">{detailPerson.initials}</div>
                  )}

                  <span className="online-pill">
                    <i /> {detailPerson.activity}
                  </span>
                </div>

                <div className="detail-content">
                  <div className="eyebrow">АНКЕТА УЧАСТНИКА</div>

                  <h1>
                    {detailPerson.name}, {detailPerson.age}
                  </h1>

                  <div className="person-location">
                    <MapPin size={14} /> {detailPerson.city}
                  </div>

                  <p>{detailPerson.bio}</p>

                  <h3>Интересы</h3>

                  <div className="tags">
                    {detailPerson.interests.map((tag) => (
                      <span key={tag} className={scorePerson(profile, detailPerson).shared.some((s) => sameInterest(s, tag)) ? 'tag-shared' : ''}>{tag}</span>
                    ))}
                  </div>

                  {personPosts.uid === detailPerson.uid && personPosts.posts.length > 0 && (
                    <>
                      <h3>Публикации</h3>
                      <div className="ig-grid">
                        {personPosts.posts.map((post) => (
                          <div className="ig-tile" key={post.id}>
                            <img src={post.photoUrl} alt={post.caption || 'Публикация'} loading="lazy" />
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <button
                    className="primary full"
                    onClick={() =>
                      void submitSwipe(detailPerson, 'right')
                    }
                  >
                    Предложить активность <Users size={17} />
                  </button>
                </div>
              </>
            )}

            {detail.type === 'event' && detailEvent && (
              <>
                <div className={`detail-event-art event-${detailEvent.color}`}>
                  <CalendarDays size={44} />
                  <span>СОБЫТИЕ GO</span>
                </div>

                <div className="detail-content">
                  <div className="eyebrow">
                    {detailEvent.category}
                  </div>

                  <h1>{detailEvent.title}</h1>

                  <div className="detail-facts">
                    <span>
                      <CalendarDays size={16} />
                      {displayDate(detailEvent.date)}
                    </span>

                    <span>
                      <Clock3 size={16} />
                      {detailEvent.time}
                    </span>

                    <span>
                      <MapPin size={16} />
                      {detailEvent.place}
                    </span>
                  </div>

                  <p>{detailEvent.description}</p>

                  <div className="event-capacity">
                    {detailEvent.people}
                  </div>

                  <button
                    className="primary full"
                    onClick={() => void joinEvent(detailEvent.id)}
                    disabled={
                      detailEvent.joined ||
                      detailEvent.participantCount >= detailEvent.capacity
                    }
                  >
                    {detailEvent.joined
                      ? 'Ты участвуешь'
                      : detailEvent.participantCount >= detailEvent.capacity
                        ? 'Мест больше нет'
                        : 'Присоединиться'}

                    <Check size={17} />
                  </button>
                </div>
              </>
            )}

            {detail.type === 'club' && detailClub && (
              <div className="detail-content club-detail">
                <div className={`community-symbol big ${detailClub.icon}`}>
                  <ClubIcon id={detailClub.icon} size={28} />
                </div>

                <div className="eyebrow">КЛУБ GO</div>
                <h1>{detailClub.title}</h1>
                <div className="muted">{Number(clubCounts[detailClub.id] || 0)} участников</div>
                <p>{detailClub.description}</p>

                <div className="club-benefits">
                  {detailClub.perks.map((perk) => (
                    <span key={perk}><Check size={15} /> {perk}</span>
                  ))}
                </div>

                <h3>События клуба</h3>
                {clubEvents.length > 0 ? (
                  <div className="people-preview">
                    {clubEvents.slice(0, 4).map((event) => (
                      <button className="mini-person" key={event.id} onClick={() => openEvent(event.id)}>
                        <span className={`mini-avatar event-${event.color}`}><CalendarDays size={18} /></span>
                        <span>
                          <b>{event.title}</b>
                          <small>{displayDate(event.date)} · {event.time} · {event.place}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Пока нет событий. Создай первое для этого клуба.</p>
                )}

                <button className="primary full" onClick={() => void toggleClub(detailClub.id)}>
                  {clubJoined.includes(detailClub.id) ? 'Покинуть клуб' : 'Вступить в клуб'}
                  <ArrowRight size={17} />
                </button>
                <button className="ig-btn club-create" onClick={() => startEventInClub(detailClub)}>
                  <Plus size={15} /> Создать событие в клубе
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {eventsOpen && (
        <div className="detail-backdrop" onClick={() => setEventsOpen(false)}>
          <section className="detail-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="detail-handle" />
            <button className="detail-close" onClick={() => setEventsOpen(false)} aria-label="Закрыть"><X size={20} /></button>
            <div className="detail-content">
              <div className="eyebrow">ВСЕ СОБЫТИЯ</div>
              <h1>Ближайшие встречи</h1>
              <div className="chip-row">
                {([['all', 'Все'], ['near', 'Рядом'], ['you', 'Для тебя'], ['today', 'Сегодня'], ['week', '7 дней']] as const).map(([id, label]) => (
                  <button key={id} className={`chip ${eventFilter === id ? 'on' : ''}`} onClick={() => setEventFilter(id)}>{label}</button>
                ))}
              </div>
              {filteredEvents.length > 0 ? (
                <div className="people-preview">
                  {filteredEvents.map((event) => (
                    <button className="mini-person" key={event.id} onClick={() => { setEventsOpen(false); openEvent(event.id); }}>
                      <span className={`mini-avatar event-${event.color}`}><CalendarDays size={18} /></span>
                      <span>
                        <b>{event.title}{event.forYou ? ' ★' : ''}</b>
                        <small>{displayDate(event.date)} · {event.time} · {event.place} · {event.participantCount}/{event.capacity}</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">Ничего не найдено. Попробуй другой фильтр или создай своё событие.</p>
              )}
              <button className="primary full" onClick={() => { setEventsOpen(false); startCreate(); }}>
                Создать событие <Plus size={16} />
              </button>
            </div>
          </section>
        </div>
      )}

      {viewPost && (
        <div className="detail-backdrop" onClick={() => setViewPost(null)}>
          <section className="ig-viewer" onClick={(e) => e.stopPropagation()}>
            <button className="detail-close" onClick={() => setViewPost(null)} aria-label="Закрыть"><X size={20} /></button>
            <img src={viewPost.photoUrl} alt={viewPost.caption || ''} />
            <div className="ig-viewer-bar">
              <span>{viewPost.createdAt ? new Date(viewPost.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''}</span>
              <button onClick={() => void deletePost(viewPost)}><Trash2 size={17} /> Удалить</button>
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

                      {!item.read && <span className="status-on" />}
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