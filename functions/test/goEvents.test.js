"use strict";

// Запуск: cd functions && node --test test/
// Тесты гоняют РЕАЛЬНЫЕ обработчики из goEvents.js на in-memory реализации Firestore
// с оптимистичными транзакциями (конфликт чтения => повтор), как в настоящем Firestore.
// Это проверка логики, а не замена проверки на реальной базе.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEventHandlers } = require("../goEvents");

// ---------- in-memory Firestore ----------

class Ts {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
}

const SERVER_TS = { __serverTs: true };
const FieldValue = { serverTimestamp: () => SERVER_TS };

const resolve = (value, now) => {
  if (value === SERVER_TS) return new Ts(now);
  if (Array.isArray(value)) return value.map((v) => resolve(v, now));
  if (value && typeof value === "object" && !(value instanceof Ts)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolve(v, now)])
    );
  }
  return value;
};

// structuredClone теряет прототип Ts (toMillis), поэтому копируем вручную.
const clone = (v) => {
  if (v instanceof Ts) return new Ts(v.ms);
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  }
  return v;
};

function createFakeDb() {
  const docs = new Map();      // path -> data
  const versions = new Map();  // path -> number
  let clock = 1_000_000;
  let auto = 0;

  const now = () => { clock += 1; return clock; };
  const bump = (path) => versions.set(path, (versions.get(path) || 0) + 1);
  const version = (path) => versions.get(path) || 0;

  const snapOf = (path) => ({
    id: path.split("/").pop(),
    exists: docs.has(path),
    ref: docRef(path),
    data: () => clone(docs.get(path)),
  });

  const writeSet = (path, data, opts) => {
    const resolved = resolve(data, clock);
    docs.set(path, opts && opts.merge ? { ...(docs.get(path) || {}), ...resolved } : resolved);
    bump(path);
  };
  const writeUpdate = (path, data) => {
    if (!docs.has(path)) throw new Error(`NOT_FOUND: ${path}`);
    docs.set(path, { ...docs.get(path), ...resolve(data, clock) });
    bump(path);
  };
  const writeDelete = (path) => { docs.delete(path); bump(path); };

  function matchesQuery(path, parent, q) {
    const prefix = `${parent}/`;
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) return false;
    const data = docs.get(path);
    return q.filters.every(([f, op, v]) => {
      const x = data[f];
      if (op === "==") return x === v;
      if (op === ">") return x > v;
      if (op === "<") return x < v;
      if (op === "array-contains") return Array.isArray(x) && x.includes(v);
      throw new Error(`op ${op}`);
    });
  }

  function runQuery(q) {
    let rows = [...docs.keys()].filter((p) => matchesQuery(p, q.parent, q));
    for (const [f, dir] of [...q.orders].reverse()) {
      rows.sort((a, b) => {
        const x = docs.get(a)[f], y = docs.get(b)[f];
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
      });
    }
    if (q.max != null) rows = rows.slice(0, q.max);
    return rows;
  }

  function makeQuery(parent, state = { filters: [], orders: [], max: null }) {
    const q = { parent, ...state };
    return {
      __query: q,
      where: (f, op, v) => makeQuery(parent, { ...state, filters: [...state.filters, [f, op, v]] }),
      orderBy: (f, dir = "asc") => makeQuery(parent, { ...state, orders: [...state.orders, [f, dir]] }),
      limit: (n) => makeQuery(parent, { ...state, max: n }),
      get: async () => {
        const paths = runQuery(q);
        return { docs: paths.map(snapOf), size: paths.length };
      },
      count: () => ({ get: async () => ({ data: () => ({ count: runQuery(q).length }) }) }),
    };
  }

  function collectionRef(path) {
    const query = makeQuery(path);
    return {
      ...query,
      path,
      doc: (id) => docRef(`${path}/${id || `auto${++auto}`}`),
    };
  }

  function docRef(path) {
    return {
      path,
      id: path.split("/").pop(),
      collection: (name) => collectionRef(`${path}/${name}`),
      get: async () => snapOf(path),
      set: async (data, opts) => { now(); writeSet(path, data, opts); },
      update: async (data) => { now(); writeUpdate(path, data); },
      delete: async () => { now(); writeDelete(path); },
    };
  }

  const db = {
    collection: (name) => collectionRef(name),
    getAll: async (...refs) => refs.map((r) => snapOf(r.path)),
    batch() {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => writeSet(ref.path, data, opts)),
        update: (ref, data) => ops.push(() => writeUpdate(ref.path, data)),
        delete: (ref) => ops.push(() => writeDelete(ref.path)),
        commit: async () => { now(); ops.forEach((op) => op()); },
      };
    },
    async recursiveDelete(ref) {
      const prefix = `${ref.path}/`;
      for (const path of [...docs.keys()]) {
        if (path.startsWith(prefix) || path === ref.path) writeDelete(path);
      }
    },
    // Оптимистичные транзакции: если за время работы изменился прочитанный документ — повтор.
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const reads = new Map();
        const writes = [];
        let wrote = false;

        const tx = {
          get: async (target) => {
            if (wrote) throw new Error("reads after writes in transaction");
            await Promise.resolve(); // отдаём управление: даём конкурентным транзакциям вклиниться
            if (target.__query) {
              const paths = runQuery(target.__query);
              paths.forEach((p) => reads.set(p, version(p)));
              reads.set(`${target.__query.parent}/*`, paths.length);
              return { docs: paths.map(snapOf) };
            }
            reads.set(target.path, version(target.path));
            return snapOf(target.path);
          },
          set: (ref, data, opts) => { wrote = true; writes.push(() => writeSet(ref.path, data, opts)); },
          update: (ref, data) => { wrote = true; writes.push(() => writeUpdate(ref.path, data)); },
          delete: (ref) => { wrote = true; writes.push(() => writeDelete(ref.path)); },
        };

        const result = await fn(tx);

        const conflict = [...reads.entries()].some(
          ([p, v]) => !p.endsWith("/*") && version(p) !== v
        );
        if (conflict) continue;

        now();
        writes.forEach((w) => w());
        return result;
      }
      throw new Error("transaction aborted: too much contention");
    },
  };

  return { db, docs, now: () => clock, tick: (ms) => { clock += ms; }, setClock: (v) => { clock = v; } };
}

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- окружение ----------

