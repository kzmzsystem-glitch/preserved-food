/**
 * 非常食登録アプリ(LIFF) 用 Web API
 *
 * 既存の非常食チェック.gas と同じGASプロジェクトに追加するファイル。
 * ウェブアプリとしてデプロイ(実行:自分 / アクセス:全員)して使う。
 *
 * スクリプトプロパティ(既存: CHANNEL_TOKEN, GROUP_ID に加えて)
 *   LIFF_CHANNEL_ID   LIFFを作成したLINEログインチャネルのチャネルID
 *   ALLOWED_USER_IDS  (任意) 操作を許可するuserIdのカンマ区切り。未設定なら通知グループのメンバーのみ許可
 */

const HJ_LIST_SS_ID = '1A2tly1qrM7SWvGr-xV_NZTjnJc3ulwhQP2-QJKmSouo';
const HJ_LIST_SHEET = 'リスト';
const HJ_CAL_ID = 'hfeab412r3qvejih6ro19tse0c@group.calendar.google.com';

function doGet() {
  return ContentService.createTextOutput('hijoshoku api');
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    hjAuth_(req.accessToken);
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (req.action) {
        case 'lookup': res = hjLookup_(req); break;
        case 'register': res = hjRegister_(req); break;
        case 'consume': res = hjConsume_(req); break;
        default: throw new Error('不正なリクエストです');
      }
    } finally {
      lock.releaseLock();
    }
    res.ok = true;
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 認証 ----------

/** LIFFのアクセストークンを検証し、通知グループのメンバーだけ通す。userIdを返す */
function hjAuth_(token) {
  if (!token) throw new Error('認証情報がありません。LINEから開き直してください');
  var cache = CacheService.getScriptCache();
  var key = 'hjauth_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var cached = cache.get(key);
  if (cached) return cached;

  var p = PropertiesService.getScriptProperties();
  var vres = UrlFetchApp.fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  var v = JSON.parse(vres.getContentText());
  if (vres.getResponseCode() !== 200 || !v.client_id || v.client_id !== p.getProperty('LIFF_CHANNEL_ID')) {
    throw new Error('認証に失敗しました');
  }
  var pres = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (pres.getResponseCode() !== 200) throw new Error('プロフィールを取得できませんでした');
  var userId = JSON.parse(pres.getContentText()).userId;

  var allowed = (p.getProperty('ALLOWED_USER_IDS') || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  var ok = allowed.indexOf(userId) >= 0;
  if (!ok) {
    var mres = UrlFetchApp.fetch(
      'https://api.line.me/v2/bot/group/' + p.getProperty('GROUP_ID') + '/member/' + userId, {
        headers: { Authorization: 'Bearer ' + p.getProperty('CHANNEL_TOKEN') },
        muteHttpExceptions: true });
    ok = mres.getResponseCode() === 200;
  }
  if (!ok) throw new Error('通知グループのメンバーのみ操作できます');
  cache.put(key, userId, 300);
  return userId;
}

// ---------- シート操作 ----------

var HJ_COL_JAN = 4;

function hjSheet_() {
  return SpreadsheetApp.openById(HJ_LIST_SS_ID).getSheetByName(HJ_LIST_SHEET);
}

function hjExpiryStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  return String(v).trim();
}

/** 2行目以降を {row, name, count, expiry, jan} の配列で返す */
function hjRows_(sheet) {
  var n = sheet.getLastRow();
  if (n < 2) return [];
  var vals = sheet.getRange(2, 1, n - 1, HJ_COL_JAN).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    rows.push({
      row: i + 2,
      name: String(vals[i][0]),
      count: Number(vals[i][1]) || 0,
      expiry: hjExpiryStr_(vals[i][2]),
      jan: String(vals[i][3]).trim()
    });
  }
  return rows;
}

function hjCheckJan_(jan) {
  jan = String(jan || '').trim();
  if (!/^\d{8}$|^\d{12,13}$/.test(jan)) throw new Error('JANコードが不正です');
  return jan;
}

