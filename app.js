/* ============================================================
   Словарь дня — логика приложения (версия 2)
   База данных: IndexedDB (работает через file:// в Chrome/Safari).
   Данные слов: words-b1.js / words-b2.js (без изменений).
   Старый ключ localStorage 'vocab_app_state_v1' игнорируется.
   ============================================================ */
(function () {
  "use strict";

  var WORDS_PER_DAY = 10;
  var DB_NAME = "vocab_app_db";
  var DB_VERSION = 1;

  var LISTS = [
    { id: "b1", label: "B1", words: window.WORDS_B1 || [] },
    { id: "b2", label: "B2", words: window.WORDS_B2 || [] },
    { id: "c1", label: "C1", words: window.WORDS_C1 || [] }
  ];

  var POS_LABELS = {
    n: "сущ.", v: "гл.", adj: "прил.", adv: "нар.",
    prep: "предл.", conj: "союз", pron: "местоим.",
    det: "опред.", num: "числит."
  };

  var db = null;          // IndexedDB
  var session = null;     // сессия текущего дня (из базы)
  var today = todayString();
  var busy = true;        // защита от двойных кликов (сначала — пока идёт загрузка)

  // ============================================================
  // Утилиты
  // ============================================================

  function todayString() {
    // отладочный режим: ключ 'vocab_debug_date' = "YYYY-MM-DD"
    try {
      var dbg = localStorage.getItem("vocab_debug_date");
      if (dbg && /^\d{4}-\d{2}-\d{2}$/.test(dbg.trim())) return dbg.trim();
    } catch (e) { /* приватный режим */ }

    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function formatDateRu(iso) {
    try {
      var parts = iso.split("-").map(Number);
      var d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    } catch (e) { return iso; }
  }

  function $(id) { return document.getElementById(id); }

  function posLabel(pos) { return POS_LABELS[pos] || pos; }

  function wordId(en, pos) { return en + "|" + pos; }

  function parseWordId(id) {
    var i = id.indexOf("|");
    return { en: id.slice(0, i), pos: id.slice(i + 1) };
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3800);
  }

  // ============================================================
  // IndexedDB
  // ============================================================

  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function openDB() {
    // соединение уже открыто — не дублируем
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("words")) {
          var ws = d.createObjectStore("words", { keyPath: "id" });
          ws.createIndex("level-status", ["level", "status"]);
          ws.createIndex("status", "status");
        }
        if (!d.objectStoreNames.contains("sessions")) {
          d.createObjectStore("sessions", { keyPath: "date" });
        }
      };
      req.onsuccess = function () {
        db = req.result;
        // чтобы из консоли работал indexedDB.deleteDatabase():
        // закрываем соединение при запросе смены версии
        db.onversionchange = function () {
          db.close();
          db = null;
        };
        resolve(db);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB: открытие заблокировано другим соединением")); };
    });
  }

  // ленивое открытие: если соединение закрыто (например, после onversionchange),
  // открываем его заново перед операцией
  function ensureDB() { return db ? Promise.resolve(db) : openDB(); }

  function getWord(id) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readonly").objectStore("words").get(id));
    });
  }
  function putWord(w) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readwrite").objectStore("words").put(w));
    });
  }
  function getSession(date) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("sessions", "readonly").objectStore("sessions").get(date));
    });
  }
  function putSession(s) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("sessions", "readwrite").objectStore("sessions").put(s));
    });
  }
  function deleteSession(date) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("sessions", "readwrite").objectStore("sessions").delete(date));
    });
  }
  function getAllSessions() {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("sessions", "readonly").objectStore("sessions").getAll());
    });
  }

  function countLevelStatus(level, status) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readonly").objectStore("words").index("level-status").count([level, status]));
    });
  }

  function getWordsByStatus(status) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readonly").objectStore("words").index("status").getAll(status));
    });
  }

  function getNewWords(level) {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readonly").objectStore("words").index("level-status").getAll([level, "new"]));
    });
  }

  // Наполнение базы при каждом запуске: ДОБАВЛЯЕМ отсутствующие слова
  // из всех трёх списков со статусом 'new', существующие записи и их
  // статусы не трогаем. Так у пользователей со старой базой появляются
  // слова нового уровня без сброса прогресса. Схему и версию БД не меняем.
  function seedIfNeeded() {
    var listTotal = LISTS.reduce(function (sum, l) { return sum + l.words.length; }, 0);
    if (listTotal === 0) {
      // пустые данные ≠ «всё пройдено»: файлы слов не загрузились
      throw new Error("Списки слов пусты — файлы words-b1.js / words-b2.js / words-c1.js не загрузились");
    }
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readonly").objectStore("words").getAllKeys()).then(function (keys) {
        var existing = {};
        keys.forEach(function (k) { existing[k] = 1; });
        var missing = [];
        LISTS.forEach(function (list) {
          list.words.forEach(function (w) {
            var id = wordId(w[0], w[1]);
            if (!existing[id]) missing.push({ w: w, level: list.id, id: id });
          });
        });
        if (!missing.length) return;
        var tx = d.transaction("words", "readwrite");
        var store = tx.objectStore("words");
        missing.forEach(function (m) {
          store.put({
            id: m.id,
            en: m.w[0],
            pos: m.w[1],
            ru: m.w[2],
            level: m.level,
            status: "new",
            firstShown: null,
            learnedAt: null,
            reviews: 0
          });
        });
        return new Promise(function (resolve, reject) {
          tx.oncomplete = resolve;
          tx.onerror = function () { reject(tx.error); };
        });
      });
    });
  }

  // слова со статусом 'learning', оставшиеся от незавершённого прошлого дня,
  // возвращаем в пул 'new', чтобы они не потерялись и не возникало путаницы
  function resetLeftoverLearning() {
    return getWordsByStatus("learning").then(function (list) {
      return list.reduce(function (chain, w) {
        return chain.then(function () {
          w.status = "new";
          return putWord(w);
        });
      }, Promise.resolve());
    });
  }

  // незавершённые сессии за ДРУГИЕ даты удаляем перед сбросом 'learning',
  // чтобы слово не могло оказаться в двух активных сессиях одновременно
  function purgeStaleSessions() {
    return getAllSessions().then(function (all) {
      return all.reduce(function (chain, s) {
        if (!s || s.date === today || s.phase === "done") return chain;
        return chain.then(function () { return deleteSession(s.date); });
      }, Promise.resolve());
    });
  }

  // сверяем восстановленную сессию с БД: слова, ставшие 'learned'
  // (например, в другой сессии при манипуляциях с отладочной датой),
  // исключаются из всех очередей с пересчётом счётчиков раундов
  function sanitizeSession(saved) {
    // завершённые сессии не трогаем: их слова давно 'learned', а daySet
    // и счётчики (statToday/knownCount) нужны для экрана истории
    if (saved.phase === "done") return Promise.resolve(saved);
    var fields = ["daySet", "sortQueue", "cardQueue", "checkQueue", "checkFailed", "checkTarget"];
    var seen = {};
    fields.forEach(function (k) {
      (saved[k] || []).forEach(function (id) { seen[id] = 1; });
    });
    var learned = {};
    return Object.keys(seen).reduce(function (chain, id) {
      return chain.then(function () { return getWord(id); }).then(function (w) {
        if (w && w.status === "learned") learned[id] = 1;
      });
    }, Promise.resolve()).then(function () {
      if (!Object.keys(learned).length) return saved;
      fields.forEach(function (k) {
        saved[k] = (saved[k] || []).filter(function (id) { return !learned[id]; });
      });
      if (saved.phase === "cards") {
        saved.cardsDoneCount = 0;
        saved.cardRoundTotal = saved.cardQueue.length;
        saved.checkTarget = saved.cardQueue.slice();
      }
      if (saved.phase === "check") {
        saved.checkRoundTotal = saved.checkQueue.length;
      }
      saved.lastPresented = null;
      return putSession(saved).then(function () { return saved; });
    });
  }

  // ============================================================
  // Экраны
  // ============================================================

  var SCREENS = ["screen-loading", "screen-sort", "screen-cards", "screen-check", "screen-done", "screen-congrats", "screen-history"];

  function showScreen(id) {
    SCREENS.forEach(function (s) { $(s).hidden = (s !== id); });
    window.scrollTo(0, 0);
  }

  // ============================================================
  // Шапка
  // ============================================================

  function levelLabel(id) {
    var label = null;
    LISTS.forEach(function (l) { if (l.id === id) label = l.label; });
    return label;
  }

  function currentLevelLabel() {
    if (session) return levelLabel(session.level) || LISTS[0].label;
    return LISTS[0].label;
  }

  function updateTopbar() {
    $("streak-badge").textContent = currentLevelLabel();
    return refreshLearnedBadge();
  }

  // лёгкое обновление бейджа «выучено»: один подсчёт по индексу статуса.
  // Вызывается при загрузке и сразу после каждого действия,
  // переводящего слово в статус 'learned'
  function refreshLearnedBadge() {
    return ensureDB().then(function (d) {
      return idbReq(d.transaction("words", "readonly").objectStore("words").index("status").count("learned"));
    }).then(function (n) {
      $("learned-badge").textContent = n;
    });
  }

  // ============================================================
  // Загрузка и маршрутизация
  // ============================================================

  function boot() {
    return openDB()
      .then(seedIfNeeded)
      .then(function () { return getSession(today); })
      .then(function (saved) {
        if (saved && saved.date === today) {
          return sanitizeSession(saved).then(function (clean) {
            session = clean;
            if (session.phase === "sort") return enterSort();
            if (session.phase === "cards") {
              showScreen("screen-cards");
              $("cards-date").textContent = formatDateRu(today);
              return nextCard();
            }
            if (session.phase === "check") {
              showScreen("screen-check");
              $("check-date").textContent = formatDateRu(today);
              return presentCheck();
            }
            return showDone(false); // phase === 'done'
          });
        }
        return startNewDay();
      })
      .then(updateTopbar);
  }

  function startNewDay() {
    // сначала убираем незавершённые сессии за другие даты,
    // затем остатки 'learning' возвращаем в пул
    return purgeStaleSessions()
      .then(resetLeftoverLearning)
      .then(function () {
        // цепочка уровней (сейчас B1 → B2 → C1): берём первый уровень,
        // на котором ещё остались слова со статусом 'new'; логика
        // обобщена на любое число списков в LISTS
        return LISTS.reduce(function (chain, list) {
          return chain.then(function (found) {
            if (found) return found;
            return countLevelStatus(list.id, "new").then(function (n) {
              return n > 0 ? list.id : null;
            });
          });
        }, Promise.resolve(null));
      })
      .then(function (level) {
        if (!level) return showCongrats();
        return getNewWords(level).then(function (pool) {
          // случайный набор дня из ещё не изученных слов текущего уровня
          var picked = shuffle(pool).slice(0, WORDS_PER_DAY).map(function (w) { return w.id; });
          session = {
            date: today,
            level: level,
            daySet: picked.slice(),        // слова на изучение (уточняется при сортировке)
            sortQueue: shuffle(picked),    // порядок сортировки — случайный
            phase: "sort",
            cardQueue: [],
            cardRoundTotal: 0,
            cardsDoneCount: 0,
            checkQueue: [],
            checkRoundTotal: 0,
            checkFailed: [],
            knownCount: 0,
            statToday: 0,
            lastPresented: null
          };
          return putSession(session).then(enterSort);
        });
      });
  }

  // добор: после ответа «Знаю» добавляем случайное слово со статусом 'new'
  // того же уровня, чтобы в итоге набралось 10 незнакомых слов на изучение.
  // Если пул исчерпан — работаем с тем, что осталось.
  function refillSortQueue() {
    if (session.daySet.length >= WORDS_PER_DAY) return Promise.resolve();
    return getNewWords(session.level).then(function (pool) {
      var candidates = pool.filter(function (w) {
        return session.daySet.indexOf(w.id) === -1 &&
               session.sortQueue.indexOf(w.id) === -1;
      });
      if (!candidates.length) return;
      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      session.daySet.push(pick.id);
      session.sortQueue.unshift(pick.id); // показать его следующим
    });
  }

  // ============================================================
  // Фаза 1: сортировка
  // ============================================================

  function enterSort() {
    showScreen("screen-sort");
    $("sort-date").textContent = formatDateRu(today);
    return renderSortWord();
  }

  function renderSortWord() {
    if (!session.sortQueue.length) return afterSort();
    var parsed = parseWordId(session.sortQueue[0]);
    $("sort-word").textContent = parsed.en;
    $("sort-pos").textContent = posLabel(parsed.pos);
    $("sort-count").textContent = session.daySet.length;

    var card = $("sort-card");
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
    return Promise.resolve();
  }

  function answerSort(know) {
    var id = session.sortQueue.shift();
    return getWord(id).then(function (w) {
      if (!w) throw new Error("слово не найдено в базе: " + id);
      w.firstShown = w.firstShown || today;
      w.reviews = (w.reviews || 0) + 1;
      if (know) {
        w.status = "learned";
        w.learnedAt = today;
        session.knownCount++;
        session.daySet = session.daySet.filter(function (x) { return x !== id; });
      } else {
        w.status = "learning";
      }
      return putWord(w);
    }).then(function () {
      // слово стало 'learned' — бейдж обновляем сразу
      if (know) return refreshLearnedBadge();
    }).then(function () {
      // добор: ответ «Знаю» уменьшает набор дня — добавляем замену из пула 'new'
      var topUp = know ? refillSortQueue() : Promise.resolve();
      return topUp.then(function () {
        if (session.sortQueue.length === 0) return afterSort();
        // обновлённые daySet/sortQueue сохраняются в сессию и переживают перезагрузку
        return putSession(session).then(renderSortWord);
      });
    });
  }

  function afterSort() {
    if (session.daySet.length === 0) {
      // все слова дня оказались знакомыми
      session.phase = "done";
      session.statToday = session.knownCount;
      return putSession(session).then(function () { return showDone(true); });
    }
    return startCards(shuffle(session.daySet));
  }

  // ============================================================
  // Фаза 2: карточки
  // ============================================================

  function startCards(ids) {
    session.phase = "cards";
    session.cardQueue = ids.slice();
    session.cardRoundTotal = ids.length;
    session.cardsDoneCount = 0;
    session.checkTarget = ids.slice(); // кого проверять после этого раунда карточек
    session.lastPresented = null;      // новая фаза/раунд — первый показ считается заново
    return putSession(session).then(function () {
      showScreen("screen-cards");
      $("cards-date").textContent = formatDateRu(today);
      return nextCard();
    });
  }

  function renderDots() {
    var dots = $("cards-dots");
    while (dots.firstChild) dots.removeChild(dots.firstChild);
    var total = session.cardRoundTotal;
    var done = session.cardsDoneCount;
    for (var i = 0; i < total; i++) {
      var d = document.createElement("span");
      d.className = "dot" + (i < done ? " done" : (i === done ? " active" : ""));
      dots.appendChild(d);
    }
  }

  function nextCard() {
    if (session.cardQueue.length === 0) {
      // все карточки раунда отработаны — проверка по этому же набору
      return startCheck(session.checkTarget.slice());
    }
    var id = session.cardQueue[0];
    return getWord(id).then(function (w) {
      if (!w) throw new Error("слово не найдено в базе: " + id);
      // повторный показ той же карточки (перезагрузка посреди слова)
      // не должен снова накручивать reviews
      if (session.lastPresented === id) return w;
      w.reviews = (w.reviews || 0) + 1;
      session.lastPresented = id;
      return Promise.all([putWord(w), putSession(session)]).then(function () { return w; });
    }).then(function (w) {
      var parsed = parseWordId(id);
      $("flip-inner").classList.remove("flipped");
      $("card-actions").hidden = true;
      $("card-word").textContent = parsed.en;
      $("card-word-back").textContent = parsed.en + " (" + posLabel(parsed.pos) + ")";
      $("card-pos").textContent = posLabel(parsed.pos);
      $("card-ru").textContent = w.ru;
      renderDots();
    });
  }

  function flipCard() {
    var flipped = $("flip-inner").classList.toggle("flipped");
    $("card-actions").hidden = !flipped;
    return Promise.resolve();
  }

  function cardKnown() {
    session.cardQueue.shift();
    session.cardsDoneCount++;
    session.lastPresented = null; // следующее слово — новый показ
    return putSession(session).then(nextCard);
  }

  function cardRepeat() {
    var id = session.cardQueue.shift();
    session.cardQueue.push(id); // возвращаем в конец очереди
    session.lastPresented = null; // следующее слово — новый показ
    return putSession(session).then(nextCard);
  }

  // ============================================================
  // Фаза 3: финальная проверка («Помнишь перевод?»)
  // ============================================================

  function startCheck(ids) {
    session.phase = "check";
    session.checkQueue = ids.slice();
    session.checkRoundTotal = ids.length;
    session.checkFailed = [];
    session.lastPresented = null; // новая фаза — первый показ считается заново
    return putSession(session).then(function () {
      showScreen("screen-check");
      $("check-date").textContent = formatDateRu(today);
      return presentCheck();
    });
  }

  function presentCheck() {
    if (session.checkQueue.length === 0) {
      if (session.checkFailed.length === 0) {
        return finalize(); // чистая проверка — день завершён
      }
      // проваленные слова возвращаются в карточки на доучивание
      return startCards(shuffle(session.checkFailed));
    }
    var id = session.checkQueue[0];
    var parsed = parseWordId(id);
    var shown = session.checkRoundTotal - session.checkQueue.length + 1;
    $("check-word").textContent = parsed.en;
    $("check-pos").textContent = posLabel(parsed.pos);
    $("check-count").textContent = shown;
    $("check-total").textContent = session.checkRoundTotal;

    var card = $("check-card");
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";

    return getWord(id).then(function (w) {
      if (!w) return;
      // перезагрузка посреди того же слова не должна накручивать reviews повторно
      if (session.lastPresented === id) return;
      w.reviews = (w.reviews || 0) + 1;
      session.lastPresented = id;
      return Promise.all([putWord(w), putSession(session)]);
    });
  }

  function answerCheck(yes) {
    var id = session.checkQueue.shift();
    if (!yes) session.checkFailed.push(id);
    session.lastPresented = null; // следующее слово — новый показ
    return putSession(session).then(presentCheck);
  }

  // ============================================================
  // Завершение дня
  // ============================================================

  function finalize() {
    // все слова набора дня, прошедшие проверку, становятся 'learned'
    return session.daySet.reduce(function (chain, id) {
      return chain.then(function () { return getWord(id); }).then(function (w) {
        if (!w) return;
        w.status = "learned";
        w.learnedAt = today;
        return putWord(w);
      });
    }, Promise.resolve()).then(function () {
      session.phase = "done";
      session.statToday = session.knownCount + session.daySet.length;
      return putSession(session);
    }).then(function () {
      // слова дня стали 'learned' — бейдж обновляем сразу
      return refreshLearnedBadge();
    }).then(function () {
      return showDone(true);
    });
  }

  function showDone(fresh) {
    showScreen("screen-done");
    $("done-date").textContent = formatDateRu(today);
    $("done-title").textContent = fresh
      ? "Готово на сегодня!"
      : "На сегодня всё сделано!";
    $("done-lead").textContent = fresh
      ? "Отличная работа. Возвращайтесь завтра — новые слова появятся после полуночи."
      : "Сессия этого дня уже завершена. Возвращайтесь завтра — новые слова появятся после полуночи.";

    $("stat-today").textContent = session.statToday;
    $("stat-known").textContent = session.knownCount;

    // статистика по каждому уровню (обобщено на любое число списков)
    return Promise.all(LISTS.map(function (l) {
      return Promise.all([
        countLevelStatus(l.id, "learned"),
        countLevelStatus(l.id, "new")
      ]);
    })).then(function (counts) {
      var totalLearned = 0;
      var activeLevel = null;
      counts.forEach(function (c, i) {
        totalLearned += c[0];
        if (!activeLevel && c[1] > 0) activeLevel = LISTS[i].label;
      });
      $("stat-total").textContent = totalLearned;
      $("stat-level").textContent = activeLevel || LISTS[LISTS.length - 1].label;

      counts.forEach(function (c, i) {
        var learned = c[0];
        var total = LISTS[i].words.length;
        $("lp" + (i + 1) + "-nums").textContent = learned + " / " + total;
        var bar = $("lp" + (i + 1) + "-bar");
        requestAnimationFrame(function () {
          bar.style.width = (total ? Math.round(learned / total * 100) : 100) + "%";
        });
      });
    });
  }

  function showCongrats() {
    showScreen("screen-congrats");
    return Promise.all(LISTS.map(function (l) {
      return countLevelStatus(l.id, "learned");
    })).then(function (counts) {
      $("stat-total-final").textContent = counts.reduce(function (sum, n) { return sum + n; }, 0);
    });
  }

  // ============================================================
  // История прошедших дней
  // ============================================================

  function renderHistory() {
    showScreen("screen-history");
    var list = $("history-list");
    while (list.firstChild) list.removeChild(list.firstChild);
    return getAllSessions().then(function (all) {
      // показываем только завершённые дни, новые — сверху
      var days = all.filter(function (s) { return s && s.phase === "done"; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });

      if (!days.length) {
        var empty = document.createElement("p");
        empty.className = "lead history-empty";
        empty.textContent =
          "Истории пока нет. Завершите первый день занятий — и здесь появится список выученных слов.";
        list.appendChild(empty);
        return;
      }

      $("history-total").textContent = days.length;
      return days.reduce(function (chain, s) {
        return chain.then(function () { return buildHistoryDay(list, s); });
      }, Promise.resolve());
    });
  }

  function buildHistoryDay(list, s) {
    var day = document.createElement("article");
    day.className = "history-day";

    var head = document.createElement("div");
    head.className = "history-day-head";

    var date = document.createElement("h2");
    date.className = "history-day-date";
    date.textContent = formatDateRu(s.date);

    var level = document.createElement("span");
    level.className = "pos-chip history-level";
    level.textContent = levelLabel(s.level) || s.level;

    head.appendChild(date);
    head.appendChild(level);
    day.appendChild(head);

    var stats = document.createElement("p");
    stats.className = "history-day-stats";
    stats.textContent = "выучено: " + (s.statToday || 0) +
      " · знали сразу: " + (s.knownCount || 0);
    day.appendChild(stats);

    var ul = document.createElement("ul");
    ul.className = "history-words";
    return (s.daySet || []).reduce(function (chain, id) {
      return chain.then(function () { return getWord(id); }).then(function (w) {
        var li = document.createElement("li");
        li.className = "history-word";
        if (w) {
          var b = document.createElement("b");
          b.textContent = w.en + " (" + posLabel(w.pos) + ")";
          li.appendChild(b);
          li.appendChild(document.createTextNode(" — " + w.ru));
        } else {
          li.textContent = parseWordId(id).en;
        }
        ul.appendChild(li);
      });
    }, Promise.resolve()).then(function () {
      day.appendChild(ul);
      list.appendChild(day);
    });
  }

  // возврат с истории — на текущий экран по фазе сессии
  // (та же логика восстановления, что в boot())
  function historyBack() {
    if (!session || session.phase === "sort") return enterSort();
    if (session.phase === "cards") {
      showScreen("screen-cards");
      $("cards-date").textContent = formatDateRu(today);
      return nextCard();
    }
    if (session.phase === "check") {
      showScreen("screen-check");
      $("check-date").textContent = formatDateRu(today);
      return presentCheck();
    }
    return showDone(false);
  }

  // ============================================================
  // Защита от двойных кликов
  // ============================================================

  var actionButtons = [];

  function setActionsDisabled(dis) {
    actionButtons.forEach(function (b) { b.disabled = dis; });
  }

  // оборачивает обработчик: пока идёт обработка, повторные клики игнорируются,
  // а все кнопки действий визуально заблокированы
  function lock(fn) {
    return function () {
      if (busy) return;
      busy = true;
      setActionsDisabled(true);
      Promise.resolve()
        .then(fn)
        .catch(function (err) {
          console.error(err);
          toast("Что-то пошло не так: " + ((err && err.message) || err));
        })
        .then(function () {
          busy = false;
          setActionsDisabled(false);
        });
    };
  }

  // ============================================================
  // Старт
  // ============================================================

  actionButtons = [
    $("btn-know"), $("btn-dont-know"),
    $("flip-card"), $("btn-known-card"), $("btn-repeat"),
    $("btn-check-yes"), $("btn-check-no"),
    $("btn-history-done"), $("btn-history-back")
  ];
  setActionsDisabled(true);

  $("btn-know").addEventListener("click", lock(function () { return answerSort(true); }));
  $("btn-dont-know").addEventListener("click", lock(function () { return answerSort(false); }));
  $("flip-card").addEventListener("click", lock(flipCard));
  $("btn-known-card").addEventListener("click", lock(cardKnown));
  $("btn-repeat").addEventListener("click", lock(cardRepeat));
  $("btn-check-yes").addEventListener("click", lock(function () { return answerCheck(true); }));
  $("btn-check-no").addEventListener("click", lock(function () { return answerCheck(false); }));
  $("btn-history-done").addEventListener("click", lock(renderHistory));
  $("btn-history-back").addEventListener("click", lock(historyBack));

  boot()
    .then(function () {
      // снимаем блокировку только по успешному завершению загрузки
      busy = false;
      setActionsDisabled(false);
    })
    .catch(function (err) {
      console.error(err);
      // ошибка могла случиться после переключения экрана (например, при
      // восстановлении фазы 'cards') — возвращаемся на экран загрузки,
      // чтобы сообщение было видно; кнопки остаются заблокированными
      showScreen("screen-loading");
      $("loading-text").textContent =
        "Ошибка запуска: " + ((err && err.message) || err);
    });
})();
