/**
 * גלגל המזל של כיתה ה׳ – שרת (Google Apps Script)
 * הנתונים נשמרים בגיליון גוגל שנוצר אוטומטית בהפעלה הראשונה של setup().
 * האתר (GitHub Pages) פונה לכאן ב-POST עם JSON.
 */

var TZ = 'Asia/Jerusalem';

var SCHEMA = {
  students: ['id:s', 'name:s', 'display:s', 'codeHash:s', 'activeOverride:s', 'createdAt:s'],
  weeks: ['weekId:s', 'openDate:s', 'expireDate:s', 'fileName:s', 'openedAt:s', 'settingsJson:s'],
  alloc: ['key:s', 'weekId:s', 'studentId:s', 'positive:n', 'negative:n', 'net:n', 'prevNet:s', 'inReport:b',
          'autoActive:b', 'baseSpins:n', 'bonus:n', 'manualAdj:n', 'extra:n', 'used:n', 'unlocked:b'],
  wins: ['winId:s', 'weekId:s', 'studentId:s', 'prizeId:s', 'prizeName:s', 'emoji:s', 'wonAt:s', 'redeemedAt:s', 'kind:s'],
  prizes: ['id:s', 'emoji:s', 'short:s', 'name:s', 'weight:n', 'active:b', 'extraSpin:b', 'order:n']
};

var SHEET_TITLES = { students: 'תלמידים', weeks: 'שבועות', alloc: 'סיבובים', wins: 'זכיות', prizes: 'פרסים' };

var DEFAULT_SETTINGS = {
  pointsPerSpin: 5,
  bonusThreshold: 5,
  bonusSpins: 1,
  tiers: [{ n: 1, pct: 50 }, { n: 2, pct: 30 }, { n: 3, pct: 20 }],
  redeemDays: [0, 2, 3, 4, 5]
};

var DEFAULT_PRIZES = [
  ['🪑', 'מקום ישיבה', 'לבחור מקום ישיבה ליום אחד', 1, false],
  ['👫', 'ליד חבר/ה', 'לשבת ליד חבר/ה בשיעור אחד', 1, false],
  ['👑', 'כיסא המורה', 'לשבת על כיסא המורה בשיעור אחד', 1, false],
  ['🛋️', 'כרית או רצפה', 'לשבת על כרית או על הרצפה בשיעור אחד', 1, false],
  ['🎵', 'שיר לכיתה', 'כרטיס בחירת שיר לכיתה', 1, false],
  ['🎧', 'די־ג׳יי בהפסקה', 'DJ של הפסקת האוכל – אוסף/ת בקשות שירים ובוחר/ת שיר', 1, false],
  ['✍️', 'משפט היום', 'לכתוב את "המשפט של היום" על הלוח', 1, false],
  ['🎤', 'הופעה קטנה', 'ריקוד, בדיחה או סיפור מול הכיתה', 1, false],
  ['🗣️', 'מציג/ה לכיתה', 'להציג משהו לכיתה ב-5 דקות', 1, false],
  ['📺', 'סרטון בוקר', 'לבחור סרטון קצר לפתיחת הבוקר', 1, false],
  ['🎲', 'בוחר/ת משחק', 'לבחור משחק לכל הכיתה בשיעור חינוך', 1, false],
  ['🏃', 'ראשון/ה להפסקה', 'לצאת ראשון/ה להפסקה', 1, false],
  ['⭐', 'כוכב/ת השבוע', 'תג "כוכב/ת השבוע"', 1, false],
  ['💌', 'הודעה להורים', 'הודעה משמחת להורים', 1, false],
  ['🔄', 'החלפת מקום', 'קלף "החלפת מקום לשבוע"', 0.4, false],
  ['🎰', 'סיבוב כפול', 'סיבוב כפול – מקבלים עוד סיבוב!', 0.4, true]
];

var DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/* ======================= Entry points ======================= */

function setup() {
  ensureAll_();
  Logger.log('הגיליון מוכן: ' + ss_().getUrl());
}

