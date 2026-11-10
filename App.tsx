import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowRight, ArrowUpRight, Bell, CalendarDays, Check,
  ChevronRight, Compass, MapPin, Plus, Search,
  Settings, Sparkles, Users, UsersRound, UserRound,
  X, Clock3, SlidersHorizontal
} from 'lucide-react';
import { firebaseConfigured } from './firebase';
import { authenticateTelegram } from './telegramAuth';
import {
  goCreateEvent,
  goGetData,
  goJoinEvent,
  goMarkNotificationsRead,
  goSaveProfile,
  goSwipe,
  goToggleClub,
  type ApiMatch,
  type ApiNotification,
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
};

type Club = {
  id: string;
  title: string;
  members: string;
  description: string;
  icon: string;
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

const clubs: Club[] = [
  {
    id: 'gaming', title: 'Игровой клуб', members: '128 участников',
    description: 'Настольные и видеоигры, командные вечера и турниры без токсичности.', icon: 'game',
  },
  {
    id: 'art', title: 'Арт-комьюнити', members: '86 участников',
    description: 'Рисование, дизайн, фотография и творческие челленджи.', icon: 'art',
  },
  {
    id: 'tech', title: 'Технологии', members: '54 участника',
    description: 'Программирование, электроника, пет-проекты и взаимопомощь.', icon: 'tech',
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
  };
}

function eventColor(category: string) {
  const value = category.toLowerCase();

  if (value.includes('тех') || value.includes('код') || value.includes('онлайн')) {
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
  const [events, setEvents] = useState<EventItem[]>(firebaseConfigured ? [] : demoEvents);
  const [allPeople, setAllPeople] = useState<Person[]>(firebaseConfigured ? [] : demoPeople);
  const [people, setPeople] = useState<Person[]>(firebaseConfigured ? [] : demoPeople);
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [clubJoined, setClubJoined] = useState<string[]>([]);
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    category: 'Встреча',
    date: '',
    time: '',
    place: '',
  });

  const startX = useRef(0);

  const currentPerson = people.find((person) => {
    const search = peopleQuery.trim().toLowerCase();

    if (!search) return true;

    return [person.name, person.city, person.bio, ...person.interests]
      .some((value) => value.toLowerCase().includes(search));
  });

  const unreadCount = notifications.filter((item) => !item.read).length;

  // Telegram Mini App setup.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) return;

    tg.ready();
    tg.expand();

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

      setEvents(data.events.map(toEvent));
      setMatches(data.matches || []);
      setNotifications(data.notifications || []);
      setClubJoined(data.clubMemberships || []);

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
  }, [authStatus]);  // Telegram back button.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const handleBack = () => {
      if (notificationsOpen) setNotificationsOpen(false);
      else if (detail) setDetail(null);
      else if (tab !== 'home') {
        setTab('home');
        setNotice('');
      }
    };

    if (detail || notificationsOpen || tab !== 'home') tg.BackButton.show();
    else tg.BackButton.hide();

    tg.BackButton.onClick(handleBack);

    return () => tg.BackButton.offClick(handleBack);
  }, [detail, notificationsOpen, tab]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setNotice('');
    setDetail(null);
    setNotificationsOpen(false);
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
    await submitSwipe(currentPerson, direction);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    startX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startX.current && !swipeLock) {
      setDragX(
        Math.max(
          -150,
          Math.min(150, event.clientX - startX.current)
        )
      );
    }
  };

  const onPointerUp = () => {
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
      !eventForm.place.trim()
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
      });

      setEventForm({
        title: '',
        description: '',
        category: 'Встреча',
        date: '',
        time: '',
        place: '',
      });

      await refreshData();

      setNotice('Событие опубликовано. Ты добавлен в участники.');
      setTab('home');
    } catch (error) {
      setNotice(
        `Не удалось опубликовать событие: ${errorMessage(error)}`
      );
    }
  };

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

  return (
    <div className="app-shell">
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
            <span aria-label={`${unreadCount} непрочитанных`} />
          )}
        </button>
      </header>

      {!firebaseConfigured && (
        <div className="setup-banner">
          <span className="pulse" />
          Демо-режим: Firebase не настроен, действия не сохраняются на сервере.
        </div>
      )}

      <main className="main-content">
        {tab === 'home' && (
          <section className="screen screen-home">
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <Sparkles size={14} /> ТВОЯ СРЕДА
                </div>

                <h1>
                  Не сиди в<br />
                  <span>одиночном режиме.</span>
                </h1>

                <p>
                  Находи людей по интересам, собирайся на события
                  и создавай свои движухи.
                </p>

                <button
                  className="primary"
                  onClick={() => changeTab('people')}
                >
                  Найти компанию <ArrowUpRight size={17} />
                </button>
              </div>

              <div className="hero-orb orb-one" />
              <div className="hero-orb orb-two" />

              <div className="hero-stamp">
                <span className="stamp-dot" />
                YOUR PEOPLE. YOUR PLACE.
              </div>
            </section>

            <section className="section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">ВЫБИРАЙСЯ ИЗ ДОМА</div>
                  <h2>Ближайшие встречи</h2>
                </div>

                <button
                  className="text-button"
                  onClick={() => changeTab('communities')}
                >
                  Все <ArrowUpRight size={14} />
                </button>
              </div>

              {events.length > 0 ? (
                <div className="event-grid">
                  {events.slice(0, 2).map((event) => (
                    <button
                      className={`event-card event-${event.color}`}
                      key={event.id}
                      onClick={() => openEvent(event.id)}
                    >
                      <div className="event-topline">
                        <span className="event-category">
                          {event.category}
                        </span>

                        <span className="event-arrow">
                          <ArrowUpRight size={17} />
                        </span>
                      </div>

                      <div className="event-meta">
                        <CalendarDays size={13} />
                        {displayDate(event.date)} · {event.time}
                      </div>

                      <h3>{event.title}</h3>

                      <div className="event-bottom">
                        <span>
                          <MapPin size={13} /> {event.place}
                        </span>
                        <b>{event.participantCount}</b>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Пока нет опубликованных событий. Создай первое!
                </p>
              )}
            </section>

            <section className="section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">СОВПАДАЮТ ИНТЕРЕСЫ</div>
                  <h2>Люди для твоей команды</h2>
                </div>

                <button
                  className="text-button"
                  onClick={() => changeTab('people')}
                >
                  Смотреть <ArrowUpRight size={14} />
                </button>
              </div>

              <div className="people-preview">
                {(people.length > 0 ? people.slice(0, 2) : []).map((person) => (
                  <button
                    className="mini-person"
                    key={person.uid}
                    onClick={() => {
                      setTab('people');
                      openPerson(person.uid);
                    }}
                  >
                    <span className={`mini-avatar ${person.color}`}>
                      {person.initials}
                    </span>

                    <span>
                      <b>{person.name}, {person.age}</b>
                      <small>{person.interests[0] || 'Новые знакомства'}</small>
                    </span>

                    <ChevronRight size={17} />
                  </button>
                ))}

                {people.length === 0 && (
                  <p className="muted">
                    Новых анкет пока нет. Загляни позже.
                  </p>
                )}
              </div>
            </section>
          </section>
        )}        {tab === 'people' && (
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
              <div className="community-search">
                <Search size={18} />
                <input
                  value={peopleQuery}
                  onChange={(event) => setPeopleQuery(event.target.value)}
                  placeholder="Имя, город или интерес"
                />
              </div>
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
                        {person.initials}
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
                  <div className="swipe-hint hint-no">ПРОПУСК</div>
                  <div className="swipe-hint hint-yes">ИНТЕРЕСНО</div>

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
                      onClick={() => openPerson(currentPerson.uid)}
                    >
                      <div className="person-art-orb" />
                      <span className="person-number">GO / PROFILE</span>

                      <div className="person-avatar">
                        {currentPerson.initials}
                      </div>

                      <span className="online-pill">
                        <i /> В поиске компании
                      </span>
                    </div>

                    <div
                      className="person-info"
                      onClick={() => openPerson(currentPerson.uid)}
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
                          <span key={tag}>{tag}</span>
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

                {peopleQuery && (
                  <button
                    className="primary"
                    onClick={() => setPeopleQuery('')}
                  >
                    Сбросить поиск
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
          <section className="screen placeholder-page">
            <div className="placeholder-icon">
              <Plus size={28} />
            </div>

            <div className="eyebrow">
              ТВОЯ ИДЕЯ — ТВОЁ СОБЫТИЕ
            </div>

            <h1 className="page-title">
              Создай<br />
              <span>движение.</span>
            </h1>

            <p>
              Собери людей вокруг идеи: прогулка, игра,
              тренировка или совместный проект.
            </p>

            <div className="form-preview">
              <label>
                Название встречи
                <input
                  value={eventForm.title}
                  onChange={(event) =>
                    setEventForm((old) => ({
                      ...old,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Например, вечер настолок"
                  maxLength={70}
                />
              </label>

              <label>
                Что планируете?
                <textarea
                  value={eventForm.description}
                  onChange={(event) =>
                    setEventForm((old) => ({
                      ...old,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Расскажи немного о встрече..."
                  rows={3}
                  maxLength={500}
                />
              </label>

              <label>
                Категория
                <input
                  value={eventForm.category}
                  onChange={(event) =>
                    setEventForm((old) => ({
                      ...old,
                      category: event.target.value,
                    }))
                  }
                  placeholder="Встреча, технологии, творчество"
                  maxLength={30}
                />
              </label>

              <label>
                Дата
                <input
                  type="date"
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

              <label>
                Место встречи
                <input
                  value={eventForm.place}
                  onChange={(event) =>
                    setEventForm((old) => ({
                      ...old,
                      place: event.target.value,
                    }))
                  }
                  placeholder="Парк, молодёжный центр или онлайн"
                  maxLength={100}
                />
              </label>

              <button
                className="primary"
                onClick={() => void createEvent()}
                disabled={dataLoading}
              >
                Опубликовать событие <ArrowRight size={16} />
              </button>
            </div>
          </section>
        )}

        {tab === 'communities' && (
          <section className="screen communities-page">
            <div className="eyebrow">СВОИ ЛЮДИ</div>

            <h1 className="page-title">
              Найди своё<br />
              <span>сообщество.</span>
            </h1>

            <p className="muted">
              Места, где общие интересы превращаются в реальные встречи.
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
                      <UsersRound size={20} />
                    </span>

                    <span className="community-copy">
                      <b>{club.title}</b>
                      <small>{club.members}</small>
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
          <section className="screen profile-page">
            <div className="profile-cover">
              <div className="profile-avatar">
                {profile ? initialsFor(profile.name) : 'G'}
              </div>

              <button
                className="profile-settings"
                aria-label="Настройки"
                onClick={() => setProfileEditing(true)}
              >
                <Settings size={18} />
              </button>
            </div>

            <div className="eyebrow">ТВОЯ СТРАНИЦА</div>

            <h1 className="page-title">Твой профиль.</h1>

            <p className="muted">
              Расскажи о себе, чтобы находить людей со схожими интересами.
            </p>

            {profile && !profileEditing ? (
              <>
                <div className="profile-fields">
                  <div>
                    <span>Имя</span>
                    <b>{profile.name}</b>
                  </div>

                  <div>
                    <span>Возраст</span>
                    <b>{profile.age}</b>
                  </div>

                  <div>
                    <span>Интересы</span>
                    <b>{profile.interests?.join(', ') || 'Не указаны'}</b>
                  </div>

                  <div>
                    <span>Город</span>
                    <b>{profile.city || 'Не указан'}</b>
                  </div>
                </div>

                {profile.bio && (
                  <p className="muted">{profile.bio}</p>
                )}

                <button
                  className="primary full"
                  onClick={() => setProfileEditing(true)}
                >
                  Изменить анкету <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <div className="form-preview">
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
                  <input
                    value={profileForm.city}
                    onChange={(event) =>
                      setProfileForm((old) => ({
                        ...old,
                        city: event.target.value,
                      }))
                    }
                    placeholder="Твой город"
                    maxLength={60}
                  />
                </label>

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
                >
                  Сохранить анкету <Check size={16} />
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
            )}

            <div className="profile-status">
              <span
                className={
                  authStatus === 'signed-in'
                    ? 'status-on'
                    : 'status-off'
                }
              />

              Telegram: {
                authStatus === 'checking'
                  ? 'проверяем вход...'
                  : authStatus === 'signed-in'
                    ? 'авторизован ✓'
                    : authStatus === 'not-in-telegram'
                      ? 'открой через Telegram'
                      : 'ошибка входа'
              }
            </div>

            <div className="profile-status">
              <span
                className={
                  firebaseConfigured ? 'status-on' : 'status-off'
                }
              />
              Firebase: {firebaseConfigured ? 'подключён' : 'не настроен'}
            </div>

            {dataLoading && (
              <div className="profile-status">
                Загружаем данные...
              </div>
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
                  <div className="person-avatar large">
                    {detailPerson.initials}
                  </div>

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
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>

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
                  <UsersRound size={28} />
                </div>

                <div className="eyebrow">СООБЩЕСТВО GO</div>

                <h1>{detailClub.title}</h1>

                <div className="muted">
                  {detailClub.members}
                </div>

                <p>{detailClub.description}</p>

                <div className="club-benefits">
                  <span>
                    <Check size={15} /> Общение по интересам
                  </span>

                  <span>
                    <Check size={15} /> Совместные события
                  </span>

                  <span>
                    <Check size={15} /> Новые знакомства
                  </span>
                </div>

                <button
                  className="primary full"
                  onClick={() => void toggleClub(detailClub.id)}
                >
                  {clubJoined.includes(detailClub.id)
                    ? 'Покинуть сообщество'
                    : 'Вступить в сообщество'}

                  <ArrowRight size={17} />
                </button>
              </div>
            )}
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