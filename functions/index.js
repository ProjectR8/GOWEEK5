const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

admin.initializeApp();

// ID базы данных из консоли Firestore. Если база называется "(default)", поставь "(default)".
const DB_ID = "goweek55";
const db = getFirestore(admin.app(), DB_ID);
db.settings({ ignoreUndefinedProperties: true });

const botToken = defineSecret("TELEGRAM_BOT_TOKEN");
const allowedOrigin = "https://projectr8.github.io";
const CLUB_IDS = ["gaming", "art", "tech"];
const OPTS = { region: "europe-west1", maxInstances: 20 };

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
const ageGroup = (age) => (Number(age) < 18 ? 0 : 1);
const round1 = (n) => Math.round(n * 10) / 10;

function hashFor(token, str) {
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  return crypto.createHmac("sha256", secretKey).update(str).digest("hex");
}

function requireUser(request) {
  const uid = request.auth?.uid;
  if (!uid || !uid.startsWith("tg_")) {
    throw new HttpsError("unauthenticated", "Необходимо войти через Telegram");
  }
  return uid;
}

function cleanString(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

// Любая неожиданная ошибка превращается в читаемый текст вместо "internal".
const safe = (fn) => async (request) => {
  try {
    return await fn(request);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("GO function error:", e);
    throw new HttpsError("failed-precondition", String((e && e.message) || e));
  }
};

function targetUidOf(request) {
  const t = cleanString(request.data?.targetUid, 100);
  if (!t || !t.startsWith("tg_")) throw new HttpsError("invalid-argument", "Некорректный пользователь");
  return t;
}

// Публичный вид анкеты. username показывается только при взаимной симпатии.
const pub = (id, d, reveal) => ({
  uid: id,
  name: d.name || "",
  age: Number(d.age || 0),
  city: d.city || "",
  bio: d.bio || "",
  interests: Array.isArray(d.interests) ? d.interests : [],
  photoUrl: d.photoUrl || "",
  ratingAvg: d.ratingCount ? round1((d.ratingSum || 0) / d.ratingCount) : 0,
  ratingCount: d.ratingCount || 0,
  popularity: d.swipesTotal ? round1(((d.swipesRight || 0) / d.swipesTotal) * 10) : 0,
  swipesTotal: d.swipesTotal || 0,
  username: reveal && d.showUsername !== false && d.tgUsername ? d.tgUsername : "",
});

// ---------- Telegram авторизация ----------
exports.telegramAuth = onRequest(
  { region: "europe-west1", secrets: [botToken], cors: [allowedOrigin], maxInstances: 10 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const initData = req.body?.initData;
      if (typeof initData !== "string" || initData.length > 10000) {
        return res.status(400).json({ error: "Invalid Telegram data" });
      }

      const params = new URLSearchParams(initData);
      const hash = params.get("hash");
      const authDate = Number(params.get("auth_date"));
      const userRaw = params.get("user");

      if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !userRaw) {
        return res.status(401).json({ error: "Invalid Telegram data" });
      }

      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > 86400) {
        return res.status(401).json({ error: "Expired Telegram data" });
      }

      params.delete("hash");
      const dataCheckString = [...params.entries()]
        .sort(byKey)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

      const calculated = hashFor(botToken.value().trim(), dataCheckString);
      const supplied = Buffer.from(hash.toLowerCase(), "hex");
      const expected = Buffer.from(calculated, "hex");

      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return res.status(401).json({ error: "Invalid Telegram signature" });
      }

      const tgUser = JSON.parse(userRaw);
      if (!Number.isSafeInteger(tgUser.id) || tgUser.id <= 0) {
        return res.status(401).json({ error: "Invalid Telegram user" });
      }

      const uid = `tg_${tgUser.id}`;

      try {
        await admin.auth().getUser(uid);
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
        await admin.auth().createUser({ uid, displayName: cleanString(tgUser.first_name || "GO user", 80) });
      }

      // Данные Telegram, подписанные ботом — им можно доверять при «подтянуть из Telegram».
      await db.collection("tgData").doc(uid).set(
        {
          firstName: cleanString(tgUser.first_name, 80),
          lastName: cleanString(tgUser.last_name, 80),
          username: cleanString(tgUser.username, 64),
          photoUrl: cleanString(tgUser.photo_url, 500),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const customToken = await admin.auth().createCustomToken(uid);
      return res.status(200).json({ token: customToken });
    } catch (error) {
      console.error("Telegram auth error:", error);
      return res.status(500).json({ error: "Authentication failed" });
    }
  }
);

