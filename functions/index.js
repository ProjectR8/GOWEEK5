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

const BUILTIN_CLUBS = [
  {
    id: "gaming",
    title: "Игровой клуб",
    description: "Для тех, кто любит настолки и видеоигры. Находи команду и ходи на игровые встречи.",
    category: "Игры",
    icon: "game",
  },
  {
    id: "art",
    title: "Арт-комьюнити",
    description: "Рисование, фото, дизайн и музыка. Для тех, кто любит создавать и делиться.",
    category: "Творчество",
    icon: "art",
  },
  {
    id: "tech",
    title: "Технологии",
    description: "Код, электроника и пет-проекты. Собирай команду и ходи на хакатоны.",
    category: "Технологии",
    icon: "tech",
  },
];

const CLUB_CATEGORIES = [
  "Игры",
  "Творчество",
  "Технологии",
  "Музыка",
  "Спорт",
  "Общение",
  "Другое",
];

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

function isOwnProfileStorageUrl(value, uid) {
  try {
    const parsed = new URL(value);
    const decodedPath = decodeURIComponent(parsed.pathname);

    return parsed.protocol === "https:" &&
      parsed.hostname === "firebasestorage.googleapis.com" &&
      decodedPath.includes(`/profilePhotos/${uid}/`);
  } catch (_) {
    return false;
  }
}

// Любая неожиданная ошибка превращается в читаемый текст вместо "internal".
const safe = (fn) => async (request) => {
  try {
    return await fn(request);
  } catch (e) {
    if (e instanceof HttpsError) throw e;

    console.error("GO function error:", e);

    throw new HttpsError(
      "failed-precondition",
      String((e && e.message) || e)
    );
  }
};

function targetUidOf(request) {
  const targetUid = cleanString(request.data?.targetUid, 100);

  if (!targetUid || !targetUid.startsWith("tg_")) {
    throw new HttpsError("invalid-argument", "Некорректный пользователь");
  }

  return targetUid;
}

// Публичный вид анкеты. username показывается только при взаимной симпатии.
const pub = (id, data, reveal) => ({
  uid: id,
  name: data.name || "",
  age: Number(data.age || 0),
  city: data.city || "",
  bio: data.bio || "",
  interests: Array.isArray(data.interests) ? data.interests : [],
  photoUrl: data.photoUrl || "",
  ratingAvg: data.ratingCount
    ? round1((data.ratingSum || 0) / data.ratingCount)
    : 0,
  ratingCount: data.ratingCount || 0,
  popularity: data.swipesTotal
    ? round1(((data.swipesRight || 0) / data.swipesTotal) * 10)
    : 0,
  swipesTotal: data.swipesTotal || 0,
  username:
    reveal && data.showUsername !== false && data.tgUsername
      ? data.tgUsername
      : "",
});

function iconForClubCategory(category) {
  if (category === "Игры") return "game";
  if (category === "Творчество") return "art";
  if (category === "Технологии") return "tech";
  if (category === "Музыка") return "music";
  if (category === "Спорт") return "sport";

  return "users";
}

// Получение фиксированных клубов и пользовательских сообществ.
async function getClubData(uid) {
  const dynamicSnap = await db.collection("clubs")
    .where("isActive", "==", true)
    .limit(200)
    .get();

  const builtinRows = await Promise.all(
    BUILTIN_CLUBS.map(async (base) => {
      const clubRef = db.collection("clubs").doc(base.id);

      const [clubSnap, memberSnap] = await Promise.all([
        clubRef.get(),
        clubRef.collection("members").doc(uid).get(),
      ]);

      let memberCount = Number(
        clubSnap.exists ? clubSnap.data().memberCount : NaN
      );

      // Старые клубы могли не иметь отдельного поля memberCount.
      if (!Number.isFinite(memberCount)) {
        const countSnap = await clubRef.collection("members").count().get();
        memberCount = Number(countSnap.data().count || 0);
      }

      return {
        ...base,
        memberCount,
        joined: memberSnap.exists,
        ownerUid: "",
        isBuiltin: true,
      };
    })
  );

  const builtinIds = new Set(BUILTIN_CLUBS.map((club) => club.id));

  const dynamicRows = await Promise.all(
    dynamicSnap.docs
      .filter((doc) => !builtinIds.has(doc.id))
      .map(async (doc) => {
        const data = doc.data();

        const memberSnap = await doc.ref
          .collection("members")
          .doc(uid)
          .get();

        let memberCount = Number(data.memberCount);

        if (!Number.isFinite(memberCount)) {
          const countSnap = await doc.ref
            .collection("members")
            .count()
            .get();

          memberCount = Number(countSnap.data().count || 0);
        }

        return {
          id: doc.id,
          title: data.title || "Сообщество GO",
          description: data.description || "",
          category: data.category || "Другое",
          icon: data.icon || iconForClubCategory(data.category || "Другое"),
          memberCount,
          joined: memberSnap.exists,
          ownerUid: data.ownerUid || data.createdBy || "",
          isBuiltin: false,
        };
      })
  );

  const clubs = [...builtinRows, ...dynamicRows];
  const clubCounts = {};

  for (const club of clubs) {
    clubCounts[club.id] = club.memberCount;
  }

  return {
    clubs,
    clubCounts,
    clubMemberships: clubs
      .filter((club) => club.joined)
      .map((club) => club.id),
  };
}

