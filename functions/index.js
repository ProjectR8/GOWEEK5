const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();
const botToken = defineSecret("TELEGRAM_BOT_TOKEN");
const allowedOrigin = "https://projectr8.github.io";
const CLUB_IDS = ["gaming", "art", "tech"];

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

function hashFor(token, str) {
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(token)
    .digest();

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

// Telegram Mini App authentication.
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

      const entries = [...params.entries()].sort(byKey);
      const dataCheckString = entries
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

      const token = botToken.value().trim();
      const calculated = hashFor(token, dataCheckString);

      const supplied = Buffer.from(hash.toLowerCase(), "hex");
      const expected = Buffer.from(calculated, "hex");

      if (
        supplied.length !== expected.length ||
        !crypto.timingSafeEqual(supplied, expected)
      ) {
        return res.status(401).json({
          error: "Invalid Telegram signature",
        });
      }

      const telegramUser = JSON.parse(userRaw);

      if (
        !Number.isSafeInteger(telegramUser.id) ||
        telegramUser.id <= 0
      ) {
        return res.status(401).json({ error: "Invalid Telegram user" });
      }

      const uid = `tg_${telegramUser.id}`;

      try {
        await admin.auth().getUser(uid);
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;

        await admin.auth().createUser({
          uid,
          displayName: cleanString(
            telegramUser.first_name || "GO user",
            80
          ),
        });
      }

      const customToken = await admin.auth().createCustomToken(uid);

      return res.status(200).json({ token: customToken });
    } catch (error) {
      console.error("Telegram auth error:", error);
      return res.status(500).json({
        error: "Authentication failed",
      });
    }
  },
);

// Загрузка профиля, анкет, событий, совпадений и уведомлений.
exports.goGetData = onCall(
  { region: "europe-west1", maxInstances: 20 },
  async (request) => {
    const uid = requireUser(request);

    const [
      profileSnap,
      peopleSnap,
      swipesSnap,
      eventsSnap,
      matchesSnap,
      notificationsSnap,
      clubSnaps,
    ] = await Promise.all([
      db.collection("profiles").doc(uid).get(),

      db.collection("profiles")
        .where("isVisible", "==", true)
        .limit(100)
        .get(),

      db.collection("swipes")
        .where("fromUid", "==", uid)
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

      Promise.all(
        CLUB_IDS.map((id) =>
          db.collection("clubs")
            .doc(id)
            .collection("members")
            .doc(uid)
            .get()
        )
      ),
    ]);

    const swipedUids = swipesSnap.docs
      .map((doc) => doc.data().toUid)
      .filter(Boolean);

    const people = peopleSnap.docs
      .filter((doc) => doc.id !== uid)
      .map((doc) => ({
        uid: doc.id,
        ...doc.data(),
      }));

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
          createdBy: data.createdBy || "",
          participantCount: Number(data.participantCount || 0),
          capacity: Number(data.capacity || 30),
          joined: participant.exists,
          status: data.status || "published",
        };
      })
    );

    const notifications = notificationsSnap.docs.map((doc) => ({
      id: doc.id,
      type: doc.data().type || "general",
      title: doc.data().title || "Уведомление",
      text: doc.data().text || "",
      read: doc.data().read === true,
      createdAt: doc.data().createdAt || null,
    }));

    return {
      profile: profileSnap.exists
        ? { uid, ...profileSnap.data() }
        : null,

      people,
      swipedUids,
      events,

      matches: matchesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),

      notifications,

      clubMemberships: CLUB_IDS.filter(
        (id, index) => clubSnaps[index].exists
      ),
    };
  }
);