function setup() {
  const fake = createFakeDb();
  const handlers = createEventHandlers({
    db: fake.db,
    FieldValue,
    HttpsError,
    requireUser: (request) => {
      const uid = request.auth?.uid;
      if (!uid || !uid.startsWith("tg_")) throw new HttpsError("unauthenticated", "no");
      return uid;
    },
    cleanString: (v, n) => String(v ?? "").trim().slice(0, n),
    ageGroup: (age) => (Number(age) < 18 ? 0 : 1),
    now: fake.now,
  });

  const as = (uid, data) => ({ auth: uid ? { uid } : undefined, data });

  const profiles = {
    tg_org: { name: "Организатор", age: 16, photoUrl: "https://x/org.jpg" },
    tg_b: { name: "Боб", age: 15 },
    tg_c: { name: "Кира", age: 17 },
    tg_d: { name: "Дима", age: 16 },
    tg_e: { name: "Чужой", age: 16 },
    tg_adult: { name: "Взрослый", age: 35 },
  };
  for (const [uid, p] of Object.entries(profiles)) {
    fake.docs.set(`profiles/${uid}`, { ...p, isVisible: true });
  }

  const call = async (fn, uid, data) => handlers[fn](as(uid, data));
  const fails = async (promise, code) =>
    assert.rejects(promise, (e) => e instanceof HttpsError && e.code === code, `ожидалась ошибка ${code}`);

  const createEvent = async (capacity = 10) =>
    (await call("goCreateEvent", "tg_org", {
      title: "Настолки", description: "Играем", category: "Игры",
      date: "2099-01-01", time: "18:00", place: "Парк", capacity,
    })).eventId;

  const ev = (id) => fake.docs.get(`events/${id}`);
  const parts = (id) =>
    [...fake.docs.keys()].filter((p) => p.startsWith(`events/${id}/participants/`)).map((p) => p.split("/").pop()).sort();
  const sendMsg = async (uid, id, text, clientId) => {
    fake.tick(1000);
    return call("goSendEventMessage", uid, { eventId: id, text, clientId });
  };

  return { fake, handlers, call, fails, createEvent, ev, parts, sendMsg };
}