function doGet() {
  return json_({ ok: true, app: 'class-wheel', time: nowIso_() });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, data: route_(req) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  ensureAll_();
  var a = req.action;
  var pub = { roster: apiRoster_, login: apiLogin_, setCode: apiSetCode_, tLogin: apiTeacherLogin_ };
  if (pub[a]) return pub[a](req);

  var kid = { me: apiMe_, spin: apiSpin_ };
  if (kid[a]) return kid[a](req, session_(req.token, 'kid'));

  var teacher = {
    tState: apiTState_, tPreview: apiTPreview_, tOpenWeek: apiTOpenWeek_, tRedeem: apiTRedeem_,
    tUnlock: apiTUnlock_, tAdjust: apiTAdjust_, tSetActive: apiTSetActive_, tResetCode: apiTResetCode_,
    tSaveSettings: apiTSaveSettings_, tSavePrizes: apiTSavePrizes_, tChangePassword: apiTChangePassword_
  };
  if (teacher[a]) return teacher[a](req, session_(req.token, 'teacher'));
  throw new Error('פעולה לא מוכרת');
}

/* ======================= Pure logic (tested) ======================= */

function normalizeName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function parseCsvText(text) {
  text = String(text || '').replace(/^﻿/, '');
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; }
      } else { cell += c; }
    } else if (c === '"') { q = true; }
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else { cell += c; }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Returns [{name, positive, negative}] from a ClassDojo report CSV. */
function readDojoReport(text) {
  var rows = parseCsvText(text);
  var h = -1, col = {};
  for (var r = 0; r < rows.length && h < 0; r++) {
    var cells = rows[r].map(function (x) { return String(x).trim().toLowerCase(); });
    if (cells.indexOf('student') >= 0 && cells.indexOf('positive') >= 0) {
      h = r;
      col.name = cells.indexOf('student');
      col.pos = cells.indexOf('positive');
      col.neg = cells.indexOf('needs work');
    }
  }
  if (h < 0) throw new Error('לא מצאתי בקובץ את העמודות Student ו-Positive. ודאו שזה הדוח שיוצא מ-View reports בקלאס דוג׳ו.');
  var out = [];
  for (var k = h + 1; k < rows.length; k++) {
    var name = normalizeName(rows[k][col.name]);
    if (!name) continue;
    var pos = Math.abs(parseFloat(rows[k][col.pos]) || 0);
    var neg = col.neg >= 0 ? Math.abs(parseFloat(rows[k][col.neg]) || 0) : 0;
    out.push({ name: name, positive: pos, negative: neg });
  }
  if (!out.length) throw new Error('בקובץ אין שמות של תלמידים.');
  return out;
}

function makeDisplayNames(names) {
  var first = {};
  names.forEach(function (n) {
    var parts = n.split(' ');
    var d = parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '׳' : n;
    first[n] = d;
  });
  var count = {};
  names.forEach(function (n) { count[first[n]] = (count[first[n]] || 0) + 1; });
  var res = {};
  names.forEach(function (n) { res[n] = count[first[n]] > 1 ? n : first[n]; });
  return res;
}

/**
 * Computes this week's allocation per student.
 * report: [{name, positive, negative}], prevNetById: {id: net}, settings.
 */
function computeAllocations(report, prevNetById, settings) {
  var pps = Math.max(1, Number(settings.pointsPerSpin) || 5);
  return report.map(function (r) {
    var id = normalizeName(r.name);
    var net = r.positive - r.negative;
    var base = Math.floor(Math.max(0, net) / pps);
    var prev = Object.prototype.hasOwnProperty.call(prevNetById, id) ? prevNetById[id] : null;
    var bonus = 0;
    if (prev !== null && net - prev >= Number(settings.bonusThreshold) && Number(settings.bonusThreshold) > 0) {
      bonus = Number(settings.bonusSpins) || 0;
    }
    return {
      studentId: id, positive: r.positive, negative: r.negative, net: net,
      prevNet: prev === null ? '' : String(prev), inReport: true,
      autoActive: (r.positive + r.negative) > 0, baseSpins: base, bonus: bonus
    };
  });
}