// Получаем профили мэтчей напрямую по UID, а не из первых 150 анкет.
async function getMatchRows(uid, me, matchesSnap) {
  const rows = matchesSnap.docs.map((doc) => ({
    id: doc.id,
    memberUids: Array.isArray(doc.data().memberUids)
      ? doc.data().memberUids
      : [],
  }));

  const otherUids = [
    ...new Set(
      rows
        .map((row) => row.memberUids.find((memberUid) => memberUid !== uid))
        .filter(Boolean)
    ),
  ];

  const profileRefs = otherUids.map((otherUid) =>
    db.collection("profiles").doc(otherUid)
  );

  const tgRefs = otherUids.map((otherUid) =>
    db.collection("tgData").doc(otherUid)
  );

  const [profileSnaps, tgSnaps] = await Promise.all([
    profileRefs.length ? db.getAll(...profileRefs) : Promise.resolve([]),
    tgRefs.length ? db.getAll(...tgRefs) : Promise.resolve([]),
  ]);

  const tgByUid = new Map(
    tgSnaps
      .filter((snap) => snap.exists)
      .map((snap) => [snap.id, snap.data().username || ""])
  );

  const tgUidSet = new Set(
    tgSnaps
      .filter((snap) => snap.exists)
      .map((snap) => snap.id)
  );

  const byUid = new Map();

  for (const snap of profileSnaps) {
    if (!snap.exists || snap.data().isVisible !== true) continue;

    if (me && ageGroup(snap.data().age) !== ageGroup(me.age)) {
      continue;
    }

    const data = snap.data();

    // tgData — актуальный источник Telegram username.
    const currentUsername = tgUidSet.has(snap.id)
      ? tgByUid.get(snap.id)
      : (data.tgUsername || "");

    byUid.set(
      snap.id,
      pub(
        snap.id,
        { ...data, tgUsername: currentUsername },
        true
      )
    );
  }

  return rows.map((row) => {
    const otherUid = row.memberUids.find(
      (memberUid) => memberUid !== uid
    );

    return {
      ...row,
      profile: otherUid ? (byUid.get(otherUid) || null) : null,
    };
  });
}


// ---------- Telegram авторизация ----------
exports.telegramAuth = onRequest(
  {
    region: "europe-west1",
    secrets: [botToken],
    cors: [allowedOrigin],
    maxInstances: 10,
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

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

      if (
        !Number.isFinite(authDate) ||
        authDate > now + 60 ||
        now - authDate > 86400
      ) {
        return res.status(401).json({ error: "Expired Telegram data" });
      }

      params.delete("hash");

      const dataCheckString = [...params.entries()]
        .sort(byKey)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

      const calculated = hashFor(botToken.value().trim(), dataCheckString);
      const supplied = Buffer.from(hash.toLowerCase(), "hex");
      const expected = Buffer.from(calculated, "hex");

      if (
        supplied.length !== expected.length ||
        !crypto.timingSafeEqual(supplied, expected)
      ) {
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

        await admin.auth().createUser({
          uid,
          displayName: cleanString(tgUser.first_name || "GO user", 80),
        });
      }

      // Данные Telegram, подписанные ботом — им можно доверять.
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

      return res.status(500).json({
        error: "Authentication failed",
      });
    }
  }
);