function hjCheckQty_(qty) {
  qty = Number(qty);
  if (!isFinite(qty) || qty < 1 || qty > 999 || Math.floor(qty) !== qty) throw new Error('個数は1〜999の整数で入力してください');
  return qty;
}

/** 在庫(count>0)をJANで探す。期限の早い順 */
function hjStockByJan_(rows, jan) {
  return rows.filter(function (r) { return r.jan === jan && r.count > 0; })
    .sort(function (a, b) { return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0; });
}

function hjLookup_(req) {
  var jan = hjCheckJan_(req.jan);
  var rows = hjRows_(hjSheet_());
  var matched = rows.filter(function (r) { return r.jan === jan; });
  var stock = hjStockByJan_(rows, jan);
  var total = stock.reduce(function (s, r) { return s + r.count; }, 0);
  return {
    registered: matched.length > 0,
    name: matched.length ? matched[matched.length - 1].name : '',
    total: total,
    lots: stock.map(function (r) { return { expiry: r.expiry, count: r.count }; })
  };
}

function hjRegister_(req) {
  var jan = hjCheckJan_(req.jan);
  var qty = hjCheckQty_(req.qty);
  var name = String(req.name || '').trim();
  if (!name) throw new Error('商品名を入力してください');
  if (name.length > 100) throw new Error('商品名が長すぎます');
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.expiry || ''));
  if (!m) throw new Error('消費期限を入力してください');
  var expiry = m[1] + '/' + m[2] + '/' + m[3];

  var sheet = hjSheet_();
  var rows = hjRows_(sheet);
  var same = rows.filter(function (r) { return r.jan === jan && r.expiry === expiry && r.count > 0; })[0];
  var total;
  if (same) {
    total = same.count + qty;
    sheet.getRange(same.row, 2).setValue(total);
  } else {
    total = qty;
    var lr = sheet.getLastRow() + 1;
    sheet.getRange(lr, 3).setNumberFormat('@');
    sheet.getRange(lr, HJ_COL_JAN).setNumberFormat('@');
    sheet.getRange(lr, 1, 1, HJ_COL_JAN).setValues([[name, qty, expiry, jan]]);
    sheet.getRange(2, 1, sheet.getLastRow() - 1, HJ_COL_JAN).sort({ column: 3, ascending: true });
  }
  hjSetCalendar_(same ? same.name : name, expiry, total);
  return { name: same ? same.name : name, expiry: expiry, total: total };
}

function hjConsume_(req) {
  var jan = hjCheckJan_(req.jan);
  var qty = hjCheckQty_(req.qty);
  var sheet = hjSheet_();
  var stock = hjStockByJan_(hjRows_(sheet), jan);
  var total = stock.reduce(function (s, r) { return s + r.count; }, 0);
  if (!stock.length) throw new Error('登録されていない商品です');
  if (qty > total) throw new Error('在庫(' + total + '個)より多く消費できません');

  var left = qty;
  for (var i = 0; i < stock.length && left > 0; i++) {
    var r = stock[i];
    var use = Math.min(r.count, left);
    var remain = r.count - use;
    left -= use;
    sheet.getRange(r.row, 2).setValue(remain);
    if (remain === 0) sheet.getRange(r.row, 1).setFontLine('line-through');
    hjSetCalendar_(r.name, r.expiry, remain);
  }
  return { name: stock[0].name, consumed: qty, remaining: total - qty };
}

// ---------- カレンダー ----------

/** 「商品名：N個」の終日予定を作成/更新。N=0なら削除 */
function hjSetCalendar_(name, expiry, count) {
  var cal = CalendarApp.getCalendarById(HJ_CAL_ID);
  var day = Utilities.parseDate(expiry, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  var prefix = name + '：';
  var ev = cal.getEventsForDay(day).filter(function (e) {
    return e.isAllDayEvent() && e.getTitle().indexOf(prefix) === 0;
  })[0];
  if (count <= 0) {
    if (ev) ev.deleteEvent();
    return;
  }
  var title = prefix + count + '個';
  if (ev) ev.setTitle(title);
  else cal.createAllDayEvent(title, day);
}