function earnedSpins(a) {
  return Math.max(0, (a.baseSpins || 0) + (a.bonus || 0) + (a.manualAdj || 0));
}

function isActive(a, override) {
  if (override === 'yes') return true;
  if (override === 'no') return false;
  return !!a.autoActive;
}

/** Class tiers: tiers must be reached in order (1, 2, 3...). */
function computeClassStatus(allocs, overrides, settings) {
  var active = allocs.filter(function (a) { return isActive(a, overrides[a.studentId]); });
  var nActive = active.length;
  var tiers = (settings.tiers || []).slice().sort(function (x, y) { return x.n - y.n; });
  var classSpins = 0, blocked = false;
  var detail = tiers.map(function (t) {
    var have = active.filter(function (a) { return earnedSpins(a) >= t.n; }).length;
    var pct = nActive ? Math.round((have / nActive) * 1000) / 10 : 0;
    var need = Math.ceil((t.pct / 100) * nActive);
    var reached = nActive > 0 && have >= need && !blocked;
    if (reached) classSpins = t.n; else blocked = true;
    return { n: t.n, pctRequired: t.pct, pct: pct, have: have, need: need, reached: reached };
  });
  return { activeCount: nActive, totalCount: allocs.length, tiers: detail, classSpins: classSpins };
}

function dayOfWeek(ds) { return new Date(ds + 'T12:00:00Z').getUTCDay(); }