// ---------- Загрузка всех данных ----------
exports.goGetData = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);

  const profileSnap = await db.collection("profiles").doc(uid).get();
  const me = profileSnap.exists ? profileSnap.data() : null;

  const [
    peopleSnap,
    swipesSnap,
    likedMeSnap,
    eventsSnap,
    matchesSnap,
    notifSnap,
  ] = await Promise.all([
    db.collection("profiles")
      .where("isVisible", "==", true)
      .limit(150)
      .get(),

    db.collection("swipes")
      .where("fromUid", "==", uid)
      .limit(500)
      .get(),

    db.collection("swipes")
      .where("toUid", "==", uid)
      .where("direction", "==", "right")
      .limit(500)
      .get(),

    db.collection("events")
      .where("status", "==", "published")
      .limit(100)
      .get(),

    db.collection("matches")
      .where("memberUids", "array-contains", uid)
      .limit(100)
      .get(),

    db.collection("notifications")
      .where("recipientUid", "==", uid)
      .limit(100)
      .get(),
  ]);

  const [clubData, userCountSnap] = await Promise.all([
    getClubData(uid),
    db.collection("profiles")
      .where("isVisible", "==", true)
      .count()
      .get(),
  ]);

  const swipedUids = swipesSnap.docs
    .map((doc) => doc.data().toUid)
    .filter(Boolean);

  const likedUids = swipesSnap.docs
    .filter((doc) => doc.data().direction === "right")
    .map((doc) => doc.data().toUid);

  const likedMeSet = new Set(
    likedMeSnap.docs.map((doc) => doc.data().fromUid)
  );

  const mutual = (id) =>
    likedMeSet.has(id) && likedUids.includes(id);

  // Подростки и взрослые не видят друг друга.
  const people = me
    ? peopleSnap.docs
        .filter(
          (doc) =>
            doc.id !== uid &&
            ageGroup(doc.data().age) === ageGroup(me.age)
        )
        .map((doc) => pub(doc.id, doc.data(), mutual(doc.id)))
    : [];

  const likedRefs = likedUids
    .slice(0, 100)
    .map((id) => db.collection("profiles").doc(id));

  const likedSnaps = likedRefs.length
    ? await db.getAll(...likedRefs)
    : [];

  const liked = likedSnaps
    .filter((snap) => snap.exists)
    .map((snap) => ({
      ...pub(snap.id, snap.data(), mutual(snap.id)),
      mutual: mutual(snap.id),
    }));

  const events = await Promise.all(
    eventsSnap.docs.map(async (doc) => {
      const event = doc.data();

      const participant = await doc.ref
        .collection("participants")
        .doc(uid)
        .get();

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
        joined: participant.exists,
        status: event.status || "published",
      };
    })
  );

  const [photoPostsSnap, matches] = await Promise.all([
    db.collection("profiles")
      .doc(uid)
      .collection("posts")
      .orderBy("createdAt", "desc")
      .limit(30)
      .get(),

    getMatchRows(uid, me, matchesSnap),
  ]);

  const notifications = notifSnap.docs
    .map((doc) => {
      const notification = doc.data();

      return {
        id: doc.id,
        type: notification.type || "general",
        title: notification.title || "Уведомление",
        text: notification.text || "",
        read: notification.read === true,
        createdAt: notification.createdAt?.toMillis?.() ?? null,
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

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
    matches,
    notifications,

    photoPosts: photoPostsSnap.docs.map((doc) => ({
      id: doc.id,
      photoUrl: doc.data().photoUrl || "",
      caption: doc.data().caption || "",
      createdAt: doc.data().createdAt?.toMillis?.() ?? null,
    })),

    clubMemberships: clubData.clubMemberships,
    clubCounts: clubData.clubCounts,
    clubs: clubData.clubs,
    totalUsers: Number(userCountSnap.data().count || 0),
  };
}));