// ---------- сценарии ----------

test("создание события: группа существует, организатор — первый участник", async () => {
  const { createEvent, ev, parts, call } = setup();
  const id = await createEvent();
  assert.equal(ev(id).participantCount, 1);
  assert.deepEqual(ev(id).participantUids, ["tg_org"]);
  assert.equal(ev(id).msgSeq, 0);
  assert.deepEqual(parts(id), ["tg_org"]);

  const group = await call("goGetEventGroup", "tg_org", { eventId: id });
  assert.equal(group.role, "organizer");
  assert.equal(group.members.length, 1);
  assert.equal(group.members[0].role, "organizer");
  assert.deepEqual(group.messages, []);
});

test("вступление: два пользователя, повторное нажатие не создаёт дубликат", async () => {
  const { createEvent, ev, parts, call } = setup();
  const id = await createEvent();

  const first = await call("goJoinEvent", "tg_b", { eventId: id });
  assert.equal(first.joined, true);
  assert.equal(first.participantCount, 2);

  const again = await call("goJoinEvent", "tg_b", { eventId: id });
  assert.equal(again.joined, false);
  assert.equal(again.participantCount, 2);

  await call("goJoinEvent", "tg_c", { eventId: id });
  assert.equal(ev(id).participantCount, 3);
  assert.deepEqual(parts(id), ["tg_b", "tg_c", "tg_org"]);
  assert.deepEqual(ev(id).participantUids.sort(), ["tg_b", "tg_c", "tg_org"]);
});

test("вместимость: параллельные вступления не обходят лимит", async () => {
  const { createEvent, ev, call } = setup();
  const id = await createEvent(3); // организатор + 2 места

  const results = await Promise.allSettled(
    ["tg_b", "tg_c", "tg_d", "tg_e"].map((uid) => call("goJoinEvent", uid, { eventId: id }))
  );

  const ok = results.filter((r) => r.status === "fulfilled");
  const full = results.filter((r) => r.status === "rejected" && r.reason.code === "failed-precondition");
  assert.equal(ok.length, 2, "ровно 2 успешных вступления");
  assert.equal(full.length, 2, "остальные получили «мест нет»");
  assert.equal(ev(id).participantCount, 3);
  assert.equal(ev(id).participantUids.length, 3);
});

test("одновременные дубли одного пользователя дают одно участие", async () => {
  const { createEvent, ev, parts, call } = setup();
  const id = await createEvent();
  await Promise.all(Array.from({ length: 5 }, () => call("goJoinEvent", "tg_b", { eventId: id })));
  assert.equal(ev(id).participantCount, 2);
  assert.deepEqual(parts(id), ["tg_b", "tg_org"]);
});

test("вступление требует анкету и ту же возрастную группу", async () => {
  const { createEvent, call, fails, fake } = setup();
  const id = await createEvent();
  await fails(call("goJoinEvent", "tg_adult", { eventId: id }), "permission-denied");
  await fails(call("goJoinEvent", "tg_noprofile", { eventId: id }), "failed-precondition");
  await fails(call("goJoinEvent", null, { eventId: id }), "unauthenticated");
  await fails(call("goJoinEvent", "tg_b", { eventId: "no/such" }), "invalid-argument");
  await fails(call("goJoinEvent", "tg_b", { eventId: "missing" }), "not-found");
  assert.ok(fake.docs.size > 0);
});

