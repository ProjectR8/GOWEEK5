"use strict";

/**
 * Серверная логика событий и их групп (чат + участники).
 *
 * Схема Firestore (совместима со старой):
 *   events/{eventId}                    — как раньше: status, createdBy, capacity, participantCount ...
 *       + participantUids: string[]     — NEW, денормализация для быстрой проверки "joined" без N+1 чтений
 *       + msgSeq: number                — NEW, счётчик сообщений группы
 *       + lastMessageAt                 — NEW
 *   events/{eventId}/participants/{uid} — как раньше {joinedAt}; + lastMsgAt (антиспам)
 *   events/{eventId}/messages/{seq}     — NEW, docId = seq с нулями слева
 *   events/{eventId}/msgDedupe/{uid_clientId} — NEW, защита от дубля при повторной отправке
 *
 * Роль организатора НИГДЕ не хранится в сообщениях и не приходит от клиента:
 * она вычисляется на сервере как (event.createdBy === uid).
 *
 * Старые события без participantUids мигрируют лениво при первом join/leave.
 * Доступ к группе проверяется на сервере при КАЖДОМ запросе.
 */

const MSG_MAX_LENGTH = 500;
const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;
const MIN_MSG_INTERVAL_MS = 600;
const MEMBERS_MAX = 200;

const padSeq = (n) => String(n).padStart(10, "0");