// ---------- Лёгкое обновление данных для открытого Mini App ----------
exports.goGetLiveUpdates = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);

  const profileSnap = await db.collection("profiles").doc(uid).get();
  const me = profileSnap.exists ? profileSnap.data() : null;

  const [
    peopleSnap,
    swipesSnap,
    likedMeSnap,
    eventsSnap,
    matchesSnap,
    notifSnap,
    clubData,
    userCountSnap,
  ] = await Promise.all([
    db.collection("profiles")
      .where("isVisible", "==", true)
      .limit(150)
      .get(),

    db.collection("swipes")
      .where("fromUid", "==", uid)
      .limit(500)
      .get(),

    db.collection("swipes")
      .where("toUid", "==", uid)
      .where("direction", "==", "right")
      .limit(500)
      .get(),

    db.collection("events")
      .where("status", "==", "published")
      .limit(100)
      .get(),

    db.collection("matches")
      .where("memberUids", "array-contains", uid)
      .limit(100)
      .get(),

    db.collection("notifications")
      .where("recipientUid", "==", uid)
      .limit(100)
      .get(),

    getClubData(uid),

    db.collection("profiles")
      .where("isVisible", "==", true)
      .count()
      .get(),
  ]);

  const swipedUids = swipesSnap.docs
    .map((doc) => doc.data().toUid)
    .filter(Boolean);

  const likedUids = swipesSnap.docs
    .filter((doc) => doc.data().direction === "right")
    .map((doc) => doc.data().toUid);

  const likedMeSet = new Set(
    likedMeSnap.docs.map((doc) => doc.data().fromUid)
  );

  const mutual = (otherUid) =>
    likedMeSet.has(otherUid) && likedUids.includes(otherUid);

  const people = me
    ? peopleSnap.docs
        .filter(
          (doc) =>
            doc.id !== uid &&
            ageGroup(doc.data().age) === ageGroup(me.age)
        )
        .map((doc) => pub(doc.id, doc.data(), mutual(doc.id)))
    : [];

  const events = await Promise.all(
    eventsSnap.docs.map(async (doc) => {
      const data = doc.data();

      const participant = await doc.ref
        .collection("participants")
        .doc(uid)
        .get();

      return {
        id: doc.id,
        title: data.title || "Без названия",
        description: data.description || "",
        category: data.category || "Встреча",
        date: data.date || "",
        time: data.time || "",
        place: data.place || "",
        city: data.city || "",
        createdBy: data.createdBy || "",
        participantCount: Number(data.participantCount || 0),
        capacity: Number(data.capacity || 30),
        joined: participant.exists,
        status: data.status || "published",
      };
    })
  );

  const notifications = notifSnap.docs
    .map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        type: data.type || "general",
        title: data.title || "Уведомление",
        text: data.text || "",
        read: data.read === true,
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return {
    people,
    swipedUids,
    matches: await getMatchRows(uid, me, matchesSnap),
    events,
    notifications,

    clubMemberships: clubData.clubMemberships,
    clubCounts: clubData.clubCounts,
    clubs: clubData.clubs,
    totalUsers: Number(userCountSnap.data().count || 0),
  };
}));// ---------- Профиль ----------
exports.goSaveProfile = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const data = request.data || {};

  const name = cleanString(data.name, 40);
  const age = Number(data.age);
  const city = cleanString(data.city, 60);
  const bio = cleanString(data.bio, 300);
  const useTelegram = data.useTelegram === true;
  const showUsernameInput = data.showUsername;

  const interests = Array.isArray(data.interests)
    ? [...new Set(
        data.interests
          .filter((i) => typeof i === "string")
          .map((i) => cleanString(i, 30))
          .filter(Boolean)
      )].slice(0, 10)
    : [];

  if (!name || !Number.isInteger(age) || age < 13 || age > 99) {
    throw new HttpsError("invalid-argument", "Укажи имя и возраст от 13 лет");
  }

  // Не затираем Telegram username при обычном сохранении анкеты.
  const [telegramDataSnap, existingProfileSnap] = await Promise.all([
    db.collection("tgData").doc(uid).get(),
    db.collection("profiles").doc(uid).get(),
  ]);

  const telegramUsername = telegramDataSnap.exists
    ? telegramDataSnap.data().username
    : (
        existingProfileSnap.exists
          ? existingProfileSnap.data().tgUsername
          : ""
      );

  const tgUsername = cleanString(telegramUsername || "", 64);

  // Сохраняем существующую настройку приватности, если её не передали.
  const showUsername = showUsernameInput === undefined
    ? (
        !existingProfileSnap.exists ||
        existingProfileSnap.data().showUsername !== false
      )
    : showUsernameInput !== false;

  let photoUrl = "";

  if (useTelegram) {
    if (telegramDataSnap.exists) {
      photoUrl = cleanString(telegramDataSnap.data().photoUrl, 500);
    }
  } else if (data.photoUrl !== undefined) {
    photoUrl = cleanString(data.photoUrl, 1500);

    if (photoUrl && !isOwnProfileStorageUrl(photoUrl, uid)) {
      throw new HttpsError(
        "invalid-argument",
        "Некорректная ссылка на фото профиля"
      );
    }
  }

  await db.collection("profiles").doc(uid).set(
    {
      name,
      age,
      city,
      bio,
      interests,
      tgSync: useTelegram,
      tgUsername,
      showUsername,
      ...(useTelegram || photoUrl ? { photoUrl } : {}),
      isVisible: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true };
}));


// ---------- Фотографии профиля ----------
exports.goCreatePhotoPost = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const photoUrl = cleanString(request.data?.photoUrl, 1500);
  const caption = cleanString(request.data?.caption, 200);

  if (!isOwnProfileStorageUrl(photoUrl, uid)) {
    throw new HttpsError(
      "invalid-argument",
      "Некорректная ссылка на фотографию"
    );
  }

  const profileRef = db.collection("profiles").doc(uid);
  const profileSnap = await profileRef.get();

  if (!profileSnap.exists || profileSnap.data().isVisible !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Сначала создай анкету"
    );
  }

  const postRef = profileRef.collection("posts").doc();

  await postRef.set({
    photoUrl,
    caption,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    postId: postRef.id,
  };
}));

