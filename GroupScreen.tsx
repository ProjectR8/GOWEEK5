import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle, ArrowDown, CalendarDays, Check, ChevronLeft, Clock3, Crown, LogOut,
  MapPin, MessageCircle, RotateCcw, Send, Trash2, X,
} from 'lucide-react';
import {
  errorCode,
  goGetEventGroup,
  goGetEventMembers,
  goGetEventMessages,
  goGetGlobalChat,
  goGetGlobalMessages,
  goSendEventMessage,
  goSendGlobalMessage,
  type ApiEventGroup,
  type ApiGlobalChat,
  type ApiGroupMember,
  type ApiGroupMessage,
  type ApiProfile,
  type GroupRole,
} from './goApi';
import Mascot from './Mascot';

type ChatMessage = ApiGroupMessage & {
  status?: 'sending' | 'failed';
  error?: string;
};

type Props = {
  eventId: string;
  fallbackTitle: string;
  me: ApiProfile;
  onClose: () => void;
  onAccessLost: (message: string) => void;
  onLeave: () => void;
  onDelete: () => void;
  onCountChange: (eventId: string, count: number) => void;
  // Открыть анкету участника (из аватара, имени или списка участников).
  onOpenProfile: (uid: string) => void;
  // Режим общего чата: без вкладки участников, событий и выхода.
  global?: boolean;
};

// Общий чат приводим к тому же виду, что и группа события.
const globalToGroup = (chat: ApiGlobalChat): ApiEventGroup => ({
  event: {
    id: 'global',
    title: 'Общий чат',
    description: '',
    category: '',
    date: '',
    time: '',
    place: '',
    createdBy: '',
    participantCount: 0,
    capacity: 0,
    status: 'published',
  },
  role: 'member',
  members: [],
  messages: chat.messages,
  hasMore: chat.hasMore,
  latestSeq: chat.latestSeq,
});

const MAX_LENGTH = 500;
const COLORS = ['blue', 'pink', 'green'];

const colorOf = (uid: string) => {
  let hash = 0;

  for (let i = 0; i < uid.length; i += 1) {
    hash = (hash * 31 + uid.charCodeAt(i)) | 0;
  }

  return COLORS[Math.abs(hash) % COLORS.length];
};

const makeClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const timeOf = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