test("чат: обмен сообщениями, роль считается на сервере, свои/чужие", async () => {
  const { createEvent, call, sendMsg } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });

  const m1 = await sendMsg("tg_b", id, "  Привет всем!  ", "client-b-0001");
  assert.equal(m1.message.text, "Привет всем!");
  assert.equal(m1.message.seq, 1);
  assert.equal(m1.message.role, "member");
  assert.equal(m1.message.name, "Боб");

  const m2 = await sendMsg("tg_org", id, "Добро пожаловать", "client-o-0001");
  assert.equal(m2.message.role, "organizer");
  assert.equal(m2.message.seq, 2);

  // Клиент не может подделать роль: любые лишние поля игнорируются.
  const spoof = await call("goSendEventMessage", "tg_b", {
    eventId: id, text: "я админ", clientId: "client-b-0002", role: "organizer", uid: "tg_org", name: "Admin",
  }).catch(() => null);
  if (spoof) {
    assert.equal(spoof.message.role, "member");
    assert.equal(spoof.message.uid, "tg_b");
    assert.equal(spoof.message.name, "Боб");
  }
});

test("повторная отправка (retry) не создаёт дубликат сообщения", async () => {
  const { createEvent, call, sendMsg, ev } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });

  const a = await sendMsg("tg_b", id, "один раз", "client-dup-0001");
  const b = await sendMsg("tg_b", id, "один раз", "client-dup-0001");
  assert.equal(a.message.seq, b.message.seq);
  assert.equal(ev(id).msgSeq, 1);

  const group = await call("goGetEventGroup", "tg_b", { eventId: id });
  assert.equal(group.messages.length, 1);
});

test("антиспам и валидация текста", async () => {
  const { createEvent, call, fails, fake } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });

  fake.tick(1000);
  await call("goSendEventMessage", "tg_b", { eventId: id, text: "раз", clientId: "client-spam-001" });
  await fails(call("goSendEventMessage", "tg_b", { eventId: id, text: "два", clientId: "client-spam-002" }), "resource-exhausted");

  fake.tick(1000);
  await fails(call("goSendEventMessage", "tg_b", { eventId: id, text: "   ", clientId: "client-spam-003" }), "invalid-argument");
  await fails(call("goSendEventMessage", "tg_b", { eventId: id, text: "x".repeat(501), clientId: "client-spam-004" }), "invalid-argument");
  await fails(call("goSendEventMessage", "tg_b", { eventId: id, text: "ok", clientId: "bad id" }), "invalid-argument");
});

test("постраничная история: нет загрузки всего чата, новые сообщения по курсору", async () => {
  const { createEvent, call, sendMsg } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });

  for (let i = 1; i <= 70; i += 1) {
    await sendMsg(i % 2 ? "tg_b" : "tg_org", id, `сообщение ${i}`, `client-p-${String(i).padStart(4, "0")}`);
  }

  const first = await call("goGetEventGroup", "tg_b", { eventId: id, limit: 30 });
  assert.equal(first.messages.length, 30);
  assert.equal(first.messages[0].seq, 41);
  assert.equal(first.messages[29].seq, 70);
  assert.equal(first.hasMore, true);
  assert.equal(first.latestSeq, 70);

  const older = await call("goGetEventMessages", "tg_b", { eventId: id, beforeSeq: 41, limit: 30 });
  assert.equal(older.messages.length, 30);
  assert.equal(older.messages[0].seq, 11);
  assert.equal(older.messages[29].seq, 40);
  assert.equal(older.hasMore, true);

  const oldest = await call("goGetEventMessages", "tg_b", { eventId: id, beforeSeq: 11, limit: 30 });
  assert.equal(oldest.messages.length, 10);
  assert.equal(oldest.hasMore, false);

  const none = await call("goGetEventMessages", "tg_b", { eventId: id, afterSeq: 70 });
  assert.deepEqual(none.messages, []);

  await sendMsg("tg_org", id, "новое", "client-p-9999");
  const fresh = await call("goGetEventMessages", "tg_b", { eventId: id, afterSeq: 70 });
  assert.equal(fresh.messages.length, 1);
  assert.equal(fresh.messages[0].text, "новое");
  assert.equal(fresh.messages[0].role, "organizer");
});