exports.goDeletePhotoPost = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const postId = cleanString(request.data?.postId, 100);

  if (!postId) {
    throw new HttpsError("invalid-argument", "Не указана публикация");
  }

  await db.collection("profiles")
    .doc(uid)
    .collection("posts")
    .doc(postId)
    .delete();

  return { success: true };
}));

exports.goGetPosts = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);

  const [me, target] = await Promise.all([
    db.collection("profiles").doc(uid).get(),
    db.collection("profiles").doc(targetUid).get(),
  ]);

  if (!me.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Сначала заполни свою анкету"
    );
  }

  if (!target.exists || target.data().isVisible !== true) {
    throw new HttpsError("not-found", "Анкета недоступна");
  }

  if (ageGroup(target.data().age) !== ageGroup(me.data().age)) {
    throw new HttpsError("permission-denied", "Анкета недоступна");
  }

  const snap = await db.collection("profiles")
    .doc(targetUid)
    .collection("posts")
    .orderBy("createdAt", "desc")
    .limit(30)
    .get();

  return {
    posts: snap.docs.map((doc) => ({
      id: doc.id,
      photoUrl: doc.data().photoUrl || "",
      caption: doc.data().caption || "",
      createdAt: doc.data().createdAt?.toMillis?.() ?? null,
    })),
  };
}));

exports.goDeleteProfile = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);

  await db.collection("profiles").doc(uid).delete();
  await db.collection("tgData").doc(uid).delete();

  return { success: true };
}));


// ---------- Свайпы ----------
exports.goSwipe = onCall(
  { ...OPTS, maxInstances: 30 },
  safe(async (request) => {
    const uid = requireUser(request);
    const targetUid = targetUidOf(request);
    const direction = request.data?.direction;

    if (targetUid === uid || !["left", "right"].includes(direction)) {
      throw new HttpsError("invalid-argument", "Некорректный свайп");
    }

    const outgoingRef = db.collection("swipes")
      .doc(`${uid}_${targetUid}`);

    const incomingRef = db.collection("swipes")
      .doc(`${targetUid}_${uid}`);

    const targetRef = db.collection("profiles").doc(targetUid);
    const senderRef = db.collection("profiles").doc(uid);

    const sorted = [uid, targetUid].sort();

    const matchRef = db.collection("matches")
      .doc(`${sorted[0]}_${sorted[1]}`);

    const notifA = db.collection("notifications").doc();
    const notifB = db.collection("notifications").doc();

    const matched = await db.runTransaction(async (tx) => {
      const [
        target,
        incoming,
        existingMatch,
        sender,
        outgoing,
      ] = await Promise.all([
        tx.get(targetRef),
        tx.get(incomingRef),
        tx.get(matchRef),
        tx.get(senderRef),
        tx.get(outgoingRef),
      ]);

      if (!sender.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Сначала заполни свою анкету"
        );
      }

      if (!target.exists || target.data().isVisible !== true) {
        throw new HttpsError(
          "not-found",
          "Анкета больше недоступна"
        );
      }

      if (ageGroup(target.data().age) !== ageGroup(sender.data().age)) {
        throw new HttpsError(
          "permission-denied",
          "Эта анкета недоступна"
        );
      }

      const prev = outgoing.exists
        ? outgoing.data().direction
        : null;

      let dTotal = 0;
      let dRight = 0;

      if (!prev) {
        dTotal = 1;
        dRight = direction === "right" ? 1 : 0;
      } else if (prev !== direction) {
        dRight = direction === "right" ? 1 : -1;
      }

      tx.set(outgoingRef, {
        fromUid: uid,
        toUid: targetUid,
        direction,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (dTotal || dRight) {
        tx.update(targetRef, {
          swipesTotal: FieldValue.increment(dTotal),
          swipesRight: FieldValue.increment(dRight),
        });
      }

      const isMutual =
        direction === "right" &&
        incoming.exists &&
        incoming.data().direction === "right";

      if (isMutual && !existingMatch.exists) {
        tx.set(matchRef, {
          memberUids: sorted,
          createdAt: FieldValue.serverTimestamp(),
        });

        const senderName = sender.data().name || "Участник GO";

        tx.set(notifA, {
          recipientUid: targetUid,
          type: "match",
          title: "Новое совпадение!",
          text: `${senderName} тоже заинтересован в совместных активностях`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.set(notifB, {
          recipientUid: uid,
          type: "match",
          title: "Новое совпадение!",
          text: `У вас взаимный интерес с ${target.data().name || "участником"}`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return Boolean(isMutual || existingMatch.exists);
    });

    return {
      success: true,
      matched,
    };
  })
);

exports.goUnlike = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);

  const outgoingRef = db.collection("swipes")
    .doc(`${uid}_${targetUid}`);

  const targetRef = db.collection("profiles").doc(targetUid);
  const sorted = [uid, targetUid].sort();

  const matchRef = db.collection("matches")
    .doc(`${sorted[0]}_${sorted[1]}`);

  await db.runTransaction(async (tx) => {
    const [outgoing, target, match] = await Promise.all([
      tx.get(outgoingRef),
      tx.get(targetRef),
      tx.get(matchRef),
    ]);

    if (!outgoing.exists) return;

    if (target.exists) {
      tx.update(targetRef, {
        swipesTotal: FieldValue.increment(-1),
        swipesRight: FieldValue.increment(
          outgoing.data().direction === "right" ? -1 : 0
        ),
      });
    }

    tx.delete(outgoingRef);

    if (match.exists) {
      tx.delete(matchRef);
    }
  });

  return { success: true };
}));


// ---------- Рейтинг ----------
exports.goRate = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);
  const stars = Number(request.data?.stars);

  if (
    targetUid === uid ||
    !Number.isInteger(stars) ||
    stars < 1 ||
    stars > 5
  ) {
    throw new HttpsError("invalid-argument", "Оценка от 1 до 5");
  }

  const ratingRef = db.collection("ratings")
    .doc(`${uid}_${targetUid}`);

  const targetRef = db.collection("profiles").doc(targetUid);

  return db.runTransaction(async (tx) => {
    const [rating, target] = await Promise.all([
      tx.get(ratingRef),
      tx.get(targetRef),
    ]);

    if (!target.exists) {
      throw new HttpsError("not-found", "Анкета не найдена");
    }

    const old = rating.exists
      ? Number(rating.data().stars)
      : 0;

    const targetData = target.data();
    const sum = (targetData.ratingSum || 0) - old + stars;
    const count = (targetData.ratingCount || 0) + (rating.exists ? 0 : 1);

    tx.set(ratingRef, {
      fromUid: uid,
      toUid: targetUid,
      stars,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(targetRef, {
      ratingSum: sum,
      ratingCount: count,
    });

    return {
      ratingAvg: round1(sum / count),
      ratingCount: count,
    };
  });
}));