function addDays(ds, n) {
  var d = new Date(ds + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Prizes and spins expire on the Friday of the week the report was opened. */
function expireDateFor(openDate) {
  var dow = dayOfWeek(openDate);
  return addDays(openDate, dow <= 5 ? 5 - dow : 6);
}

function spinWindow(alloc, week, today) {
  if (!week) return { ok: false, reason: 'השבוע עוד לא נפתח. המורה יעלה את הנקודות בקרוב.' };
  if (today > week.expireDate) return { ok: false, reason: 'השבוע הזה כבר נגמר. סיבובים חדשים יגיעו כשהמורה יפתח שבוע חדש.' };
  if (today === week.openDate || alloc.unlocked) return { ok: true };
  return { ok: false, reason: 'מסובבים ביום שבו נפתח השבוע. אם לא היית, בקש מהמורה לפתוח לך את הגלגל.' };
}

function pickWeighted(items, r) {
  var sum = items.reduce(function (s, p) { return s + p.weight; }, 0);
  var x = r * sum;
  for (var i = 0; i < items.length; i++) {
    x -= items[i].weight;
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

/* ======================= Storage ======================= */

function props_() { return PropertiesService.getScriptProperties(); }

function ss_() {
  var id = props_().getProperty('sheetId');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ }
  }
  var s = SpreadsheetApp.create('גלגל המזל – נתונים');
  props_().setProperty('sheetId', s.getId());
  return s;
}

var _ssCache = null;
function book_() { return _ssCache || (_ssCache = ss_()); }

function sheet_(name) {
  var b = book_();
  var title = SHEET_TITLES[name];
  var sh = b.getSheetByName(title);
  if (!sh) {
    sh = b.insertSheet(title);
    var cols = SCHEMA[name].map(function (c) { return c.split(':')[0]; });
    sh.getRange(1, 1, 1000, cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function coerce_(v, t) {
  if (t === 'n') { var n = Number(v); return isFinite(n) ? n : 0; }
  if (t === 'b') return v === true || String(v).toLowerCase() === 'true';
  return v === null || v === undefined ? '' : String(v);
}

function readAll_(name) {
  var sh = sheet_(name);
  var vals = sh.getDataRange().getValues();
  var defs = SCHEMA[name].map(function (c) { return c.split(':'); });
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    if (vals[r].join('') === '') continue;
    var o = { _row: r + 1 };
    defs.forEach(function (d, i) { o[d[0]] = coerce_(vals[r][i], d[1]); });
    out.push(o);
  }
  return out;
}

function toRow_(name, obj) {
  return SCHEMA[name].map(function (c) {
    var k = c.split(':')[0];
    var v = obj[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

function append_(name, obj) { sheet_(name).appendRow(toRow_(name, obj)); }

function update_(name, obj) {
  var row = toRow_(name, obj);
  sheet_(name).getRange(obj._row, 1, 1, row.length).setValues([row]);
}

function replaceAll_(name, objs) {
  var sh = sheet_(name);
  var cols = SCHEMA[name].length;
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols).clearContent();
  if (objs.length) {
    sh.getRange(2, 1, objs.length, cols).setNumberFormat('@');
    sh.getRange(2, 1, objs.length, cols).setValues(objs.map(function (o) { return toRow_(name, o); }));
  }
}

function ensureAll_() {
  Object.keys(SCHEMA).forEach(sheet_);
  if (!props_().getProperty('salt')) props_().setProperty('salt', Utilities.getUuid());
  if (!props_().getProperty('settings')) props_().setProperty('settings', JSON.stringify(DEFAULT_SETTINGS));
  if (!props_().getProperty('prizesSeeded')) {
    replaceAll_('prizes', DEFAULT_PRIZES.map(function (p, i) {
      return { id: 'p' + (i + 1), emoji: p[0], short: p[1], name: p[2], weight: p[3], active: true, extraSpin: p[4], order: i + 1 };
    }));
    props_().setProperty('prizesSeeded', '1');
  }
}

function settings_() {
  var s = {};
  try { s = JSON.parse(props_().getProperty('settings') || '{}'); } catch (e) {}
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = s[k] !== undefined ? s[k] : DEFAULT_SETTINGS[k]; });
  return out;
}

function currentWeek_() {
  var id = props_().getProperty('currentWeekId');
  if (!id) return null;
  return readAll_('weeks').filter(function (w) { return w.weekId === id; })[0] || null;
}

function allocFor_(weekId) {
  return readAll_('alloc').filter(function (a) { return a.weekId === weekId; });
}

function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, props_().getProperty('salt') + '|' + s, Utilities.Charset.UTF_8);
  return 'h' + bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ======================= Sessions ======================= */

function newSession_(role, sid) {
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('tok:' + token, JSON.stringify({ role: role, sid: sid || '' }), 21600);
  return token;
}

function session_(token, role) {
  var raw = token ? CacheService.getScriptCache().get('tok:' + token) : null;
  if (!raw) throw new Error('SESSION_EXPIRED');
  var s = JSON.parse(raw);
  if (s.role !== role) throw new Error('SESSION_EXPIRED');
  return s;
}

function checkFails_(key) {
  var n = Number(CacheService.getScriptCache().get('fail:' + key) || 0);
  if (n >= 5) throw new Error('יותר מדי ניסיונות. נסו שוב בעוד 10 דקות, או בקשו מהמורה עזרה.');
}
function addFail_(key) {
  var c = CacheService.getScriptCache();
  c.put('fail:' + key, String(Number(c.get('fail:' + key) || 0) + 1), 600);
}
function clearFails_(key) { CacheService.getScriptCache().remove('fail:' + key); }

/* ======================= Kid API ======================= */

function apiRoster_() {
  var week = currentWeek_();
  var inWeek = {};
  if (week) allocFor_(week.weekId).forEach(function (a) { inWeek[a.studentId] = a.inReport; });
  return {
    students: readAll_('students')
      .filter(function (s) { return !week || inWeek[s.id]; })
      .map(function (s) { return { id: s.id, display: s.display, hasCode: !!s.codeHash }; })
      .sort(function (a, b) { return a.display.localeCompare(b.display, 'he'); })
  };
}

function findStudent_(id) {
  var s = readAll_('students').filter(function (x) { return x.id === id; })[0];
  if (!s) throw new Error('לא מצאתי את השם הזה ברשימה.');
  return s;
}

function validCode_(code) {
  if (!/^\d{4}$/.test(String(code || ''))) throw new Error('הקוד צריך להיות 4 ספרות.');
}

function apiSetCode_(req) {
  validCode_(req.code);
  return withLock_(function () {
    var s = findStudent_(req.studentId);
    if (s.codeHash) throw new Error('כבר יש לך קוד. היכנסו עם הקוד, או בקשו מהמורה לאפס אותו.');
    s.codeHash = hash_('kid|' + s.id + '|' + req.code);
    update_('students', s);
    return { token: newSession_('kid', s.id), display: s.display };
  });
}

function apiLogin_(req) {
  validCode_(req.code);
  checkFails_(req.studentId);
  var s = findStudent_(req.studentId);
  if (!s.codeHash) throw new Error('NO_CODE');
  if (s.codeHash !== hash_('kid|' + s.id + '|' + req.code)) {
    addFail_(req.studentId);
    throw new Error('הקוד לא נכון. נסו שוב.');
  }
  clearFails_(req.studentId);
  return { token: newSession_('kid', s.id), display: s.display };
}

function activePrizes_() {
  return readAll_('prizes').filter(function (p) { return p.active && p.weight > 0; })
    .sort(function (a, b) { return a.order - b.order; })
    .map(function (p) { return { id: p.id, emoji: p.emoji, short: p.short, name: p.name, weight: p.weight, extraSpin: p.extraSpin }; });
}

function classStatusFor_(week) {
  if (!week) return null;
  var overrides = {};
  readAll_('students').forEach(function (s) { overrides[s.id] = s.activeOverride; });
  return computeClassStatus(allocFor_(week.weekId), overrides, settings_());
}

function kidView_(sid) {
  var s = findStudent_(sid);
  var week = currentWeek_();
  var settings = settings_();
  var base = {
    display: s.display,
    prizes: activePrizes_(),
    redeemDays: settings.redeemDays.map(function (d) { return DAY_NAMES[d]; }),
    week: null, spins: null, wins: [], classStatus: null
  };
  if (!week) return base;
  var today = today_();
  var a = allocFor_(week.weekId).filter(function (x) { return x.studentId === sid; })[0];
  base.week = { openDate: week.openDate, expireDate: week.expireDate, expired: today > week.expireDate,
    openDay: DAY_NAMES[dayOfWeek(week.openDate)] };
  base.classStatus = classStatusFor_(week);
  if (!a) {
    base.spins = { earned: 0, used: 0, left: 0, canSpin: false, reason: 'השם שלך לא מופיע בדוח של השבוע.' };
    return base;
  }
  var total = earnedSpins(a) + (a.extra || 0);
  var left = Math.max(0, total - a.used);
  var win = spinWindow(a, week, today);
  base.spins = {
    earned: earnedSpins(a), extra: a.extra || 0, used: a.used, left: left, net: a.net,
    toNext: Math.max(0, settings.pointsPerSpin - (Math.max(0, a.net) % settings.pointsPerSpin)),
    canSpin: left > 0 && win.ok, reason: left > 0 ? (win.reason || '') : ''
  };
  base.wins = today > week.expireDate ? [] : readAll_('wins')
    .filter(function (w) { return w.weekId === week.weekId && w.studentId === sid && w.kind !== 'extra'; })
    .map(function (w) { return { id: w.winId, emoji: w.emoji, name: w.prizeName, redeemed: !!w.redeemedAt }; });
  return base;
}

function apiMe_(req, sess) { return kidView_(sess.sid); }

function apiSpin_(req, sess) {
  return withLock_(function () {
    var week = currentWeek_();
    if (!week) throw new Error('השבוע עוד לא נפתח.');
    var today = today_();
    var a = allocFor_(week.weekId).filter(function (x) { return x.studentId === sess.sid; })[0];
    if (!a) throw new Error('השם שלך לא מופיע בדוח של השבוע.');
    var w = spinWindow(a, week, today);
    if (!w.ok) throw new Error(w.reason);
    var left = earnedSpins(a) + (a.extra || 0) - a.used;
    if (left <= 0) throw new Error('נגמרו לך הסיבובים לשבוע הזה.');
    var prizes = activePrizes_();
    if (!prizes.length) throw new Error('אין פרסים על הגלגל. בקשו מהמורה להוסיף.');
    var r = Math.random();
    var prize = pickWeighted(prizes, r);
    a.used += 1;
    if (prize.extraSpin) a.extra = (a.extra || 0) + 1;
    update_('alloc', a);
    append_('wins', {
      winId: 'win' + Utilities.getUuid().slice(0, 12), weekId: week.weekId, studentId: sess.sid,
      prizeId: prize.id, prizeName: prize.name, emoji: prize.emoji, wonAt: nowIso_(),
      redeemedAt: prize.extraSpin ? nowIso_() : '', kind: prize.extraSpin ? 'extra' : 'prize'
    });
    return { prizeId: prize.id, extraSpin: !!prize.extraSpin, view: kidView_(sess.sid) };
  });
}

/* ======================= Teacher API ======================= */

function apiTeacherLogin_(req) {
  var pw = String(req.password || '');
  if (pw.length < 4) throw new Error('הסיסמה צריכה להיות לפחות 4 תווים.');
  checkFails_('teacher');
  var stored = props_().getProperty('teacherHash');
  if (!stored) {
    props_().setProperty('teacherHash', hash_('teacher|' + pw));
    return { token: newSession_('teacher'), created: true };
  }
  if (stored !== hash_('teacher|' + pw)) { addFail_('teacher'); throw new Error('הסיסמה לא נכונה.'); }
  clearFails_('teacher');
  return { token: newSession_('teacher'), created: false };
}

function apiTChangePassword_(req) {
  var pw = String(req.newPassword || '');
  if (pw.length < 4) throw new Error('הסיסמה צריכה להיות לפחות 4 תווים.');
  props_().setProperty('teacherHash', hash_('teacher|' + pw));
  return { ok: true };
}

function apiTState_() {
  var week = currentWeek_();
  var today = today_();
  var students = readAll_('students');
  var allocs = week ? allocFor_(week.weekId) : [];
  var wins = week ? readAll_('wins').filter(function (w) { return w.weekId === week.weekId && w.kind !== 'extra'; }) : [];
  var byId = {};
  allocs.forEach(function (a) { byId[a.studentId] = a; });
  var settings = settings_();
  var list = students.map(function (s) {
    var a = byId[s.id];
    var earned = a ? earnedSpins(a) : 0;
    var total = a ? earned + (a.extra || 0) : 0;
    return {
      id: s.id, name: s.name, display: s.display, hasCode: !!s.codeHash, activeOverride: s.activeOverride,
      inReport: !!(a && a.inReport),
      active: a ? isActive(a, s.activeOverride) : false,
      positive: a ? a.positive : 0, negative: a ? a.negative : 0, net: a ? a.net : 0,
      prevNet: a ? a.prevNet : '', baseSpins: a ? a.baseSpins : 0, bonus: a ? a.bonus : 0,
      manualAdj: a ? a.manualAdj : 0, extra: a ? a.extra : 0, used: a ? a.used : 0,
      left: Math.max(0, total - (a ? a.used : 0)), unlocked: !!(a && a.unlocked),
      wins: wins.filter(function (w) { return w.studentId === s.id; })
        .map(function (w) { return { id: w.winId, emoji: w.emoji, name: w.prizeName, redeemedAt: w.redeemedAt, wonAt: w.wonAt }; })
    };
  }).filter(function (s) { return !week || byId[s.id]; })
    .sort(function (x, y) { return x.name.localeCompare(y.name, 'he'); });
  return {
    today: today, todayDay: DAY_NAMES[dayOfWeek(today)],
    redeemToday: settings.redeemDays.indexOf(dayOfWeek(today)) >= 0,
    week: week ? { weekId: week.weekId, openDate: week.openDate, expireDate: week.expireDate, fileName: week.fileName,
      expired: today > week.expireDate, openDay: DAY_NAMES[dayOfWeek(week.openDate)] } : null,
    students: list, classStatus: classStatusFor_(week), settings: settings,
    prizes: readAll_('prizes').sort(function (a, b) { return a.order - b.order; })
      .map(function (p) { return { id: p.id, emoji: p.emoji, short: p.short, name: p.name, weight: p.weight, active: p.active, extraSpin: p.extraSpin }; })
  };
}

function prevNetMap_(excludeWeekId) {
  var weeks = readAll_('weeks').filter(function (w) { return w.weekId !== excludeWeekId; })
    .sort(function (a, b) { return a.openedAt < b.openedAt ? -1 : 1; });
  var last = weeks[weeks.length - 1];
  var map = {};
  if (last) allocFor_(last.weekId).forEach(function (a) { if (a.inReport) map[a.studentId] = a.net; });
  return map;
}

function buildWeek_(csv, mode) {
  var report = readDojoReport(csv);
  var cur = currentWeek_();
  var exclude = mode === 'update' && cur ? cur.weekId : null;
  var allocs = computeAllocations(report, prevNetMap_(exclude), settings_());
  return { report: report, allocs: allocs };
}

function apiTPreview_(req) {
  var b = buildWeek_(req.csv, req.mode);
  var overrides = {};
  readAll_('students').forEach(function (s) { overrides[s.id] = s.activeOverride; });
  var today = today_();
  return {
    rows: b.allocs.map(function (a) {
      return { name: a.studentId, positive: a.positive, negative: a.negative, net: a.net, prevNet: a.prevNet,
        baseSpins: a.baseSpins, bonus: a.bonus, autoActive: a.autoActive };
    }),
    classStatus: computeClassStatus(b.allocs.map(function (a) { return Object.assign({ manualAdj: 0 }, a); }), overrides, settings_()),
    openDate: today, expireDate: expireDateFor(today), currentWeek: currentWeek_()
  };
}

function apiTOpenWeek_(req) {
  return withLock_(function () {
    var mode = req.mode === 'update' ? 'update' : 'new';
    var cur = currentWeek_();
    if (mode === 'update' && !cur) mode = 'new';
    var b = buildWeek_(req.csv, mode);
    var today = today_();

    // students
    var students = readAll_('students');
    var known = {};
    students.forEach(function (s) { known[s.id] = s; });
    var allNames = students.map(function (s) { return s.id; });
    b.allocs.forEach(function (a) { if (!known[a.studentId]) allNames.push(a.studentId); });
    var displays = makeDisplayNames(allNames);
    b.allocs.forEach(function (a) {
      if (!known[a.studentId]) {
        var s = { id: a.studentId, name: a.studentId, display: displays[a.studentId], codeHash: '', activeOverride: '', createdAt: nowIso_() };
        append_('students', s);
        known[a.studentId] = s;
      }
    });
    readAll_('students').forEach(function (s) {
      if (s.display !== displays[s.id]) { s.display = displays[s.id]; update_('students', s); }
    });

    var weekId;
    var keep = {};
    if (mode === 'update') {
      weekId = cur.weekId;
      allocFor_(weekId).forEach(function (a) { keep[a.studentId] = a; });
      var cw = readAll_('weeks').filter(function (w) { return w.weekId === weekId; })[0];
      cw.fileName = req.fileName || cw.fileName;
      update_('weeks', cw);
      var others = readAll_('alloc').filter(function (a) { return a.weekId !== weekId; });
      replaceAll_('alloc', others);
    } else {
      weekId = 'w' + today + '-' + Utilities.getUuid().slice(0, 6);
      append_('weeks', { weekId: weekId, openDate: today, expireDate: expireDateFor(today), fileName: req.fileName || '',
        openedAt: nowIso_(), settingsJson: JSON.stringify(settings_()) });
      props_().setProperty('currentWeekId', weekId);
      // new week starts every student with a clean "auto" status
      readAll_('students').forEach(function (s) { if (s.activeOverride) { s.activeOverride = ''; update_('students', s); } });
    }

    var inReport = {};
    var rows = b.allocs.map(function (a) {
      inReport[a.studentId] = true;
      var k = keep[a.studentId] || {};
      return Object.assign({}, a, {
        key: weekId + '|' + a.studentId, weekId: weekId,
        manualAdj: k.manualAdj || 0, extra: k.extra || 0, used: k.used || 0, unlocked: !!k.unlocked
      });
    });
    Object.keys(known).forEach(function (id) {
      if (!inReport[id]) {
        var k = keep[id] || {};
        rows.push({ key: weekId + '|' + id, weekId: weekId, studentId: id, positive: 0, negative: 0, net: 0, prevNet: '',
          inReport: false, autoActive: false, baseSpins: 0, bonus: 0, manualAdj: k.manualAdj || 0, extra: k.extra || 0,
          used: k.used || 0, unlocked: !!k.unlocked });
      }
    });
    var existing = readAll_('alloc');
    replaceAll_('alloc', existing.concat(rows));
    return apiTState_();
  });
}

function allocById_(sid) {
  var week = currentWeek_();
  if (!week) throw new Error('עדיין לא נפתח שבוע.');
  var a = allocFor_(week.weekId).filter(function (x) { return x.studentId === sid; })[0];
  if (!a) throw new Error('התלמיד לא נמצא בשבוע הזה.');
  return a;
}

function apiTRedeem_(req) {
  return withLock_(function () {
    var w = readAll_('wins').filter(function (x) { return x.winId === req.winId; })[0];
    if (!w) throw new Error('הפרס לא נמצא.');
    w.redeemedAt = req.undo ? '' : nowIso_();
    update_('wins', w);
    return apiTState_();
  });
}

function apiTUnlock_(req) {
  return withLock_(function () {
    var a = allocById_(req.studentId);
    a.unlocked = !!req.value;
    update_('alloc', a);
    return apiTState_();
  });
}

function apiTAdjust_(req) {
  return withLock_(function () {
    var a = allocById_(req.studentId);
    a.manualAdj = (a.manualAdj || 0) + (Number(req.delta) || 0);
    update_('alloc', a);
    return apiTState_();
  });
}

function apiTSetActive_(req) {
  return withLock_(function () {
    var s = findStudent_(req.studentId);
    s.activeOverride = req.value === 'yes' || req.value === 'no' ? req.value : '';
    update_('students', s);
    return apiTState_();
  });
}

function apiTResetCode_(req) {
  return withLock_(function () {
    var s = findStudent_(req.studentId);
    s.codeHash = '';
    update_('students', s);
    clearFails_(s.id);
    return apiTState_();
  });
}

function apiTSaveSettings_(req) {
  var s = req.settings || {};
  var clean = {
    pointsPerSpin: Math.max(1, Math.round(Number(s.pointsPerSpin) || 5)),
    bonusThreshold: Math.max(0, Math.round(Number(s.bonusThreshold) || 0)),
    bonusSpins: Math.max(0, Math.round(Number(s.bonusSpins) || 0)),
    tiers: (s.tiers || []).map(function (t) {
      return { n: Math.max(1, Math.round(Number(t.n) || 1)), pct: Math.min(100, Math.max(1, Number(t.pct) || 1)) };
    }).sort(function (a, b) { return a.n - b.n; }),
    redeemDays: (s.redeemDays || []).map(Number).filter(function (d) { return d >= 0 && d <= 6; })
  };
  props_().setProperty('settings', JSON.stringify(clean));
  return apiTState_();
}

function apiTSavePrizes_(req) {
  var list = (req.prizes || []).filter(function (p) { return String(p.name || '').trim(); });
  if (list.filter(function (p) { return p.active !== false; }).length < 2) throw new Error('צריך לפחות שני פרסים פעילים.');
  return withLock_(function () {
    replaceAll_('prizes', list.map(function (p, i) {
      return { id: p.id || ('p' + Utilities.getUuid().slice(0, 8)), emoji: String(p.emoji || '🎁').slice(0, 4),
        short: String(p.short || p.name).slice(0, 18), name: String(p.name).slice(0, 80),
        weight: Math.max(0.05, Number(p.weight) || 1), active: p.active !== false, extraSpin: !!p.extraSpin, order: i + 1 };
    }));
    return apiTState_();
  });
}
