
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Bell, CalendarDays, Check,
  ChevronRight, Compass, MapPin, Plus, Search,
  Settings, Sparkles, Users, UsersRound, UserRound,
  X, Clock3, SlidersHorizontal
} from 'lucide-react';
import { firebaseConfigured } from './firebase';
import { authenticateTelegram } from './telegramAuth';

type TelegramWebApp = {
  initData: string;
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
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

type Tab = 'home' | 'people' | 'create' | 'communities' | 'profile';

type Person = {
  name: string;
  age: number;
  city: string;
  bio: string;
  interests: string[];
  color: string;
  initials: string;
  activity: string;
};

const people: Person[] = [
  {
    name: 'Артём',
    age: 16,
    city: 'Рядом с тобой',
    bio: 'Ищу компанию для настолок, небольших проектов и прогулок. Люблю придумывать что-то новое.',
    interests: ['Настольные игры', 'Программирование', 'Кино'],
    color: 'blue',
    initials: 'А',
    activity: 'Ищет команду на выходные'
  },
  {
    name: 'Саша',
    age: 15,
    city: 'Твой город',
    bio: 'Рисую, слушаю музыку и хочу найти друзей, с которыми можно ходить на события.',
    interests: ['Рисование', 'Музыка', 'Прогулки'],
    color: 'pink',
    initials: 'С',
    activity: 'Открыта к новым идеям'
  },
  {
    name: 'Миша',
    age: 17,
    city: 'Твой город',
    bio: 'Люблю футбол, игры и технологии. Буду рад совместным активностям.',
    interests: ['Футбол', 'Игры', 'Технологии'],
    color: 'green',
    initials: 'М',
    activity: 'Собирает игровую команду'
  }
];

const events = [
  {
    id: 1,
    title: 'Вечер настолок',
    category: 'Встреча',
    date: 'Суббота',
    time: '16:00',
    place: 'Молодёжный центр',
    people: '4 из 12 участников',
    color: 'lavender',
    description: 'Знакомимся, выбираем настольную игру и проводим вечер в хорошей компании. Новичкам тоже рады.'
  },
  {
    id: 2,
    title: 'Мини-хакатон',
    category: 'Технологии',
    date: 'Воскресенье',
    time: '14:00',
    place: 'Онлайн',
    people: '3 из 8 участников',
    color: 'orange',
    description: 'Небольшая командная сессия: идеи, прототипы и обмен опытом. Можно прийти просто посмотреть.'
  },
  {
    id: 3,
    title: 'Прогулка с фото',
    category: 'Творчество',
    date: 'Среда',
    time: '17:30',
    place: 'Городской парк',
    people: '5 из 10 участников',
    color: 'mint',
    description: 'Неспешная прогулка, фотографии на телефон и новые знакомства.'
  }
];

const clubs = [
  {
    title: 'Игровой клуб',
    members: '128 участников',
    description: 'Настольные и видеоигры, командные вечера и турниры без токсичности.',
    icon: 'game'
  },
  {
    title: 'Арт-комьюнити',
    members: '86 участников',
    description: 'Рисование, дизайн, фотография и творческие челленджи.',
    icon: 'art'
  },
  {
    title: 'Технологии',
    members: '54 участника',
    description: 'Программирование, электроника, пет-проекты и взаимопомощь.',
    icon: 'tech'
  }
];

const nav = [
  { id: 'home' as const, label: 'Главная', Icon: Compass },
  { id: 'people' as const, label: 'Люди', Icon: Search },
  { id: 'create' as const, label: 'Создать', Icon: Plus },
  { id: 'communities' as const, label: 'Клубы', Icon: UsersRound },
  { id: 'profile' as const, label: 'Профиль', Icon: UserRound }
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [personIndex, setPersonIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [swipeDirection, setSwipeDirection] =
    useState<'left' | 'right' | ''>('');

  const [detail, setDetail] = useState<{
    type: 'person' | 'event' | 'club';
    index: number;
  } | null>(null);

  const [notice, setNotice] = useState('');
  const [authStatus, setAuthStatus] = useState<
    'checking' | 'signed-in' | 'error' | 'not-in-telegram'
  >('checking');
  const [joined, setJoined] = useState<number[]>([]);
  const [clubJoined, setClubJoined] = useState<number[]>([]);
  const [query, setQuery] = useState('');

  const startX = useRef(0);
  const currentPerson = people[personIndex % people.length];

  // Telegram Mini App initialization
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) return;

    tg.ready();
    tg.expand();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initData = window.Telegram?.WebApp?.initData;

    if (!initData) {
      setAuthStatus('not-in-telegram');
      setNotice('Открой GO через Telegram');
      return;
    }

    authenticateTelegram(initData)
      .then(() => {
        if (!cancelled) {
          setAuthStatus('signed-in');
          setNotice('Вход через Telegram выполнен успешно');
        }
      })
      .catch((error) => {
        console.error('Telegram auth error:', error);
        if (!cancelled) {
          setAuthStatus('error');
          setNotice('Ошибка авторизации Telegram. Попробуй открыть GO заново.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);


  // Telegram Back Button
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) return;

    const handleBack = () => {
      if (detail) {
        setDetail(null);
      } else if (tab !== 'home') {
        setTab('home');
        setNotice('');
      }
    };

    if (detail || tab !== 'home') {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }

    tg.BackButton.onClick(handleBack);

    return () => {
      tg.BackButton.offClick(handleBack);
    };
  }, [detail, tab]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setNotice('');
    setDetail(null);
  };

  const finishSwipe = (direction: 'left' | 'right') => {
    if (swipeDirection) return;

    setSwipeDirection(direction);

    window.setTimeout(() => {
      setPersonIndex((n) => n + 1);
      setDragX(0);
      setSwipeDirection('');

      setNotice(
        direction === 'right'
          ? `Запрос на совместную активность отправлен: ${currentPerson.name}`
          : 'Анкета пропущена'
      );
    }, 230);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startX.current) {
      setDragX(Math.max(-150, Math.min(150, e.clientX - startX.current)));
    }
  };

  const onPointerUp = () => {
    if (dragX > 90) finishSwipe('right');
    else if (dragX < -90) finishSwipe('left');
    else setDragX(0);

    startX.current = 0;
  };

  const joinEvent = (id: number) => {
    setJoined((old) =>
      old.includes(id) ? old : [...old, id]
    );

    setNotice('Ты добавлен в список участников.');
  };

  const openPerson = (index: number) =>
    setDetail({ type: 'person', index });

  const openEvent = (index: number) =>
    setDetail({ type: 'event', index });

  const openClub = (index: number) =>
    setDetail({ type: 'club', index });

  return (
    <div className="app-shell">

      <header className="topbar">
        <button
          className="brand"
          onClick={() => changeTab('home')}
          aria-label="На главную"
        >
          <span className="brand-mark">G</span>
          <span>GO<span className="brand-dot">.</span></span>
        </button>

        <div className="top-caption">
          Люди рядом. Интересы вместе.
        </div>

        <button
          className="icon-button top-action"
          aria-label="Уведомления"
          onClick={() => setNotice('Пока новых уведомлений нет.')}
        >
          <Bell size={19} />
        </button>
      </header>

      {!firebaseConfigured && (
        <div className="setup-banner">
          <span className="pulse" />
          Демо-режим: подключение Firebase настроим следующим этапом.
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

              <div className="event-grid">
                {events.slice(0, 2).map((event, index) => (
                  <button
                    className={`event-card event-${event.color}`}
                    key={event.id}
                    onClick={() => openEvent(index)}
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
                      {event.date} · {event.time}
                    </div>

                    <h3>{event.title}</h3>

                    <div className="event-bottom">
                      <span>
                        <MapPin size={13} /> {event.place}
                      </span>
                      <b>{event.people.split(' ')[0]}</b>
                    </div>
                  </button>
                ))}
              </div>
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
                {people.slice(0, 2).map((p, i) => (
                  <button
                    className="mini-person"
                    key={p.name}
                    onClick={() => {
                      setTab('people');
                      openPerson(i);
                    }}
                  >
                    <span className={`mini-avatar ${p.color}`}>
                      {p.initials}
                    </span>

                    <span>
                      <b>{p.name}, {p.age}</b>
                      <small>{p.interests[0]}</small>
                    </span>

                    <ChevronRight size={17} />
                  </button>
                ))}
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
                onClick={() => setNotice('Фильтры добавим следующим этапом.')}
              >
                <SlidersHorizontal size={19} />
              </button>
            </div>

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
                      : 'none'
                }}
              >
                <div
                  className={`person-art ${currentPerson.color}`}
                  onClick={() => openPerson(personIndex % people.length)}
                >
                  <div className="person-art-orb" />

                  <span className="person-number">
                    0{personIndex % people.length + 1} / 0{people.length}
                  </span>

                  <div className="person-avatar">
                    {currentPerson.initials}
                  </div>

                  <span className="online-pill">
                    <i /> В поиске компании
                  </span>
                </div>

                <div
                  className="person-info"
                  onClick={() => openPerson(personIndex % people.length)}
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

                  <button className="profile-open">
                    Открыть анкету <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
            </div>

            <div className="swipe-actions">
              <button
                className="skip"
                onClick={() => finishSwipe('left')}
                aria-label="Пропустить"
              >
                <X size={23} />
              </button>

              <button
                className="like"
                onClick={() => finishSwipe('right')}
                aria-label="Найти компанию"
              >
                <Users size={20} />
                <span>Найти компанию</span>
              </button>
            </div>

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
                <input placeholder="Например, вечер настолок" />
              </label>

              <label>
                Что планируете?
                <textarea
                  placeholder="Расскажи немного о встрече..."
                  rows={3}
                />
              </label>

              <button
                className="primary"
                onClick={() => setNotice('Публикацию событий подключим после настройки базы данных.')}
              >
                Продолжить <ArrowRight size={16} />
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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск сообществ"
              />
            </div>

            <div className="community-list">
              {clubs
                .filter((club) =>
                  club.title.toLowerCase().includes(query.toLowerCase())
                )
                .map((club) => {
                  const index = clubs.indexOf(club);

                  return (
                    <button
                      className="community-card"
                      key={club.title}
                      onClick={() => openClub(index)}
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
                  );
                })}
            </div>
          </section>
        )}

        {tab === 'profile' && (
          <section className="screen profile-page">
            <div className="profile-cover">
              <div className="profile-avatar">G</div>

              <button
                className="profile-settings"
                aria-label="Настройки"
              >
                <Settings size={18} />
              </button>
            </div>

            <div className="eyebrow">ТВОЯ СТРАНИЦА</div>

            <h1 className="page-title">Твой профиль.</h1>

            <p className="muted">
              Расскажи о себе, чтобы находить людей со схожими интересами.
            </p>

            <div className="profile-fields">
              <div>
                <span>Имя</span>
                <b>Новый участник</b>
              </div>

              <div>
                <span>Интересы</span>
                <b>Пока не добавлены</b>
              </div>

              <div>
                <span>Город</span>
                <b>Не указан</b>
              </div>
            </div>

            <div className="profile-status">
              <span className={authStatus === 'signed-in' ? 'status-on' : 'status-off'} />
              Telegram: {
                authStatus === 'checking' ? 'проверяем вход...' :
                authStatus === 'signed-in' ? 'авторизован ✓' :
                authStatus === 'not-in-telegram' ? 'открой через Telegram' :
                'ошибка входа'
              }
            </div>

            <div className="profile-status">
              <span className={firebaseConfigured ? 'status-on' : 'status-off'} />
              Firebase: {firebaseConfigured ? 'подключён' : 'не настроен'}
            </div>
          </section>
        )}
      </main>

      {notice && (
        <button className="toast" onClick={() => setNotice('')}>
          <Check size={16} />
          {notice}
          <X size={15} />
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-handle" />

            <button
              className="detail-close"
              onClick={() => setDetail(null)}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>

            {detail.type === 'person' && (() => {
              const p = people[detail.index % people.length];

              return (
                <>
                  <div className={`detail-person-art ${p.color}`}>
                    <div className="person-avatar large">
                      {p.initials}
                    </div>

                    <span className="online-pill">
                      <i /> {p.activity}
                    </span>
                  </div>

                  <div className="detail-content">
                    <div className="eyebrow">АНКЕТА УЧАСТНИКА</div>

                    <h1>{p.name}, {p.age}</h1>

                    <div className="person-location">
                      <MapPin size={14} /> {p.city}
                    </div>

                    <p>{p.bio}</p>

                    <h3>Интересы</h3>

                    <div className="tags">
                      {p.interests.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>

                    <button
                      className="primary full"
                      onClick={() => {
                        setDetail(null);
                        setNotice(`Запрос на совместную активность отправлен: ${p.name}`);
                      }}
                    >
                      Предложить активность <Users size={17} />
                    </button>
                  </div>
                </>
              );
            })()}

            {detail.type === 'event' && (() => {
              const event = events[detail.index];
              const isJoined = joined.includes(event.id);

              return (
                <>
                  <div className={`detail-event-art event-${event.color}`}>
                    <CalendarDays size={44} />
                    <span>СОБЫТИЕ GO</span>
                  </div>

                  <div className="detail-content">
                    <div className="eyebrow">{event.category}</div>

                    <h1>{event.title}</h1>

                    <div className="detail-facts">
                      <span><CalendarDays size={16} />{event.date}</span>
                      <span><Clock3 size={16} />{event.time}</span>
                      <span><MapPin size={16} />{event.place}</span>
                    </div>

                    <p>{event.description}</p>

                    <div className="event-capacity">
                      {event.people}
                    </div>

                    <button
                      className="primary full"
                      onClick={() => joinEvent(event.id)}
                    >
                      {isJoined ? 'Ты участвуешь' : 'Присоединиться'}
                      <Check size={17} />
                    </button>
                  </div>
                </>
              );
            })()}

            {detail.type === 'club' && (() => {
              const club = clubs[detail.index];
              const isJoined = clubJoined.includes(detail.index);

              return (
                <div className="detail-content club-detail">
                  <div className="community-symbol big">
                    <UsersRound size={28} />
                  </div>

                  <div className="eyebrow">СООБЩЕСТВО GO</div>

                  <h1>{club.title}</h1>

                  <div className="muted">{club.members}</div>

                  <p>{club.description}</p>

                  <div className="club-benefits">
                    <span><Check size={15} /> Общение по интересам</span>
                    <span><Check size={15} /> Совместные события</span>
                    <span><Check size={15} /> Новые знакомства</span>
                  </div>

                  <button
                    className="primary full"
                    onClick={() =>
                      setClubJoined((old) =>
                        isJoined
                          ? old.filter((n) => n !== detail.index)
                          : [...old, detail.index]
                      )
                    }
                  >
                    {isJoined ? 'Покинуть сообщество' : 'Вступить в сообщество'}
                    <ArrowRight size={17} />
                  </button>
                </div>
              );
            })()}
          </section>
        </div>
      )}
    </div>
  );
}