function createEventHandlers({
  db,
  FieldValue,
  HttpsError,
  requireUser,
  cleanString,
  ageGroup,
  now = Date.now,
}) {
  const eventsCol = () => db.collection("events");

  function eventIdOf(request) {
    const id = cleanString(request.data?.eventId, 150);

    if (!id || id.includes("/")) {
      throw new HttpsError("invalid-argument", "Не указано событие");
    }

    return id;
  }

  const toMillis = (value) =>
    value && typeof value.toMillis === "function" ? value.toMillis() : null;

  // Участники из денормализованного поля; у старых событий — из подколлекции.
  async function readParticipantUids(tx, eventRef, data) {
    if (Array.isArray(data.participantUids)) {
      return data.participantUids.slice();
    }

    const snap = await tx.get(eventRef.collection("participants"));

    return snap.docs.map((doc) => doc.id);
  }

  // Строки событий для списков: без запроса на каждый документ участника.
  async function eventRows(docs, uid) {
    const legacy = docs.filter(
      (doc) => !Array.isArray(doc.data().participantUids)
    );

    const legacyJoined = new Set();

    if (legacy.length) {
      const snaps = await db.getAll(
        ...legacy.map((doc) => doc.ref.collection("participants").doc(uid))
      );

      snaps.forEach((snap, index) => {
        if (snap.exists) legacyJoined.add(legacy[index].id);
      });
    }

    return docs.map((doc) => {
      const event = doc.data();

      const joined = Array.isArray(event.participantUids)
        ? event.participantUids.includes(uid)
        : legacyJoined.has(doc.id);

      return {
        id: doc.id,
        title: event.title || "Без названия",
        description: event.description || "",
        category: event.category || "Встреча",
        date: event.date || "",
        time: event.time || "",
        place: event.place || "",
        city: event.city || "",
        createdBy: event.createdBy || "",
        participantCount: Number(event.participantCount || 0),
        capacity: Number(event.capacity || 30),
        joined,
        status: event.status || "published",
      };
    });
  }

  function publicEvent(id, event) {
    return {
      id,
      title: event.title || "Без названия",
      description: event.description || "",
      category: event.category || "Встреча",
      date: event.date || "",
      time: event.time || "",
      place: event.place || "",
      city: event.city || "",
      createdBy: event.createdBy || "",
      participantCount: Number(event.participantCount || 0),
      capacity: Number(event.capacity || 30),
      status: event.status || "published",
    };
  }

  // Доступ к группе: только опубликованное событие + организатор или действующий участник.
  async function loadAccess(uid, eventId) {
    const eventRef = eventsCol().doc(eventId);

    const [eventSnap, participantSnap] = await Promise.all([
      eventRef.get(),
      eventRef.collection("participants").doc(uid).get(),
    ]);

    if (!eventSnap.exists || eventSnap.data().status !== "published") {
      throw new HttpsError("not-found", "Событие недоступно");
    }

    const event = eventSnap.data();
    const isOrganizer = event.createdBy === uid;

    if (!isOrganizer && !participantSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "Группа доступна только участникам события"
      );
    }

    return { eventRef, event, isOrganizer };
  }

  async function listMembers(eventRef, event) {
    const snap = await eventRef
      .collection("participants")
      .limit(MEMBERS_MAX)
      .get();

    const joinedAtByUid = new Map(
      snap.docs.map((doc) => [doc.id, toMillis(doc.data().joinedAt)])
    );

    const uids = [...joinedAtByUid.keys()];

    if (event.createdBy && !joinedAtByUid.has(event.createdBy)) {
      uids.push(event.createdBy);
    }

    const profiles = uids.length
      ? await db.getAll(
          ...uids.map((memberUid) => db.collection("profiles").doc(memberUid))
        )
      : [];

    const rows = uids.map((memberUid, index) => {
      const profile = profiles[index];
      const data = profile && profile.exists ? profile.data() : {};

      return {
        uid: memberUid,
        name: data.name || "Участник GO",
        photoUrl: data.photoUrl || "",
        role: memberUid === event.createdBy ? "organizer" : "member",
        joinedAt: joinedAtByUid.get(memberUid) ?? null,
      };
    });

    // Организатор всегда первый, остальные — по времени вступления.
    rows.sort((a, b) => {
      if (a.role !== b.role) return a.role === "organizer" ? -1 : 1;

      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });

    return rows;
  }

  const publicMessage = (data, event) => ({
    id: padSeq(data.seq),
    seq: data.seq,
    uid: data.uid,
    name: data.senderName || "Участник GO",
    photoUrl: data.senderPhoto || "",
    text: data.text || "",
    createdAt: toMillis(data.createdAt),
    clientId: data.clientId || "",
    // Роль считается на сервере по createdBy события, а не хранится в сообщении.
    role: data.uid === event.createdBy ? "organizer" : "member",
  });

  function pageSize(value) {
    const n = Math.round(Number(value));

    if (!Number.isFinite(n)) return PAGE_DEFAULT;

    return Math.max(1, Math.min(PAGE_MAX, n));
  }

  function cleanMessageText(value) {
    const text = String(value ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) {
      throw new HttpsError("invalid-argument", "Сообщение пустое");
    }

    if (text.length > MSG_MAX_LENGTH) {
      throw new HttpsError(
        "invalid-argument",
        `Сообщение длиннее ${MSG_MAX_LENGTH} символов`
      );
    }

    return text;
  }

  // ---------- создание ----------
  async function goCreateEvent(request) {
    const uid = requireUser(request);
    const data = request.data || {};

    const title = cleanString(data.title, 70);
    const description = cleanString(data.description, 500);
    const category = cleanString(data.category || "Встреча", 30);
    const date = cleanString(data.date, 20);
    const time = cleanString(data.time, 10);
    const place = cleanString(data.place, 100);

    const capacity = Math.max(
      2,
      Math.min(200, Math.round(Number(data.capacity)) || 30)
    );

    if (!title || !description || !date || !time || !place) {
      throw new HttpsError("invalid-argument", "Заполни все поля события");
    }

    const creator = await db.collection("profiles").doc(uid).get();

    const city = creator.exists
      ? cleanString(creator.data().city, 60)
      : "";

    const eventRef = eventsCol().doc();
    const batch = db.batch();

    // Группа события существует сразу: это подколлекции самого события.
    batch.set(eventRef, {
      title,
      description,
      category,
      date,
      time,
      place,
      city,
      capacity,
      createdBy: uid,
      participantCount: 1,
      participantUids: [uid],
      msgSeq: 0,
      status: "published",
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(eventRef.collection("participants").doc(uid), {
      joinedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return { success: true, eventId: eventRef.id };
  }

  // ---------- вступление ----------
  async function goJoinEvent(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);

    const eventRef = eventsCol().doc(eventId);
    const participantRef = eventRef.collection("participants").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const [eventSnap, participantSnap, meSnap] = await Promise.all([
        tx.get(eventRef),
        tx.get(participantRef),
        tx.get(db.collection("profiles").doc(uid)),
      ]);

      if (!eventSnap.exists || eventSnap.data().status !== "published") {
        throw new HttpsError("not-found", "Событие не найдено");
      }

      const event = eventSnap.data();
      const uids = await readParticipantUids(tx, eventRef, event);
      const alreadyMember = uids.includes(uid) || participantSnap.exists;

      if (alreadyMember) {
        // Повторное нажатие: дубликат не создаётся, при необходимости чиним денормализацию.
        const merged = uids.includes(uid) ? uids : [...uids, uid];

        if (
          !Array.isArray(event.participantUids) ||
          event.participantCount !== merged.length
        ) {
          tx.update(eventRef, {
            participantUids: merged,
            participantCount: merged.length,
          });
        }

        if (!participantSnap.exists) {
          tx.set(participantRef, { joinedAt: FieldValue.serverTimestamp() });
        }

        return { joined: false, count: merged.length };
      }

      if (!meSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Сначала заполни свою анкету"
        );
      }

      // Подростки и взрослые не пересекаются — как в свайпах и публикациях.
      const organizerSnap = await tx.get(
        db.collection("profiles").doc(event.createdBy || "_")
      );

      if (
        organizerSnap.exists &&
        ageGroup(organizerSnap.data().age) !== ageGroup(meSnap.data().age)
      ) {
        throw new HttpsError(
          "permission-denied",
          "Это событие для другой возрастной группы"
        );
      }

      const capacity = Number(event.capacity || 30);

      if (uids.length >= capacity) {
        throw new HttpsError(
          "failed-precondition",
          "Свободных мест больше нет"
        );
      }

      const next = [...uids, uid];

      tx.set(participantRef, { joinedAt: FieldValue.serverTimestamp() });

      tx.update(eventRef, {
        participantUids: next,
        participantCount: next.length,
      });

      return { joined: true, count: next.length };
    });

    return {
      success: true,
      joined: result.joined,
      participantCount: result.count,
    };
  }

  // ---------- выход ----------
  async function goLeaveEvent(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);

    const eventRef = eventsCol().doc(eventId);
    const participantRef = eventRef.collection("participants").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const [eventSnap, participantSnap] = await Promise.all([
        tx.get(eventRef),
        tx.get(participantRef),
      ]);

      if (!eventSnap.exists) return { left: false, count: 0 };

      const event = eventSnap.data();

      if (event.createdBy === uid) {
        throw new HttpsError(
          "failed-precondition",
          "Организатор не может покинуть событие. Его можно только удалить."
        );
      }

      if (event.status !== "published") return { left: false, count: 0 };

      const uids = await readParticipantUids(tx, eventRef, event);
      const isMember = uids.includes(uid) || participantSnap.exists;

      if (!isMember) return { left: false, count: uids.length };

      const next = uids.filter((memberUid) => memberUid !== uid);

      tx.delete(participantRef);

      tx.update(eventRef, {
        participantUids: next,
        participantCount: next.length,
      });

      return { left: true, count: next.length };
    });

    return {
      success: true,
      left: result.left,
      participantCount: result.count,
    };
  }

  // ---------- удаление организатором ----------
  async function goDeleteEvent(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);
    const eventRef = eventsCol().doc(eventId);

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(eventRef);

      if (!snap.exists) {
        throw new HttpsError("not-found", "Событие не найдено");
      }

      const event = snap.data();

      if (event.createdBy !== uid) {
        throw new HttpsError(
          "permission-denied",
          "Удалить может только организатор"
        );
      }

      if (event.status === "deleted") {
        // Повторный вызов: только дочищаем хвосты, не уведомляем второй раз.
        return { transitioned: false, uids: [], title: event.title || "" };
      }

      const uids = await readParticipantUids(tx, eventRef, event);

      // С этого момента группа закрыта для всех: loadAccess требует status === published.
      tx.update(eventRef, {
        status: "deleted",
        deletedAt: FieldValue.serverTimestamp(),
        participantCount: 0,
        participantUids: [],
      });

      return { transitioned: true, uids, title: event.title || "" };
    });

    if (outcome.transitioned) {
      const recipients = outcome.uids.filter((memberUid) => memberUid !== uid);

      for (let i = 0; i < recipients.length; i += 400) {
        const batch = db.batch();

        recipients.slice(i, i + 400).forEach((recipientUid) => {
          batch.set(db.collection("notifications").doc(), {
            recipientUid,
            type: "event_cancelled",
            title: "Событие отменено",
            text: `Организатор отменил «${outcome.title}»`,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        });

        await batch.commit();
      }
    }

    // Участники и чат удаляются полностью; сам документ события остаётся как архивная запись.
    await db.recursiveDelete(eventRef.collection("messages"));
    await db.recursiveDelete(eventRef.collection("msgDedupe"));
    await db.recursiveDelete(eventRef.collection("participants"));

    await eventRef.update({ cleanedAt: FieldValue.serverTimestamp() });

    return { success: true };
  }

  // ---------- группа ----------
  async function goGetEventMembers(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);
    const { eventRef, event, isOrganizer } = await loadAccess(uid, eventId);

    return {
      event: publicEvent(eventId, event),
      role: isOrganizer ? "organizer" : "member",
      members: await listMembers(eventRef, event),
    };
  }

  async function goGetEventGroup(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);
    const limit = pageSize(request.data?.limit);
    const { eventRef, event, isOrganizer } = await loadAccess(uid, eventId);

    const [members, messagesSnap] = await Promise.all([
      listMembers(eventRef, event),
      eventRef
        .collection("messages")
        .orderBy("seq", "desc")
        .limit(limit)
        .get(),
    ]);

    const messages = messagesSnap.docs
      .map((doc) => publicMessage(doc.data(), event))
      .reverse();

    return {
      event: publicEvent(eventId, event),
      role: isOrganizer ? "organizer" : "member",
      members,
      messages,
      hasMore: messagesSnap.docs.length === limit,
      latestSeq: Number(event.msgSeq || 0),
    };
  }

  async function goGetEventMessages(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);
    const limit = pageSize(request.data?.limit);
    const afterSeq = Number(request.data?.afterSeq);
    const beforeSeq = Number(request.data?.beforeSeq);
    const { eventRef, event } = await loadAccess(uid, eventId);

    const latestSeq = Number(event.msgSeq || 0);
    const base = { latestSeq, participantCount: Number(event.participantCount || 0) };

    // Новые сообщения. Если новых нет — запрос к сообщениям вообще не делаем.
    if (Number.isFinite(afterSeq)) {
      if (afterSeq >= latestSeq) {
        return { ...base, messages: [], hasMore: false };
      }

      const snap = await eventRef
        .collection("messages")
        .where("seq", ">", afterSeq)
        .orderBy("seq", "asc")
        .limit(PAGE_MAX)
        .get();

      return {
        ...base,
        messages: snap.docs.map((doc) => publicMessage(doc.data(), event)),
        hasMore: snap.docs.length === PAGE_MAX,
      };
    }

    // Более старые сообщения (постраничная подгрузка истории).
    if (Number.isFinite(beforeSeq)) {
      const snap = await eventRef
        .collection("messages")
        .where("seq", "<", beforeSeq)
        .orderBy("seq", "desc")
        .limit(limit)
        .get();

      return {
        ...base,
        messages: snap.docs
          .map((doc) => publicMessage(doc.data(), event))
          .reverse(),
        hasMore: snap.docs.length === limit,
      };
    }

    throw new HttpsError("invalid-argument", "Не указан курсор сообщений");
  }

  async function goSendEventMessage(request) {
    const uid = requireUser(request);
    const eventId = eventIdOf(request);
    const text = cleanMessageText(request.data?.text);
    const clientId = cleanString(request.data?.clientId, 40);

    if (!/^[A-Za-z0-9_-]{8,40}$/.test(clientId)) {
      throw new HttpsError("invalid-argument", "Некорректный идентификатор сообщения");
    }

    const eventRef = eventsCol().doc(eventId);
    const participantRef = eventRef.collection("participants").doc(uid);
    const dedupeRef = eventRef.collection("msgDedupe").doc(`${uid}_${clientId}`);
    const profileRef = db.collection("profiles").doc(uid);

    const message = await db.runTransaction(async (tx) => {
      const [eventSnap, participantSnap, dedupeSnap, profileSnap] =
        await Promise.all([
          tx.get(eventRef),
          tx.get(participantRef),
          tx.get(dedupeRef),
          tx.get(profileRef),
        ]);

      if (!eventSnap.exists || eventSnap.data().status !== "published") {
        throw new HttpsError("not-found", "Событие недоступно");
      }

      const event = eventSnap.data();

      if (event.createdBy !== uid && !participantSnap.exists) {
        throw new HttpsError(
          "permission-denied",
          "Писать в группу могут только участники события"
        );
      }

      // Повторная отправка того же сообщения (retry) возвращает уже сохранённое.
      if (dedupeSnap.exists) {
        return publicMessage(dedupeSnap.data(), event);
      }

      const lastMsgAt = participantSnap.exists
        ? toMillis(participantSnap.data().lastMsgAt)
        : null;

      if (lastMsgAt && now() - lastMsgAt < MIN_MSG_INTERVAL_MS) {
        throw new HttpsError(
          "resource-exhausted",
          "Слишком часто. Подожди секунду."
        );
      }

      const profile = profileSnap.exists ? profileSnap.data() : {};
      const seq = Number(event.msgSeq || 0) + 1;

      const stored = {
        seq,
        uid,
        text,
        clientId,
        senderName: cleanString(profile.name, 40) || "Участник GO",
        senderPhoto: cleanString(profile.photoUrl, 1500),
        createdAt: FieldValue.serverTimestamp(),
      };

      tx.set(eventRef.collection("messages").doc(padSeq(seq)), stored);
      tx.set(dedupeRef, stored);

      tx.update(eventRef, {
        msgSeq: seq,
        lastMessageAt: FieldValue.serverTimestamp(),
      });

      tx.set(
        participantRef,
        { lastMsgAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      return {
        ...publicMessage({ ...stored, createdAt: null }, event),
        createdAt: now(),
      };
    });

    return { success: true, message };
  }

  return {
    eventRows,
    goCreateEvent,
    goJoinEvent,
    goLeaveEvent,
    goDeleteEvent,
    goGetEventGroup,
    goGetEventMembers,
    goGetEventMessages,
    goSendEventMessage,
  };
}

module.exports = {
  createEventHandlers,
  MSG_MAX_LENGTH,
  PAGE_MAX,
};
