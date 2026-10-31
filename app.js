(function () {
  'use strict';
  var CFG = window.HJ_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['scanView', 'buyView', 'useView', 'doneView', 'errView'];

  var mode = 'buy';
  var handling = false;
  var currentJan = '';
  var useTotal = 0;

  function show(id) {
    VIEWS.forEach(function (v) { $(v).classList.toggle('hidden', v !== id); });
    window.scrollTo(0, 0);
  }

  function fail(text) {
    stopScan();
    $('errText').textContent = text;
    show('errView');
  }

  // ---------- API ----------

  function api(action, data) {
    var body = Object.assign({ action: action, accessToken: liff.getAccessToken() }, data);
    return fetch(CFG.GAS_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || '通信に失敗しました');
        return j;
      });
  }

  function fetchOff(jan) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 6000);
    var url = 'https://world.openfoodfacts.org/api/v2/product/' + jan +
      '.json?fields=product_name,product_name_ja,brands';
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status !== 1 || !j.product) return '';
        var p = j.product;
        var n = String(p.product_name_ja || p.product_name || '').trim();
        if (!n) return '';
        var b = String(p.brands || '').split(',')[0].trim();
        return b && n.indexOf(b) < 0 ? b + ' ' + n : n;
      })
      .catch(function () { return ''; })
      .then(function (n) { clearTimeout(timer); return n; });
  }

  // ---------- JAN ----------

  function validJan(code) {
    if (!/^\d{8}$|^\d{12,13}$/.test(code)) return false;
    var d = code.split('').map(Number);
    var check = d.pop();
    var sum = 0;
    for (var i = d.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += d[i] * w;
    return (10 - (sum % 10)) % 10 === check;
  }

  // ---------- スキャン ----------

  var stream = null;
  var timer = null;
  var canvas = document.createElement('canvas');
  var zxReader = null;
  var detector = null;
  var tick = 0;

  // フレームの切り出し範囲(中央を拡大 → やや広め → 全体)を順に試す
  var CROPS = [[0.7, 0.4], [0.9, 0.6], [1, 1]];

  function decodeFrame(video) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return Promise.resolve(null);
    var c = CROPS[tick++ % CROPS.length];
    var cw = Math.round(vw * c[0]), ch = Math.round(vh * c[1]);
    var sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
    var scale = Math.min(1, 1400 / cw);
    canvas.width = Math.round(cw * scale);
    canvas.height = Math.round(ch * scale);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
    if (detector) {
      return detector.detect(canvas).then(function (r) { return r.length ? r[0].rawValue : null; })
        .catch(function () { return null; });
    }
    try {
      var bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
      return Promise.resolve(zxReader.decodeWithState(bmp).getText());
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function loop(video) {
    timer = setTimeout(function () {
      if (!stream || handling) return;
      decodeFrame(video).then(function (code) {
        $('scanHint').textContent = 'バーコード(JAN)を枠に合わせてください (v4・解析' + tick + '回' + (video.videoWidth ? '・' + video.videoWidth + 'px' : '') + ')';
        if (code && validJan(code)) { onJan(code); return; }
        if (stream) loop(video);
      });
    }, 120);
  }

  function startScan() {
    show('scanView');
    handling = false;
    $('manualJan').value = '';
    $('scanHint').textContent = 'バーコード(JAN)を枠に合わせてください';
    detector = null;
    if (window.ZXing) {
      var F = ZXing.BarcodeFormat;
      var hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      zxReader = new ZXing.MultiFormatReader();
      zxReader.setHints(hints);
    } else {
      $('scanHint').textContent = 'スキャナを読み込めません。番号を入力してください';
      return;
    }
    var video = $('video');
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      var track = s.getVideoTracks()[0];
      try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) { /* ignore */ }
      return video.play();
    }).then(function () { loop(video); })
      .catch(function () {
        $('scanHint').textContent = 'カメラを起動できません。番号を入力してください';
      });
  }

  function stopScan() {
    clearTimeout(timer);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    $('video').srcObject = null;
  }

  function onJan(jan) {
    if (handling) return;
    handling = true;
    stopScan();
    currentJan = jan;
    if (navigator.vibrate) navigator.vibrate(60);
    if (mode === 'buy') openBuy(jan); else openUse(jan);
  }

  // ---------- 購入 ----------

  function openBuy(jan) {
    $('buyJan').textContent = 'JAN ' + jan;
    $('buyName').value = '';
    $('buyQty').value = 1;
    $('buyExpiry').value = '';
    $('buySubmit').disabled = false;
    setStatus('buyNameStatus', '商品名を検索しています…', '');
    show('buyView');
    api('lookup', { jan: jan }).then(function (r) {
      if (r.name) {
        $('buyName').value = r.name;
        setStatus('buyNameStatus', '登録済みの商品名を使用しました', 'ok');
        return;
      }
      return fetchOff(jan).then(function (n) {
        if (n) {
          $('buyName').value = n;
          setStatus('buyNameStatus', 'Open Food Factsから取得しました(修正できます)', 'ok');
        } else {
          setStatus('buyNameStatus', '商品名を取得できませんでした。入力してください', 'warn');
          $('buyName').focus();
        }
      });
    }).catch(function (e) { setStatus('buyNameStatus', e.message, 'err'); });
  }

  function submitBuy() {
    var name = $('buyName').value.trim();
    var qty = parseInt($('buyQty').value, 10);
    var expiry = $('buyExpiry').value;
    if (!name) return alert('商品名を入力してください');
    if (!(qty >= 1)) return alert('個数を入力してください');
    if (!expiry) return alert('消費期限を入力してください');
    $('buySubmit').disabled = true;
    api('register', { jan: currentJan, name: name, qty: qty, expiry: expiry }).then(function (r) {
      done('✅', r.name + ' を ' + qty + '個 登録しました\n期限 ' + r.expiry + '(合計 ' + r.total + '個)');
    }).catch(function (e) {
      $('buySubmit').disabled = false;
      alert(e.message);
    });
  }

  // ---------- 消費 ----------

  function openUse(jan) {
    $('useJan').textContent = 'JAN ' + jan;
    $('useName').textContent = '';
    $('useLots').innerHTML = '';
    $('useForm').classList.add('hidden');
    setStatus('useStatus', '在庫を確認しています…', '');
    show('useView');
    api('lookup', { jan: jan }).then(function (r) {
      if (!r.registered || r.total < 1) {
        $('useName').textContent = r.name || '';
        setStatus('useStatus', r.registered ? '在庫がありません' : '登録されていない商品です', 'err');
        return;
      }
      useTotal = r.total;
      $('useName').textContent = r.name;
      setStatus('useStatus', '在庫 合計 ' + r.total + '個', 'ok');
      $('useLots').innerHTML = r.lots.map(function (l) {
        return '<tr><td>期限 ' + esc(l.expiry) + '</td><td>' + l.count + '個</td></tr>';
      }).join('');
      $('useQty').value = 1;
      $('useQty').max = r.total;
      $('useForm').classList.remove('hidden');
    }).catch(function (e) { setStatus('useStatus', e.message, 'err'); });
  }

  function submitUse() {
    var qty = parseInt($('useQty').value, 10);
    if (!(qty >= 1)) return alert('個数を入力してください');
    if (qty > useTotal) return alert('在庫(' + useTotal + '個)より多く消費できません');
    $('useSubmit').disabled = true;
    api('consume', { jan: currentJan, qty: qty }).then(function (r) {
      $('useSubmit').disabled = false;
      done('✅', r.name + ' を ' + r.consumed + '個 消費しました\n残り ' + r.remaining + '個');
    }).catch(function (e) {
      $('useSubmit').disabled = false;
      alert(e.message);
    });
  }

  // ---------- 共通 ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(id, text, cls) {
    var el = $(id);
    el.textContent = text;
    el.className = 'status ' + cls;
  }

  function done(icon, text) {
    $('doneIcon').textContent = icon;
    $('doneText').innerHTML = esc(text).replace(/\n/g, '<br>');
    $('doneNext').textContent = mode === 'buy' ? '続けて登録' : '続けて消費';
    show('doneView');
  }

  function setMode(m) {
    mode = m;
    $('tabBuy').classList.toggle('on', m === 'buy');
    $('tabUse').classList.toggle('on', m === 'use');
    stopScan();
    startScan();
  }

  function closeApp() {
    if (liff.isInClient()) liff.closeWindow(); else window.close();
  }

  function initialMode() {
    var q = new URLSearchParams(location.search);
    var m = q.get('mode');
    if (!m && q.get('liff.state')) {
      m = new URLSearchParams(q.get('liff.state').replace(/^[^?]*\?/, '')).get('mode');
    }
    return m === 'use' ? 'use' : 'buy';
  }

  function bind() {
    $('tabBuy').onclick = function () { setMode('buy'); };
    $('tabUse').onclick = function () { setMode('use'); };
    $('manualBtn').onclick = function () {
      var code = $('manualJan').value.replace(/\D/g, '');
      if (!validJan(code)) return alert('JANコードが正しくありません(8/12/13桁)');
      onJan(code);
    };
    $('buySubmit').onclick = submitBuy;
    $('useSubmit').onclick = submitUse;
    $('buyBack').onclick = $('useBack').onclick = startScan;
    $('doneNext').onclick = startScan;
    $('doneClose').onclick = closeApp;
  }

  bind();
  if (!CFG || /^YOUR_/.test(CFG.LIFF_ID)) { fail('config.js にLIFF IDとGAS URLを設定してください'); return; }
  liff.init({ liffId: CFG.LIFF_ID }).then(function () {
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    setMode(initialMode());
  }).catch(function (e) { fail('LINEの初期化に失敗しました: ' + e.message); });
})();
