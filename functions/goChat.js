"use strict";

/**
 * Общий чат GO.
 *
 * Два отдельных чата: для подростков (ageGroup 0) и для взрослых (ageGroup 1).
 * Группа определяется на сервере по возрасту из анкеты — клиент её не передаёт,
 * поэтому подростки и взрослые не пересекаются (как в свайпах и событиях).
 *
 * Схема Firestore:
 *   globalChat/g0, globalChat/g1               — { msgSeq, lastMessageAt }
 *   globalChat/{gid}/messages/{seq}            — docId = seq с нулями слева
 *   globalChat/{gid}/senders/{uid}             — { lastMsgAt } антиспам
 *   globalChat/{gid}/msgDedupe/{uid_clientId}  — { seq } защита от дубля при повторе
 *
 * Писать и читать могут только пользователи с анкетой.
 */

const MSG_MAX_LENGTH = 500;
const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;
const MIN_MSG_INTERVAL_MS = 1200;

const padSeq = (n) => String(n).padStart(10, "0");

function createChatHandlers({
  db,
  FieldValue,
  HttpsError,
  requireUser,
  cleanString,
  ageGroup,
  now = Date.now,
}) {
  const toMillis = (value) =>
    value && typeof value.toMillis === "function" ? value.toMillis() : null;

  async function loadChat(uid) {
    const profileSnap = await db.collection("profiles").doc(uid).get();

    if (!profileSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Сначала заполни свою анкету"
      );
    }

    const profile = profileSnap.data();
    const chatRef = db.collection("globalChat").doc(`g${ageGroup(profile.age)}`);

    return { chatRef, profile };
  }

  const publicMessage = (data) => ({
    id: padSeq(data.seq),
    seq: data.seq,
    uid: data.uid,
    name: data.senderName || "Участник GO",
    photoUrl: data.senderPhoto || "",
    text: data.text || "",
    createdAt: toMillis(data.createdAt),
    clientId: data.clientId || "",
    role: "member",
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

  // Первая загрузка: последняя страница истории.
  async function goGetGlobalChat(request) {
    const uid = requireUser(request);
    const limit = pageSize(request.data?.limit);
    const { chatRef } = await loadChat(uid);

    const [chatSnap, messagesSnap] = await Promise.all([
      chatRef.get(),
      chatRef.collection("messages").orderBy("seq", "desc").limit(limit).get(),
    ]);

    return {
      messages: messagesSnap.docs
        .map((doc) => publicMessage(doc.data()))
        .reverse(),
      hasMore: messagesSnap.docs.length === limit,
      latestSeq: chatSnap.exists ? Number(chatSnap.data().msgSeq || 0) : 0,
    };
  }

  // Опрос новых сообщений и подгрузка истории.
  async function goGetGlobalMessages(request) {
    const uid = requireUser(request);
    const limit = pageSize(request.data?.limit);
    const afterSeq = Number(request.data?.afterSeq);
    const beforeSeq = Number(request.data?.beforeSeq);
    const { chatRef } = await loadChat(uid);

    const chatSnap = await chatRef.get();
    const latestSeq = chatSnap.exists ? Number(chatSnap.data().msgSeq || 0) : 0;
    const base = { latestSeq, participantCount: 0 };

    if (Number.isFinite(afterSeq)) {
      if (afterSeq >= latestSeq) {
        return { ...base, messages: [], hasMore: false };
      }

      const snap = await chatRef
        .collection("messages")
        .where("seq", ">", afterSeq)
        .orderBy("seq", "asc")
        .limit(PAGE_MAX)
        .get();

      return {
        ...base,
        messages: snap.docs.map((doc) => publicMessage(doc.data())),
        hasMore: snap.docs.length === PAGE_MAX,
      };
    }

    if (Number.isFinite(beforeSeq)) {
      const snap = await chatRef
        .collection("messages")
        .where("seq", "<", beforeSeq)
        .orderBy("seq", "desc")
        .limit(limit)
        .get();

      return {
        ...base,
        messages: snap.docs
          .map((doc) => publicMessage(doc.data()))
          .reverse(),
        hasMore: snap.docs.length === limit,
      };
    }

    throw new HttpsError("invalid-argument", "Не указан курсор сообщений");
  }

  async function goSendGlobalMessage(request) {
    const uid = requireUser(request);
    const text = cleanMessageText(request.data?.text);
    const clientId = cleanString(request.data?.clientId, 40);

    if (!/^[A-Za-z0-9_-]{8,40}$/.test(clientId)) {
      throw new HttpsError(
        "invalid-argument",
        "Некорректный идентификатор сообщения"
      );
    }

    const { chatRef, profile } = await loadChat(uid);
    const senderRef = chatRef.collection("senders").doc(uid);
    const dedupeRef = chatRef.collection("msgDedupe").doc(`${uid}_${clientId}`);

    const message = await db.runTransaction(
      async (tx) => {
        const [chatSnap, senderSnap, dedupeSnap] = await Promise.all([
          tx.get(chatRef),
          tx.get(senderRef),
          tx.get(dedupeRef),
        ]);

        // Повторная отправка (retry) возвращает уже сохранённое сообщение.
        if (dedupeSnap.exists) {
          const savedSeq = Number(dedupeSnap.data().seq);
          const saved = await tx.get(
            chatRef.collection("messages").doc(padSeq(savedSeq))
          );

          if (saved.exists) return publicMessage(saved.data());
        }

        const lastMsgAt = senderSnap.exists
          ? toMillis(senderSnap.data().lastMsgAt)
          : null;

        if (lastMsgAt && now() - lastMsgAt < MIN_MSG_INTERVAL_MS) {
          throw new HttpsError(
            "resource-exhausted",
            "Слишком часто. Подожди секунду."
          );
        }

        const seq = (chatSnap.exists ? Number(chatSnap.data().msgSeq || 0) : 0) + 1;

        const stored = {
          seq,
          uid,
          text,
          clientId,
          senderName: cleanString(profile.name, 40) || "Участник GO",
          senderPhoto: cleanString(profile.photoUrl, 1500),
          createdAt: FieldValue.serverTimestamp(),
        };

        tx.set(chatRef.collection("messages").doc(padSeq(seq)), stored);
        tx.set(dedupeRef, { seq, createdAt: FieldValue.serverTimestamp() });
        tx.set(
          chatRef,
          { msgSeq: seq, lastMessageAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        tx.set(
          senderRef,
          { lastMsgAt: FieldValue.serverTimestamp() },
          { merge: true }
        );

        return { ...publicMessage({ ...stored, createdAt: null }), createdAt: now() };
      },
      // Один общий счётчик: при плотной переписке даём больше попыток.
      { maxAttempts: 10 }
    );

    return { success: true, message };
  }

  return { goGetGlobalChat, goGetGlobalMessages, goSendGlobalMessage };
}

module.exports = { createChatHandlers, MSG_MAX_LENGTH, PAGE_MAX };