function dayLabel(ms: number | null) {
  if (!ms) return '';

  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (same(date, today)) return 'Сегодня';
  if (same(date, yesterday)) return 'Вчера';

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Серверные сообщения по seq + ещё не подтверждённые локальные в конце.
function mergeMessages(
  prev: ChatMessage[],
  incoming: ApiGroupMessage[]
): ChatMessage[] {
  const server = new Map<number, ChatMessage>();
  const pending: ChatMessage[] = [];

  for (const message of prev) {
    if (message.status) pending.push(message);
    else server.set(message.seq, message);
  }

  for (const message of incoming) server.set(message.seq, message);

  const confirmed = new Set(
    [...server.values()].map((message) => message.clientId).filter(Boolean)
  );

  return [
    ...[...server.values()].sort((a, b) => a.seq - b.seq),
    ...pending.filter((message) => !confirmed.has(message.clientId)),
  ];
}

function Avatar({
  uid,
  name,
  photoUrl,
  size = 34,
  onOpen,
}: {
  uid: string;
  name: string;
  photoUrl: string;
  size?: number;
  onOpen?: () => void;
}) {
  const face = (
    <span
      className={`g-avatar ${colorOf(uid)}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        (name.trim().slice(0, 1) || '?').toUpperCase()
      )}
    </span>
  );

  if (!onOpen) return face;

  return (
    <button
      type="button"
      className="profile-link"
      onClick={onOpen}
      aria-label={`Открыть анкету: ${name}`}
    >
      {face}
    </button>
  );
}

function OrganizerBadge() {
  return (
    <span className="g-badge">
      <Crown size={10} />
      Организатор
    </span>
  );
}

export default function GroupScreen({
  eventId,
  fallbackTitle,
  me,
  onClose,
  onAccessLost,
  onLeave,
  onDelete,
  onCountChange,
  onOpenProfile,
  global: isGlobal = false,
}: Props) {
  const [group, setGroup] = useState<ApiEventGroup | null>(null);
  const [members, setMembers] = useState<ApiGroupMember[]>([]);
  const [role, setRole] = useState<GroupRole>('member');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<'chat' | 'members'>('chat');
  const [draft, setDraft] = useState('');
  const [unseen, setUnseen] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef('');
  const lastSeq = useRef(0);
  const stick = useRef(true);
  const inFlight = useRef(false);
  const membersInFlight = useRef(false);
  const activityAt = useRef(Date.now());
  const sending = useRef(new Set<string>());
  const pollNow = useRef<() => void>(() => undefined);
  const memberCount = useRef(0);
  const restoreScroll = useRef<number | null>(null);
  const forceBottom = useRef(false);

  // Колбэки родителя держим в ref, чтобы подписка не пересоздавалась при каждом рендере.
  const cb = useRef({ onAccessLost, onCountChange });
  cb.current = { onAccessLost, onCountChange };

  const loaded = group !== null;

  const refreshMembers = useCallback(async () => {
    if (isGlobal || membersInFlight.current) return;

    membersInFlight.current = true;

    try {
      const result = await goGetEventMembers({ eventId });

      setMembers(result.members);
      setRole(result.role);
      memberCount.current = result.event.participantCount;
      cb.current.onCountChange(eventId, result.event.participantCount);
    } catch (error) {
      const code = errorCode(error);

      if (code === 'permission-denied' || code === 'not-found') {
        cb.current.onAccessLost('Доступ к группе закрыт');
      }
    } finally {
      membersInFlight.current = false;
    }
  }, [eventId, isGlobal]);

  // Первичная загрузка: участники и последняя страница истории.
  useEffect(() => {
    let cancelled = false;

    setGroup(null);
    setLoadError('');

    const request: Promise<ApiEventGroup> = isGlobal
      ? goGetGlobalChat({ limit: 30 }).then(globalToGroup)
      : goGetEventGroup({ eventId, limit: 30 });

    request
      .then((result) => {
        if (cancelled) return;

        setGroup(result);
        setMembers(result.members);
        setRole(result.role);
        setMessages(result.messages);
        setHasMore(result.hasMore);

        lastSeq.current = result.messages.length
          ? result.messages[result.messages.length - 1].seq
          : 0;

        memberCount.current = result.event.participantCount;
        forceBottom.current = true;
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        const code = errorCode(error);

        if (code === 'permission-denied' || code === 'not-found') {
          cb.current.onAccessLost(
            code === 'not-found'
              ? 'Событие больше недоступно'
              : 'Доступ к группе закрыт'
          );
          return;
        }

        const raw =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message)
            : '';

        // «internal» приходит и когда функции чата ещё не задеплоены на сервер.
        setLoadError(
          code === 'internal' || raw === 'internal' || !raw
            ? 'Сервер чатов не отвечает. Проверь соединение. Если ты разработчик — убедись, что functions задеплоены (firebase deploy --only functions).'
            : raw
        );
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, attempt, isGlobal]);

  // Подписка на новые сообщения: только пока экран открыт, только пока вкладка видна,
  // без параллельных запросов. Тихий чат опрашивается реже. Отписка — в cleanup.
  useEffect(() => {
    if (!loaded) return;

    let stopped = false;
    let timer: number | undefined;

    const delay = () => {
      const idle = Date.now() - activityAt.current;

      return idle < 30000 ? 2500 : idle < 120000 ? 5000 : 10000;
    };

    const schedule = () => {
      if (!stopped) timer = window.setTimeout(() => void tick(), delay());
    };

    const tick = async () => {
      if (stopped) return;

      if (document.visibilityState === 'hidden' || inFlight.current) {
        schedule();
        return;
      }

      inFlight.current = true;

      let again = false;

      try {
        const page = isGlobal
          ? await goGetGlobalMessages({ afterSeq: lastSeq.current })
          : await goGetEventMessages({
              eventId,
              afterSeq: lastSeq.current,
            });

        if (stopped) return;

        if (page.messages.length > 0) {
          const last = page.messages[page.messages.length - 1];

          lastSeq.current = Math.max(lastSeq.current, last.seq);
          activityAt.current = Date.now();

          if (!stick.current) {
            const foreign = page.messages.filter(
              (message) => message.uid !== me.uid
            ).length;

            if (foreign) setUnseen((count) => count + foreign);
          }

          setMessages((prev) => mergeMessages(prev, page.messages));
        }

        // Если страница была полной, забираем остальное сразу, без ожидания.
        again = page.hasMore;

        if (!isGlobal && page.participantCount !== memberCount.current) {
          memberCount.current = page.participantCount;
          void refreshMembers();
        }
      } catch (error) {
        const code = errorCode(error);

        if (code === 'permission-denied' || code === 'not-found') {
          stopped = true;

          cb.current.onAccessLost(
            code === 'not-found'
              ? 'Событие удалено организатором'
              : 'Доступ к группе закрыт'
          );

          return;
        }
      } finally {
        inFlight.current = false;
      }

      if (again) {
        void tick();
        return;
      }

      schedule();
    };

    pollNow.current = () => {
      window.clearTimeout(timer);
      void tick();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') pollNow.current();
    };

    document.addEventListener('visibilitychange', onVisible);
    schedule();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      pollNow.current = () => undefined;
    };
  }, [eventId, loaded, me.uid, refreshMembers, isGlobal]);

  // Прокрутка: к низу при открытии и своих сообщениях, иначе сохраняем позицию.
  useLayoutEffect(() => {
    const el = listRef.current;

    if (!el) return;

    if (restoreScroll.current !== null) {
      el.scrollTop = el.scrollHeight - restoreScroll.current;
      restoreScroll.current = null;
      return;
    }

    if (forceBottom.current || stick.current) {
      el.scrollTop = el.scrollHeight;
      forceBottom.current = false;
      setUnseen(0);
    }
  }, [messages, tab, loaded]);

  const onScroll = () => {
    const el = listRef.current;

    if (!el) return;

    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;

    if (stick.current && unseen) setUnseen(0);
  };

  const scrollToBottom = () => {
    const el = listRef.current;

    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });

    setUnseen(0);
  };

  const loadOlder = async () => {
    if (loadingOlder) return;

    const first = messages.find((message) => !message.status);

    if (!first) return;

    setLoadingOlder(true);

    try {
      const page = isGlobal
        ? await goGetGlobalMessages({ beforeSeq: first.seq, limit: 30 })
        : await goGetEventMessages({
            eventId,
            beforeSeq: first.seq,
            limit: 30,
          });

      restoreScroll.current = listRef.current?.scrollHeight ?? null;
      setMessages((prev) => mergeMessages(prev, page.messages));
      setHasMore(page.hasMore);
    } catch (error) {
      const code = errorCode(error);

      if (code === 'permission-denied' || code === 'not-found') {
        cb.current.onAccessLost('Доступ к группе закрыт');
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  const deliver = async (text: string, clientId: string) => {
    // Одно и то же сообщение не отправляется параллельно дважды.
    if (sending.current.has(clientId)) return;

    sending.current.add(clientId);

    try {
      const result = isGlobal
        ? await goSendGlobalMessage({ text, clientId })
        : await goSendEventMessage({ eventId, text, clientId });

      activityAt.current = Date.now();
      setMessages((prev) => mergeMessages(prev, [result.message]));
      pollNow.current();
    } catch (error) {
      const code = errorCode(error);

      if (code === 'permission-denied' || code === 'not-found') {
        cb.current.onAccessLost('Доступ к группе закрыт');
        return;
      }

      const reason =
        code === 'resource-exhausted'
          ? 'Слишком часто'
          : 'Не отправлено';

      setMessages((prev) =>
        prev.map((message) =>
          message.clientId === clientId
            ? { ...message, status: 'failed', error: reason }
            : message
        )
      );
    } finally {
      sending.current.delete(clientId);
    }
  };

  const submit = () => {
    const text = draftRef.current.trim();

    if (!text) return;

    const clientId = makeClientId();

    // Сразу очищаем поле: второй тап/Enter уже видит пустой текст.
    draftRef.current = '';
    setDraft('');

    const optimistic: ChatMessage = {
      id: `local-${clientId}`,
      seq: 0,
      uid: me.uid,
      name: me.name,
      photoUrl: me.photoUrl || '',
      text,
      createdAt: Date.now(),
      clientId,
      role,
      status: 'sending',
    };

    forceBottom.current = true;
    setMessages((prev) => [...prev, optimistic]);
    void deliver(text, clientId);
  };

  const retry = (message: ChatMessage) => {
    setMessages((prev) =>
      prev.map((item) =>
        item.clientId === message.clientId
          ? { ...item, status: 'sending', error: undefined }
          : item
      )
    );

    void deliver(message.text, message.clientId);
  };

  const discard = (message: ChatMessage) =>
    setMessages((prev) =>
      prev.filter((item) => item.clientId !== message.clientId)
    );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const onChange = (value: string) => {
    draftRef.current = value;
    setDraft(value);

    const el = inputRef.current;

    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
    }
  };

  const event = group?.event;
  const total = members.length || event?.participantCount || 0;

  return (
    <div className="fs-screen group-screen" role="dialog" aria-modal="true">
      <header className="group-head">
        <button className="group-back" onClick={onClose} aria-label="Назад">
          <ChevronLeft size={22} />
        </button>

        <div className="group-title">
          <b>{event?.title || fallbackTitle}</b>
          <small>
            {isGlobal
              ? 'Все участники GO твоего возраста'
              : `${total} участников${role === 'organizer' ? ' · ты организатор' : ''}`}
          </small>
        </div>
      </header>

      {!isGlobal && (
      <div className="group-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'on' : ''}
          onClick={() => setTab('chat')}
        >
          <MessageCircle size={15} />
          Чат
        </button>

        <button
          role="tab"
          aria-selected={tab === 'members'}
          className={tab === 'members' ? 'on' : ''}
          onClick={() => setTab('members')}
        >
          Участники · {total}
        </button>
      </div>
      )}

      {!group && !loadError && (
        <div className="group-state">
          <span className="spinner" aria-hidden="true" />
          <span>Открываем группу…</span>
        </div>
      )}

      {loadError && (
        <div className="group-state">
          <AlertCircle size={28} />
          <b>Не удалось открыть группу</b>
          <span>{loadError}</span>
          <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
            Повторить
          </button>
        </div>
      )}

      {group && tab === 'chat' && (
        <>
          <div className="chat-list" ref={listRef} onScroll={onScroll}>
            {hasMore && (
              <button
                className="chat-older"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
              >
                {loadingOlder ? 'Загружаем…' : 'Показать ранее'}
              </button>
            )}

            {messages.length === 0 ? (
              <div className="chat-empty">
                <Mascot size={150} />
                <b>Здесь пока тихо</b>
                <span>
                  {isGlobal
                    ? 'Напиши первым: поздоровайся со всеми и расскажи, чем занимаешься.'
                    : 'Напиши первым: поздоровайся и договорись о деталях встречи.'}
                </span>
              </div>
            ) : (
              messages.map((message, index) => {
                const prev = messages[index - 1];
                const mine = message.uid === me.uid;
                const newDay =
                  !prev || dayLabel(prev.createdAt) !== dayLabel(message.createdAt);
                const grouped = Boolean(prev) && !newDay && prev.uid === message.uid;

                return (
                  <div key={message.clientId || message.id}>
                    {newDay && (
                      <div className="chat-day">{dayLabel(message.createdAt)}</div>
                    )}

                    <div
                      className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}
                    >
                      {!mine && (
                        <span className="chat-avatar">
                          {!grouped && (
                            <Avatar
                              uid={message.uid}
                              name={message.name}
                              photoUrl={message.photoUrl}
                              onOpen={() => onOpenProfile(message.uid)}
                            />
                          )}
                        </span>
                      )}

                      <div className="chat-bubble-wrap">
                        {!mine && !grouped && (
                          <div className="chat-author">
                            <button
                              type="button"
                              className="profile-link name"
                              onClick={() => onOpenProfile(message.uid)}
                            >
                              {message.name}
                            </button>
                            {message.role === 'organizer' && <OrganizerBadge />}
                          </div>
                        )}

                        <div
                          className={`chat-bubble${message.status === 'failed' ? ' failed' : ''}${message.status === 'sending' ? ' pending' : ''}`}
                        >
                          <span className="chat-text">{message.text}</span>
                          <span className="chat-time">
                            {message.status === 'sending'
                              ? 'Отправка…'
                              : timeOf(message.createdAt)}
                            {mine && !message.status && (
                              <Check size={11} className="chat-check" />
                            )}
                          </span>
                        </div>

                        {message.status === 'failed' && (
                          <div className="chat-failed">
                            <AlertCircle size={12} />
                            {message.error || 'Не отправлено'}
                            <button onClick={() => retry(message)}>
                              <RotateCcw size={12} />
                              Повторить
                            </button>
                            <button
                              onClick={() => discard(message)}
                              aria-label="Удалить сообщение"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {unseen > 0 && (
            <button className="chat-new" onClick={scrollToBottom}>
              <ArrowDown size={14} />
              Новые сообщения · {unseen}
            </button>
          )}

          <form
            className="chat-input"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_LENGTH}
              enterKeyHint="send"
              placeholder="Сообщение…"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
            />

            <button
              type="submit"
              className="chat-send"
              disabled={!draft.trim()}
              aria-label="Отправить"
            >
              <Send size={18} />
            </button>
          </form>
        </>
      )}

      {group && tab === 'members' && event && (
        <div className="group-members" ref={listRef}>
          <div className="fs-block">
            <h3>О событии</h3>

            <div className="detail-facts">
              <span>
                <CalendarDays size={16} />
                {event.date}
              </span>
              <span>
                <Clock3 size={16} />
                {event.time}
              </span>
              <span>
                <MapPin size={16} />
                {event.place}
              </span>
            </div>

            {event.description && <p className="group-desc">{event.description}</p>}
          </div>

          <div className="fs-block">
            <h3>
              Участники · {total} из {event.capacity}
            </h3>

            <div className="member-list">
              {members.map((member) => (
                <div
                  className={`member-row${member.uid === me.uid ? '' : ' clickable'}`}
                  key={member.uid}
                  role={member.uid === me.uid ? undefined : 'button'}
                  tabIndex={member.uid === me.uid ? undefined : 0}
                  onClick={() => {
                    if (member.uid !== me.uid) onOpenProfile(member.uid);
                  }}
                  onKeyDown={(keyEvent) => {
                    if (
                      member.uid !== me.uid &&
                      (keyEvent.key === 'Enter' || keyEvent.key === ' ')
                    ) {
                      keyEvent.preventDefault();
                      onOpenProfile(member.uid);
                    }
                  }}
                >
                  <Avatar
                    uid={member.uid}
                    name={member.name}
                    photoUrl={member.photoUrl}
                    size={40}
                  />

                  <span className="member-name">
                    {member.name}
                    {member.uid === me.uid && <small>это ты</small>}
                  </span>

                  {member.role === 'organizer' && <OrganizerBadge />}
                </div>
              ))}
            </div>
          </div>

          {role === 'organizer' ? (
            <button className="ghost danger full-btn" onClick={onDelete}>
              <Trash2 size={16} />
              Удалить событие
            </button>
          ) : (
            <button className="ghost danger full-btn" onClick={onLeave}>
              <LogOut size={16} />
              Покинуть событие
            </button>
          )}
        </div>
      )}
    </div>
  );
}