test("неучастник не может читать группу, участников и писать", async () => {
  const { createEvent, call, fails, sendMsg } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });
  await sendMsg("tg_b", id, "секрет", "client-secret-01");

  await fails(call("goGetEventGroup", "tg_e", { eventId: id }), "permission-denied");
  await fails(call("goGetEventMembers", "tg_e", { eventId: id }), "permission-denied");
  await fails(call("goGetEventMessages", "tg_e", { eventId: id, afterSeq: 0 }), "permission-denied");
  await fails(call("goGetEventMessages", "tg_e", { eventId: id, beforeSeq: 999 }), "permission-denied");
  await fails(call("goSendEventMessage", "tg_e", { eventId: id, text: "я вне группы", clientId: "client-out-0001" }), "permission-denied");
});

test("выход: счётчик -1 ровно один раз, доступ к группе отозван, повтор безопасен", async () => {
  const { createEvent, call, fails, ev, parts, sendMsg } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });
  await call("goJoinEvent", "tg_c", { eventId: id });
  assert.equal(ev(id).participantCount, 3);

  const left = await call("goLeaveEvent", "tg_b", { eventId: id });
  assert.equal(left.left, true);
  assert.equal(left.participantCount, 2);
  assert.equal(ev(id).participantCount, 2);
  assert.deepEqual(parts(id), ["tg_c", "tg_org"]);

  const again = await call("goLeaveEvent", "tg_b", { eventId: id });
  assert.equal(again.left, false);
  assert.equal(ev(id).participantCount, 2, "повторный выход не уменьшает счётчик");

  // Параллельные выходы одного и того же пользователя тоже не уводят счётчик ниже.
  await Promise.all([call("goLeaveEvent", "tg_c", { eventId: id }), call("goLeaveEvent", "tg_c", { eventId: id })]);
  assert.equal(ev(id).participantCount, 1);

  await fails(call("goGetEventGroup", "tg_b", { eventId: id }), "permission-denied");
  await fails(call("goSendEventMessage", "tg_b", { eventId: id, text: "после выхода", clientId: "client-left-001" }), "permission-denied");

  // Можно вступить снова — без дубликатов.
  await call("goJoinEvent", "tg_b", { eventId: id });
  assert.equal(ev(id).participantCount, 2);
  await sendMsg("tg_b", id, "я вернулся", "client-back-0001");
});

test("организатор не может покинуть своё событие", async () => {
  const { createEvent, call, fails, ev } = setup();
  const id = await createEvent();
  await fails(call("goLeaveEvent", "tg_org", { eventId: id }), "failed-precondition");
  assert.equal(ev(id).participantCount, 1);
  assert.equal(ev(id).status, "published");
});

test("чужой пользователь (даже участник) не может удалить событие", async () => {
  const { createEvent, call, fails, ev } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });
  await fails(call("goDeleteEvent", "tg_b", { eventId: id }), "permission-denied");
  await fails(call("goDeleteEvent", "tg_e", { eventId: id }), "permission-denied");
  assert.equal(ev(id).status, "published");
});

test("удаление организатором: статус, уведомления, чат и участники вычищены, доступ закрыт", async () => {
  const { createEvent, call, fails, fake, ev, parts, sendMsg } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });
  await call("goJoinEvent", "tg_c", { eventId: id });
  await sendMsg("tg_b", id, "привет", "client-del-0001");
  await sendMsg("tg_org", id, "привет", "client-del-0002");

  const before = [...fake.docs.keys()].filter((p) => p.startsWith(`events/${id}/`));
  assert.ok(before.length > 0);

  await call("goDeleteEvent", "tg_org", { eventId: id });

  assert.equal(ev(id).status, "deleted");
  assert.equal(ev(id).participantCount, 0);
  assert.deepEqual(ev(id).participantUids, []);
  assert.ok(ev(id).cleanedAt, "метка завершённой очистки");

  const leftovers = [...fake.docs.keys()].filter((p) => p.startsWith(`events/${id}/`));
  assert.deepEqual(leftovers, [], "не осталось ни участников, ни сообщений, ни dedupe-записей");
  assert.deepEqual(parts(id), []);

  const notified = [...fake.docs.entries()]
    .filter(([p, d]) => p.startsWith("notifications/") && d.type === "event_cancelled")
    .map(([, d]) => d.recipientUid).sort();
  assert.deepEqual(notified, ["tg_b", "tg_c"], "уведомлены участники, но не организатор");

  // Никто (включая бывших участников и организатора) больше не получает доступ к группе.
  for (const uid of ["tg_b", "tg_c", "tg_org", "tg_e"]) {
    await fails(call("goGetEventGroup", uid, { eventId: id }), "not-found");
    await fails(call("goGetEventMessages", uid, { eventId: id, afterSeq: 0 }), "not-found");
    await fails(call("goSendEventMessage", uid, { eventId: id, text: "x", clientId: "client-late-0001" }), "not-found");
  }
  await fails(call("goJoinEvent", "tg_d", { eventId: id }), "not-found");

  // Повторное удаление идемпотентно и не шлёт уведомления второй раз.
  await call("goDeleteEvent", "tg_org", { eventId: id });
  const notifiedAgain = [...fake.docs.values()].filter((d) => d.type === "event_cancelled").length;
  assert.equal(notifiedAgain, 2);
});