// Сохранение анкеты участника.
exports.goSaveProfile = onCall(
  { region: "europe-west1", maxInstances: 20 },
  async (request) => {
    const uid = requireUser(request);
    const data = request.data || {};

    const name = cleanString(data.name, 40);
    const age = Number(data.age);
    const city = cleanString(data.city, 60);
    const bio = cleanString(data.bio, 300);

    const interests = Array.isArray(data.interests)
      ? [
          ...new Set(
            data.interests
              .filter((item) => typeof item === "string")
              .map((item) => cleanString(item, 30))
              .filter(Boolean)
          ),
        ].slice(0, 10)
      : [];

    if (!name || !Number.isInteger(age) || age < 13 || age > 17) {
      throw new HttpsError(
        "invalid-argument",
        "Укажи имя и возраст от 13 до 17 лет"
      );
    }

    await db.collection("profiles").doc(uid).set(
      {
        name,
        age,
        city,
        bio,
        interests,
        isVisible: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true };
  }
);

// Свайп и создание взаимного совпадения.
exports.goSwipe = onCall(
  { region: "europe-west1", maxInstances: 30 },
  async (request) => {
    const uid = requireUser(request);
    const targetUid = cleanString(request.data?.targetUid, 100);
    const direction = request.data?.direction;

    if (
      !targetUid ||
      targetUid === uid ||
      !targetUid.startsWith("tg_") ||
      !["left", "right"].includes(direction)
    ) {
      throw new HttpsError("invalid-argument", "Некорректный свайп");
    }

    const outgoingRef = db.collection("swipes").doc(
      `${uid}_${targetUid}`
    );

    const incomingRef = db.collection("swipes").doc(
      `${targetUid}_${uid}`
    );

    const targetProfileRef = db.collection("profiles").doc(targetUid);
    const senderProfileRef = db.collection("profiles").doc(uid);

    const sortedUids = [uid, targetUid].sort();

    const matchRef = db.collection("matches").doc(
      `${sortedUids[0]}_${sortedUids[1]}`
    );

    const notificationRefA = db.collection("notifications").doc();
    const notificationRefB = db.collection("notifications").doc();

    const matched = await db.runTransaction(async (tx) => {
      // Сначала все чтения, затем записи — требование Firestore.
      const [
        targetProfile,
        incoming,
        existingMatch,
        senderProfile,
      ] = await Promise.all([
        tx.get(targetProfileRef),
        tx.get(incomingRef),
        tx.get(matchRef),
        tx.get(senderProfileRef),
      ]);

      if (
        !targetProfile.exists ||
        targetProfile.data().isVisible !== true
      ) {
        throw new HttpsError(
          "not-found",
          "Анкета больше недоступна"
        );
      }

      tx.set(outgoingRef, {
        fromUid: uid,
        toUid: targetUid,
        direction,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const mutual =
        direction === "right" &&
        incoming.exists &&
        incoming.data().direction === "right";

      if (mutual && !existingMatch.exists) {
        tx.set(matchRef, {
          memberUids: sortedUids,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const senderName = senderProfile.exists
          ? senderProfile.data().name
          : "Участник GO";

        tx.set(notificationRefA, {
          recipientUid: targetUid,
          type: "match",
          title: "Новое совпадение!",
          text: `${senderName} тоже заинтересован в совместных активностях`,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.set(notificationRefB, {
          recipientUid: uid,
          type: "match",
          title: "Новое совпадение!",
          text: "Ваш интерес оказался взаимным",
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return Boolean(mutual || existingMatch.exists);
    });

    return {
      success: true,
      matched,
    };
  }
);

// Создание события и добавление создателя в участники.
exports.goCreateEvent = onCall(
  { region: "europe-west1", maxInstances: 20 },
  async (request) => {
    const uid = requireUser(request);
    const data = request.data || {};

    const title = cleanString(data.title, 70);
    const description = cleanString(data.description, 500);
    const category = cleanString(data.category || "Встреча", 30);
    const date = cleanString(data.date, 20);
    const time = cleanString(data.time, 10);
    const place = cleanString(data.place, 100);

    if (!title || !description || !date || !time || !place) {
      throw new HttpsError(
        "invalid-argument",
        "Заполни все поля события"
      );
    }

    const eventRef = db.collection("events").doc();
    const participantRef = eventRef
      .collection("participants")
      .doc(uid);

    const batch = db.batch();

    batch.set(eventRef, {
      title,
      description,
      category,
      date,
      time,
      place,
      createdBy: uid,
      participantCount: 1,
      capacity: 30,
      status: "published",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    batch.set(participantRef, {
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      success: true,
      eventId: eventRef.id,
    };
  }
);

// Присоединение к событию.
exports.goJoinEvent = onCall(
  { region: "europe-west1", maxInstances: 30 },
  async (request) => {
    const uid = requireUser(request);
    const eventId = cleanString(request.data?.eventId, 150);

    if (!eventId) {
      throw new HttpsError(
        "invalid-argument",
        "Не указано событие"
      );
    }

    const eventRef = db.collection("events").doc(eventId);
    const participantRef = eventRef
      .collection("participants")
      .doc(uid);

    const joined = await db.runTransaction(async (tx) => {
      const [eventSnap, participantSnap] = await Promise.all([
        tx.get(eventRef),
        tx.get(participantRef),
      ]);

      if (
        !eventSnap.exists ||
        eventSnap.data().status !== "published"
      ) {
        throw new HttpsError(
          "not-found",
          "Событие не найдено"
        );
      }

      if (participantSnap.exists) return false;

      const event = eventSnap.data();
      const count = Number(event.participantCount || 0);
      const capacity = Number(event.capacity || 30);

      if (count >= capacity) {
        throw new HttpsError(
          "failed-precondition",
          "Свободных мест больше нет"
        );
      }

      tx.set(participantRef, {
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
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
  }
);

// Вступление в сообщество или выход из него.
exports.goToggleClub = onCall(
  { region: "europe-west1", maxInstances: 20 },
  async (request) => {
    const uid = requireUser(request);
    const clubId = cleanString(request.data?.clubId, 30);

    if (!CLUB_IDS.includes(clubId)) {
      throw new HttpsError(
        "invalid-argument",
        "Сообщество не найдено"
      );
    }

    const memberRef = db.collection("clubs")
      .doc(clubId)
      .collection("members")
      .doc(uid);

    const joined = await db.runTransaction(async (tx) => {
      const memberSnap = await tx.get(memberRef);

      if (memberSnap.exists) {
        tx.delete(memberRef);
        return false;
      }

      tx.set(memberRef, {
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return true;
    });

    return { joined };
  }
);

// Отметка уведомлений как прочитанных.
exports.goMarkNotificationsRead = onCall(
  { region: "europe-west1", maxInstances: 20 },
  async (request) => {
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

    if (ids.length === 0) {
      return {
        success: true,
        updated: 0,
      };
    }

    const refs = ids.map((id) =>
      db.collection("notifications").doc(id)
    );

    const updated = await db.runTransaction(async (tx) => {
      const snapshots = await Promise.all(
        refs.map((ref) => tx.get(ref))
      );

      let count = 0;

      snapshots.forEach((snap) => {
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
  }
);