// ---------- Жалобы ----------
exports.goReport = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const targetUid = targetUidOf(request);

  if (targetUid === uid) {
    throw new HttpsError("invalid-argument", "Нельзя пожаловаться на себя");
  }

  await db.collection("reports").doc(`${uid}_${targetUid}`).set({
    fromUid: uid,
    toUid: targetUid,
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection("swipes").doc(`${uid}_${targetUid}`).set(
    {
      fromUid: uid,
      toUid: targetUid,
      direction: "left",
      reported: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // 5 жалоб от разных людей — анкета скрывается до проверки.
  const count = (
    await db.collection("reports")
      .where("toUid", "==", targetUid)
      .count()
      .get()
  ).data().count;

  if (count >= 5) {
    await db.collection("profiles").doc(targetUid).set(
      { isVisible: false },
      { merge: true }
    );
  }

  return { success: true };
}));


// ---------- События ----------
exports.goCreateEvent = onCall(OPTS, safe(async (request) => {
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
    throw new HttpsError(
      "invalid-argument",
      "Заполни все поля события"
    );
  }

  const creator = await db.collection("profiles").doc(uid).get();
  const city = creator.exists
    ? cleanString(creator.data().city, 60)
    : "";

  const eventRef = db.collection("events").doc();
  const batch = db.batch();

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
    status: "published",
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.set(
    eventRef.collection("participants").doc(uid),
    {
      joinedAt: FieldValue.serverTimestamp(),
    }
  );

  await batch.commit();

  return {
    success: true,
    eventId: eventRef.id,
  };
}));