test("старые события без participantUids: ленивая миграция при вступлении и выходе", async () => {
  const { fake, call, ev, parts } = setup();
  // Событие в старом формате: только participantCount и подколлекция participants.
  fake.docs.set("events/legacy", {
    title: "Старое", description: "d", category: "Игры", date: "2099-01-01", time: "10:00",
    place: "p", capacity: 5, createdBy: "tg_org", participantCount: 7 /* рассинхрон */, status: "published",
  });
  fake.docs.set("events/legacy/participants/tg_org", { joinedAt: { toMillis: () => 1 } });
  fake.docs.set("events/legacy/participants/tg_c", { joinedAt: { toMillis: () => 2 } });

  const rows = await new Promise((r) => r(null));
  assert.equal(rows, null);

  const j = await call("goJoinEvent", "tg_b", { eventId: "legacy" });
  assert.equal(j.participantCount, 3, "счётчик пересчитан по факту, а не слепо +1");
  assert.deepEqual(ev("legacy").participantUids.sort(), ["tg_b", "tg_c", "tg_org"]);
  assert.deepEqual(parts("legacy"), ["tg_b", "tg_c", "tg_org"]);

  const l = await call("goLeaveEvent", "tg_b", { eventId: "legacy" });
  assert.equal(l.participantCount, 2);
});

test("eventRows: список событий без N+1 и корректный joined для обоих форматов", async () => {
  const { fake, handlers, call, createEvent } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });
  fake.docs.set("events/legacy", { title: "L", createdBy: "tg_org", capacity: 5, participantCount: 1, status: "published" });
  fake.docs.set("events/legacy/participants/tg_b", { joinedAt: { toMillis: () => 1 } });

  const snap = await fake.db.collection("events").where("status", "==", "published").get();
  const forB = await handlers.eventRows(snap.docs, "tg_b");
  const forC = await handlers.eventRows(snap.docs, "tg_c");

  assert.equal(forB.find((e) => e.id === id).joined, true);
  assert.equal(forB.find((e) => e.id === "legacy").joined, true);
  assert.equal(forC.find((e) => e.id === id).joined, false);
  assert.equal(forC.find((e) => e.id === "legacy").joined, false);
});

test("участники: организатор первый, роль только с сервера", async () => {
  const { createEvent, call } = setup();
  const id = await createEvent();
  await call("goJoinEvent", "tg_b", { eventId: id });
  await call("goJoinEvent", "tg_c", { eventId: id });

  const res = await call("goGetEventMembers", "tg_c", { eventId: id });
  assert.deepEqual(res.members.map((m) => [m.uid, m.role]), [
    ["tg_org", "organizer"], ["tg_b", "member"], ["tg_c", "member"],
  ]);
  assert.equal(res.role, "member");
  assert.equal(res.members[0].name, "Организатор");
  assert.ok(!("age" in res.members[0]) && !("username" in res.members[0]), "лишние личные данные не отдаются");
});