// ---------- Загрузка всех данных ----------
exports.goGetData = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);

  const profileSnap = await db.collection("profiles").doc(uid).get();
  const me = profileSnap.exists ? profileSnap.data() : null;

  const [peopleSnap, swipesSnap, likedMeSnap, eventsSnap, matchesSnap, notifSnap, counts] =
    await Promise.all([
      db.collection("profiles").where("isVisible", "==", true).limit(150).get(),
      db.collection("swipes").where("fromUid", "==", uid).limit(500).get(),
      db.collection("swipes").where("toUid", "==", uid).where("direction", "==", "right").limit(500).get(),
      db.collection("events").where("status", "==", "published").limit(100).get(),
      db.collection("matches").where("memberUids", "array-contains", uid).limit(100).get(),
      db.collection("notifications").where("recipientUid", "==", uid).limit(100).get(),
      Promise.all(
        CLUB_IDS.map((id) =>
          db.collection("clubs").doc(id).collection("members").count().get()
            .then((s) => s.data().count)
            .catch(() => 0)
        )
      ),
    ]);

  const swipedUids = swipesSnap.docs.map((d) => d.data().toUid).filter(Boolean);
  const likedUids = swipesSnap.docs.filter((d) => d.data().direction === "right").map((d) => d.data().toUid);
  const likedMeSet = new Set(likedMeSnap.docs.map((d) => d.data().fromUid));
  const mutual = (id) => likedMeSet.has(id) && likedUids.includes(id);

  // Подростки и взрослые не видят друг друга.
  const people = me
    ? peopleSnap.docs
        .filter((d) => d.id !== uid && ageGroup(d.data().age) === ageGroup(me.age))
        .map((d) => pub(d.id, d.data(), mutual(d.id)))
    : [];

  const likedRefs = likedUids.slice(0, 100).map((id) => db.collection("profiles").doc(id));
  const likedSnaps = likedRefs.length ? await db.getAll(...likedRefs) : [];
  const liked = likedSnaps
    .filter((s) => s.exists)
    .map((s) => ({ ...pub(s.id, s.data(), mutual(s.id)), mutual: mutual(s.id) }));

  const events = await Promise.all(
    eventsSnap.docs.map(async (doc) => {
      const e = doc.data();
      const participant = await doc.ref.collection("participants").doc(uid).get();
      return {
        id: doc.id,
        title: e.title || "Без названия",
        description: e.description || "",
        category: e.category || "Встреча",
        date: e.date || "",
        time: e.time || "",
        place: e.place || "",
        createdBy: e.createdBy || "",
        participantCount: Number(e.participantCount || 0),
        capacity: Number(e.capacity || 30),
        joined: participant.exists,
        status: e.status || "published",
      };
    })
  );

  const notifications = notifSnap.docs
    .map((d) => {
      const n = d.data();
      return {
        id: d.id,
        type: n.type || "general",
        title: n.title || "Уведомление",
        text: n.text || "",
        read: n.read === true,
        createdAt: n.createdAt?.toMillis?.() ?? null,
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const clubCounts = {};
  CLUB_IDS.forEach((id, i) => (clubCounts[id] = counts[i]));

  const memberSnaps = await Promise.all(
    CLUB_IDS.map((id) => db.collection("clubs").doc(id).collection("members").doc(uid).get())
  );

  return {
    profile: me
      ? {
          ...pub(uid, me, true),
          username: me.tgUsername || "",
          showUsername: me.showUsername !== false,
          tgSync: me.tgSync === true,
        }
      : null,
    people,
    swipedUids,
    liked,
    likedMeCount: likedMeSet.size,
    events,
    matches: matchesSnap.docs.map((d) => ({ id: d.id, memberUids: d.data().memberUids || [] })),
    notifications,
    clubMemberships: CLUB_IDS.filter((_, i) => memberSnaps[i].exists),
    clubCounts,
  };
}));