exports.goJoinEvent = onCall(
  { ...OPTS, maxInstances: 30 },
  safe(async (request) => {
    const uid = requireUser(request);
    const eventId = cleanString(request.data?.eventId, 150);

    if (!eventId) {
      throw new HttpsError("invalid-argument", "Не указано событие");
    }

    const eventRef = db.collection("events").doc(eventId);
    const participantRef = eventRef.collection("participants").doc(uid);

    const joined = await db.runTransaction(async (tx) => {
      const [eventSnap, participantSnap] = await Promise.all([
        tx.get(eventRef),
        tx.get(participantRef),
      ]);

      if (!eventSnap.exists || eventSnap.data().status !== "published") {
        throw new HttpsError("not-found", "Событие не найдено");
      }

      if (participantSnap.exists) return false;

      const count = Number(eventSnap.data().participantCount || 0);
      const capacity = Number(eventSnap.data().capacity || 30);

      if (count >= capacity) {
        throw new HttpsError(
          "failed-precondition",
          "Свободных мест больше нет"
        );
      }

      tx.set(participantRef, {
        joinedAt: FieldValue.serverTimestamp(),
      });

      tx.update(eventRef, {
        participantCount: count + 1,
      });

      return true;
    });

    return {
      success: true,
      joined,
    };
  })
);

exports.goLeaveEvent = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);

  if (!eventId) {
    throw new HttpsError("invalid-argument", "Не указано событие");
  }

  const eventRef = db.collection("events").doc(eventId);
  const participantRef = eventRef.collection("participants").doc(uid);

  await db.runTransaction(async (tx) => {
    const [eventSnap, participantSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(participantRef),
    ]);

    if (!eventSnap.exists || !participantSnap.exists) return;

    tx.delete(participantRef);

    tx.update(eventRef, {
      participantCount: Math.max(
        0,
        Number(eventSnap.data().participantCount || 1) - 1      ),
    });
  });

  return { success: true };
}));

exports.goDeleteEvent = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);
  const ref = db.collection("events").doc(eventId || "_");

  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Событие не найдено");
  }

  if (snap.data().createdBy !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Удалить может только организатор"
    );
  }

  await ref.update({ status: "deleted" });

  return { success: true };
}));



// ---------- Чаты событий: доступ только действующим участникам ----------
async function requireEventParticipant(uid, eventId) {
  const eventRef = db.collection("events").doc(eventId);
  const [eventSnap, participantSnap] = await Promise.all([
    eventRef.get(),
    eventRef.collection("participants").doc(uid).get(),
  ]);

  if (!eventSnap.exists || eventSnap.data().status !== "published") {
    throw new HttpsError("not-found", "Событие не найдено");
  }
  if (!participantSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Чат доступен только участникам события"
    );
  }
  return eventRef;
}

exports.goGetEventChat = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Не указано событие");
  }

  const eventRef = await requireEventParticipant(uid, eventId);
  const snap = await eventRef.collection("messages")
    .orderBy("createdAt", "desc")
    .limit(60)
    .get();

  const messages = snap.docs.reverse().map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      uid: data.uid || "",
      name: data.name || "Участник",
      text: data.text || "",
      createdAt: data.createdAt?.toMillis?.() || null,
    };
  });

  return { messages };
}));

exports.goSendEventMessage = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const eventId = cleanString(request.data?.eventId, 150);
  const text = cleanString(request.data?.text, 500);

  if (!eventId || !text) {
    throw new HttpsError("invalid-argument", "Напиши сообщение");
  }

  const eventRef = await requireEventParticipant(uid, eventId);
  const profileSnap = await db.collection("profiles").doc(uid).get();
  const name = cleanString(
    profileSnap.exists ? profileSnap.data().name : "Участник",
    40
  ) || "Участник";

  const messageRef = eventRef.collection("messages").doc();
  await messageRef.set({
    uid,
    name,
    text,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, messageId: messageRef.id };
}));