// ---------- Профиль ----------
exports.goSaveProfile = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const data = request.data || {};

  const name = cleanString(data.name, 40);
  const age = Number(data.age);
  const city = cleanString(data.city, 60);
  const bio = cleanString(data.bio, 300);
  const useTelegram = data.useTelegram === true;
  const showUsername = data.showUsername !== false;

  const interests = Array.isArray(data.interests)
    ? [...new Set(data.interests.filter((i) => typeof i === "string").map((i) => cleanString(i, 30)).filter(Boolean))].slice(0, 10)
    : [];

  if (!name || !Number.isInteger(age) || age < 13 || age > 99) {
    throw new HttpsError("invalid-argument", "Укажи имя и возраст от 13 лет");
  }

  let tgUsername = "";
  let photoUrl = "";
  if (useTelegram) {
    const t = await db.collection("tgData").doc(uid).get();
    if (t.exists) {
      tgUsername = cleanString(t.data().username, 64);
      photoUrl = cleanString(t.data().photoUrl, 500);
    }
  }

  await db.collection("profiles").doc(uid).set(
    {
      name, age, city, bio, interests,
      tgSync: useTelegram, tgUsername, photoUrl, showUsername,
      isVisible: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true };
}));

exports.goDeleteProfile = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  await db.collection("profiles").doc(uid).delete();
  await db.collection("tgData").doc(uid).delete();
  return { success: true };
}));

// ---------- Свайпы ----------
exports.goSwipe = onCall({ ...OPTS, maxInstances: 30 }, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);
  const direction = request.data?.direction;

  if (targetUid === uid || !["left", "right"].includes(direction)) {
    throw new HttpsError("invalid-argument", "Некорректный свайп");
  }

  const outgoingRef = db.collection("swipes").doc(`${uid}_${targetUid}`);
  const incomingRef = db.collection("swipes").doc(`${targetUid}_${uid}`);
  const targetRef = db.collection("profiles").doc(targetUid);
  const senderRef = db.collection("profiles").doc(uid);
  const sorted = [uid, targetUid].sort();
  const matchRef = db.collection("matches").doc(`${sorted[0]}_${sorted[1]}`);
  const notifA = db.collection("notifications").doc();
  const notifB = db.collection("notifications").doc();

  const matched = await db.runTransaction(async (tx) => {
    const [target, incoming, existingMatch, sender, outgoing] = await Promise.all([
      tx.get(targetRef), tx.get(incomingRef), tx.get(matchRef), tx.get(senderRef), tx.get(outgoingRef),
    ]);

    if (!sender.exists) throw new HttpsError("failed-precondition", "Сначала заполни свою анкету");
    if (!target.exists || target.data().isVisible !== true) {
      throw new HttpsError("not-found", "Анкета больше недоступна");
    }
    if (ageGroup(target.data().age) !== ageGroup(sender.data().age)) {
      throw new HttpsError("permission-denied", "Эта анкета недоступна");
    }

    const prev = outgoing.exists ? outgoing.data().direction : null;
    let dTotal = 0;
    let dRight = 0;
    if (!prev) {
      dTotal = 1;
      dRight = direction === "right" ? 1 : 0;
    } else if (prev !== direction) {
      dRight = direction === "right" ? 1 : -1;
    }

    tx.set(outgoingRef, { fromUid: uid, toUid: targetUid, direction, updatedAt: FieldValue.serverTimestamp() });
    if (dTotal || dRight) {
      tx.update(targetRef, {
        swipesTotal: FieldValue.increment(dTotal),
        swipesRight: FieldValue.increment(dRight),
      });
    }

    const isMutual = direction === "right" && incoming.exists && incoming.data().direction === "right";

    if (isMutual && !existingMatch.exists) {
      tx.set(matchRef, { memberUids: sorted, createdAt: FieldValue.serverTimestamp() });
      const senderName = sender.data().name || "Участник GO";
      tx.set(notifA, {
        recipientUid: targetUid, type: "match", title: "Новое совпадение!",
        text: `${senderName} тоже заинтересован в совместных активностях`,
        read: false, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(notifB, {
        recipientUid: uid, type: "match", title: "Новое совпадение!",
        text: `У вас взаимный интерес с ${target.data().name || "участником"}`,
        read: false, createdAt: FieldValue.serverTimestamp(),
      });
    }

    return Boolean(isMutual || existingMatch.exists);
  });

  return { success: true, matched };
}));

exports.goUnlike = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);
  const outgoingRef = db.collection("swipes").doc(`${uid}_${targetUid}`);
  const targetRef = db.collection("profiles").doc(targetUid);
  const sorted = [uid, targetUid].sort();
  const matchRef = db.collection("matches").doc(`${sorted[0]}_${sorted[1]}`);

  await db.runTransaction(async (tx) => {
    const [outgoing, target, match] = await Promise.all([tx.get(outgoingRef), tx.get(targetRef), tx.get(matchRef)]);
    if (!outgoing.exists) return;
    if (target.exists) {
      tx.update(targetRef, {
        swipesTotal: FieldValue.increment(-1),
        swipesRight: FieldValue.increment(outgoing.data().direction === "right" ? -1 : 0),
      });
    }
    tx.delete(outgoingRef);
    if (match.exists) tx.delete(matchRef);
  });

  return { success: true };
}));

// ---------- Рейтинг ----------
exports.goRate = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);
  const stars = Number(request.data?.stars);

  if (targetUid === uid || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpsError("invalid-argument", "Оценка от 1 до 5");
  }

  const ratingRef = db.collection("ratings").doc(`${uid}_${targetUid}`);
  const targetRef = db.collection("profiles").doc(targetUid);

  return db.runTransaction(async (tx) => {
    const [rating, target] = await Promise.all([tx.get(ratingRef), tx.get(targetRef)]);
    if (!target.exists) throw new HttpsError("not-found", "Анкета не найдена");

    const old = rating.exists ? Number(rating.data().stars) : 0;
    const t = target.data();
    const sum = (t.ratingSum || 0) - old + stars;
    const count = (t.ratingCount || 0) + (rating.exists ? 0 : 1);

    tx.set(ratingRef, { fromUid: uid, toUid: targetUid, stars, updatedAt: FieldValue.serverTimestamp() });
    tx.update(targetRef, { ratingSum: sum, ratingCount: count });

    return { ratingAvg: round1(sum / count), ratingCount: count };
  });
}));

// ---------- Жалобы ----------
exports.goReport = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);
  if (targetUid === uid) throw new HttpsError("invalid-argument", "Нельзя пожаловаться на себя");

  await db.collection("reports").doc(`${uid}_${targetUid}`).set({
    fromUid: uid, toUid: targetUid, createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("swipes").doc(`${uid}_${targetUid}`).set(
    { fromUid: uid, toUid: targetUid, direction: "left", reported: true, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  // 5 жалоб от разных людей — анкета скрывается до проверки.
  const count = (await db.collection("reports").where("toUid", "==", targetUid).count().get()).data().count;
  if (count >= 5) {
    await db.collection("profiles").doc(targetUid).set({ isVisible: false }, { merge: true });
  }

  return { success: true };
}));

// ---------- События ----------
exports.goCreateEvent = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const d = request.data || {};

  const title = cleanString(d.title, 70);
  const description = cleanString(d.description, 500);
  const category = cleanString(d.category || "Встреча", 30);
  const date = cleanString(d.date, 20);
  const time = cleanString(d.time, 10);
  const place = cleanString(d.place, 100);
  const capacity = Math.max(2, Math.min(200, Math.round(Number(d.capacity)) || 30));

  if (!title || !description || !date || !time || !place) {
    throw new HttpsError("invalid-argument", "Заполни все поля события");
  }

  const eventRef = db.collection("events").doc();
  const batch = db.batch();
  batch.set(eventRef, {
    title, description, category, date, time, place, capacity,
    createdBy: uid, participantCount: 1, status: "published",
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(eventRef.collection("participants").doc(uid), { joinedAt: FieldValue.serverTimestamp() });
  await batch.commit();

  return { success: true, eventId: eventRef.id };
}));