// ---------- Клубы и сообщества ----------
exports.goCreateClub = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const data = request.data || {};

  const title = cleanString(data.title, 40);
  const description = cleanString(data.description, 300);
  const category = cleanString(data.category || "Другое", 30);

  if (title.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      "Название должно содержать минимум 3 символа"
    );
  }

  if (description.length < 10) {
    throw new HttpsError(
      "invalid-argument",
      "Описание должно содержать минимум 10 символов"
    );
  }

  if (!CLUB_CATEGORIES.includes(category)) {
    throw new HttpsError(
      "invalid-argument",
      "Некорректная категория сообщества"
    );
  }

  const profileSnap = await db.collection("profiles").doc(uid).get();

  if (!profileSnap.exists || profileSnap.data().isVisible !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Сначала создай анкету"
    );
  }

  const [mineSnap, activeClubsSnap] = await Promise.all([
    db.collection("clubs")
      .where("ownerUid", "==", uid)
      .limit(10)
      .get(),

    db.collection("clubs")
      .where("isActive", "==", true)
      .limit(200)
      .get(),
  ]);

  const activeMine = mineSnap.docs.filter(
    (doc) => doc.data().isActive !== false
  );

  const activeTitles = [
    ...BUILTIN_CLUBS.map((club) => club.title.toLowerCase()),
    ...activeClubsSnap.docs.map((doc) =>
      String(
        doc.data().titleLower ||
        doc.data().title ||
        ""
      ).toLowerCase()
    ),
  ];

  if (activeMine.length >= 5) {
    throw new HttpsError(
      "resource-exhausted",
      "Можно создать не более 5 активных сообществ"
    );
  }

  if (activeTitles.includes(title.toLowerCase())) {
    throw new HttpsError(
      "already-exists",
      "Сообщество с таким названием уже существует"
    );
  }

  const clubRef = db.collection("clubs").doc();
  const memberRef = clubRef.collection("members").doc(uid);
  const icon = iconForClubCategory(category);

  const batch = db.batch();

  batch.set(clubRef, {
    title,
    titleLower: title.toLowerCase(),
    description,
    category,
    icon,
    ownerUid: uid,
    createdBy: uid,
    isActive: true,
    isBuiltin: false,
    memberCount: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.set(memberRef, {
    uid,
    joinedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return {
    success: true,
    club: {
      id: clubRef.id,
      title,
      description,
      category,
      icon,
      ownerUid: uid,
      memberCount: 1,
      joined: true,
    },
  };
}));

exports.goToggleClub = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);
  const clubId = cleanString(request.data?.clubId, 100);

  if (!clubId) {
    throw new HttpsError(
      "invalid-argument",
      "Сообщество не найдено"
    );
  }

  const clubRef = db.collection("clubs").doc(clubId);
  const memberRef = clubRef.collection("members").doc(uid);

  const clubSnap = await clubRef.get();
  const builtin = BUILTIN_CLUBS.find(
    (club) => club.id === clubId
  );

  if (
    (!clubSnap.exists && !builtin) ||
    (clubSnap.exists && clubSnap.data().isActive === false)
  ) {
    throw new HttpsError(
      "not-found",
      "Сообщество не найдено"
    );
  }

  let currentCount = Number(
    clubSnap.exists
      ? clubSnap.data().memberCount
      : NaN
  );

  if (!Number.isFinite(currentCount)) {
    const countSnap = await clubRef.collection("members")
      .count()
      .get();

    currentCount = Number(countSnap.data().count || 0);
  }

  // Операции вступления и выхода выполняются транзакционно:
  // параллельные изменения не должны ломать memberCount.
  const joined = await db.runTransaction(async (tx) => {
    const [memberSnap, currentClubSnap] = await Promise.all([
      tx.get(memberRef),
      tx.get(clubRef),
    ]);

    const storedCount =
      currentClubSnap.exists &&
      Number.isFinite(Number(currentClubSnap.data().memberCount))
        ? Number(currentClubSnap.data().memberCount)
        : currentCount;

    if (memberSnap.exists) {
      tx.delete(memberRef);

      const nextCount = Math.max(0, storedCount - 1);

      if (currentClubSnap.exists) {
        tx.update(clubRef, {
          memberCount: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.set(clubRef, {
          ...builtin,
          isActive: true,
          isBuiltin: true,
          memberCount: nextCount,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return false;
    }

    tx.set(memberRef, {
      uid,
      joinedAt: FieldValue.serverTimestamp(),
    });

    if (currentClubSnap.exists) {
      tx.update(clubRef, {
        memberCount: storedCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(clubRef, {
        ...builtin,
        isActive: true,
        isBuiltin: true,
        memberCount: storedCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return true;
  });

  const clubAfter = await clubRef.get();

  let count = Number(clubAfter.data()?.memberCount);

  if (!Number.isFinite(count)) {
    const countSnap = await clubRef.collection("members")
      .count()
      .get();

    count = Number(countSnap.data().count || 0);
  }

  return {
    joined,
    count,
  };
}));


// ---------- Уведомления ----------
exports.goMarkNotificationsRead = onCall(OPTS, safe(async (request) => {
  const uid = requireUser(request);

  const ids = Array.isArray(request.data?.notificationIds)
    ? [
        ...new Set(
          request.data.notificationIds.filter(
            (id) => typeof id === "string"
          )
        ),
      ].slice(0, 100)
    : [];

  if (!ids.length) {
    return {
      success: true,
      updated: 0,
    };
  }

  const refs = ids.map((id) =>
    db.collection("notifications").doc(id)
  );

  const updated = await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(
      refs.map((ref) => tx.get(ref))
    );

    let count = 0;

    snaps.forEach((snap) => {
      if (
        snap.exists &&
        snap.data().recipientUid === uid &&
        snap.data().read !== true
      ) {
        tx.update(snap.ref, { read: true });
        count += 1;
      }
    });

    return count;
  });

  return {
    success: true,
    updated,
  };
}));