exports.goJoinEvent = onCall({ ...OPTS, maxInstances: 30 }, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);
  if (!eventId) throw new HttpsError("invalid-argument", "Не указано событие");

  const eventRef = db.collection("events").doc(eventId);
  const participantRef = eventRef.collection("participants").doc(uid);

  const joined = await db.runTransaction(async (tx) => {
    const [eventSnap, participantSnap] = await Promise.all([tx.get(eventRef), tx.get(participantRef)]);
    if (!eventSnap.exists || eventSnap.data().status !== "published") {
      throw new HttpsError("not-found", "Событие не найдено");
    }
    if (participantSnap.exists) return false;

    const count = Number(eventSnap.data().participantCount || 0);
    if (count >= Number(eventSnap.data().capacity || 30)) {
      throw new HttpsError("failed-precondition", "Свободных мест больше нет");
    }

    tx.set(participantRef, { joinedAt: FieldValue.serverTimestamp() });
    tx.update(eventRef, { participantCount: count + 1 });
    return true;
  });

  return { success: true, joined };
}));

exports.goLeaveEvent = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);
  if (!eventId) throw new HttpsError("invalid-argument", "Не указано событие");

  const eventRef = db.collection("events").doc(eventId);
  const participantRef = eventRef.collection("participants").doc(uid);

  await db.runTransaction(async (tx) => {
    const [eventSnap, participantSnap] = await Promise.all([tx.get(eventRef), tx.get(participantRef)]);
    if (!eventSnap.exists || !participantSnap.exists) return;
    tx.delete(participantRef);
    tx.update(eventRef, { participantCount: Math.max(0, Number(eventSnap.data().participantCount || 1) - 1) });
  });

  return { success: true };
}));

exports.goDeleteEvent = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);
  const ref = db.collection("events").doc(eventId || "_");
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Событие не найдено");
  if (snap.data().createdBy !== uid) throw new HttpsError("permission-denied", "Удалить может только организатор");
  await ref.update({ status: "deleted" });
  return { success: true };
}));

// ---------- Клубы ----------
exports.goToggleClub = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const clubId = cleanString(request.data?.clubId, 30);
  if (!CLUB_IDS.includes(clubId)) throw new HttpsError("invalid-argument", "Сообщество не найдено");

  const memberRef = db.collection("clubs").doc(clubId).collection("members").doc(uid);

  const joined = await db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (snap.exists) {
      tx.delete(memberRef);
      return false;
    }
    tx.set(memberRef, { joinedAt: FieldValue.serverTimestamp() });
    return true;
  });

  const count = (await db.collection("clubs").doc(clubId).collection("members").count().get()).data().count;
  return { joined, count };
}));

// ---------- Уведомления ----------
exports.goMarkNotificationsRead = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const ids = Array.isArray(request.data?.notificationIds)
    ? [...new Set(request.data.notificationIds.filter((id) => typeof id === "string"))].slice(0, 100)
    : [];
  if (!ids.length) return { success: true, updated: 0 };

  const refs = ids.map((id) => db.collection("notifications").doc(id));
  const updated = await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    let count = 0;
    snaps.forEach((s) => {
      if (s.exists && s.data().recipientUid === uid && s.data().read !== true) {
        tx.update(s.ref, { read: true });
        count += 1;
      }
    });
    return count;
  });

  return { success: true, updated };
}));.
