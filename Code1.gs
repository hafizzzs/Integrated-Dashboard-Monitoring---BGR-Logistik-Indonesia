/**
 * ============================================================================
 *  Integrated Logistics Network Dashboard (ILND) · BGR Logistik Indonesia
 *  File   : Code.gs — SERVER (web app, login, mesin tarif, order, Kanwil, CT)
 *  Versi  : 0.7-gas.1
 *
 *  Database: Google Spreadsheet (dibuat otomatis) dengan sheet
 *            Users · Orders · Buyers · Audit
 *  Keamanan: login dicek di server, password ter-hash (SHA-256 + salt),
 *            batas percobaan login, field internal (pelayaran, biaya pokok,
 *            margin) tidak pernah dikirim ke sesi ID FOOD (NFR-01).
 * ============================================================================
 */

/* ------------------------------------------------------------------ WEB APP */

function doGet() {
  ensureSetup_();
  var t = HtmlService.createTemplateFromFile('Index');
  t.publicConfig = JSON.stringify(publicConfig_()).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function publicConfig_() {
  var demo = CONFIG.DEMO_MODE ? USERS_SEED.map(function (u) {
    return { username: u.username, password: u.password, display: u.display, role: u.role };
  }) : [];
  return {
    appName: CONFIG.APP_NAME, orgName: CONFIG.ORG_NAME, version: CONFIG.APP_VERSION,
    logoUrl: CONFIG.LOGO_URL, demoMode: CONFIG.DEMO_MODE, demoAccounts: demo
  };
}

/**
 * Satu pintu untuk semua panggilan dari browser.
 * Selalu mengembalikan string JSON {ok:true,data} atau {ok:false,error,code}.
 */
function api(action, token, payloadJson) {
  try {
    var payload = payloadJson ? JSON.parse(payloadJson) : {};
    var data;
    if (action === 'login') {
      data = login_(payload);
    } else {
      var user = getSession_(token);
      if (!user) return JSON.stringify({ ok: false, code: 'AUTH', error: 'Sesi berakhir. Silakan masuk kembali.' });
      switch (action) {
        case 'bootstrap':   data = bootstrap_(user); break;
        case 'quote':       data = sanitizeQuote_(quote_(payload), user); break;
        case 'createOrder': data = createOrder_(user, payload); break;
        case 'listOrders':  data = listOrders_(user); break;
        case 'updateOrder': data = updateOrder_(user, payload); break;
        case 'rejectOrder': data = rejectOrder_(user, payload); break;
        case 'logout':      logout_(token); data = true; break;
        default: throw new Error('Aksi tidak dikenal: ' + action);
      }
    }
    return JSON.stringify({ ok: true, data: data });
  } catch (err) {
    return JSON.stringify({ ok: false, error: (err && err.message) || String(err) });
  }
}

/* --------------------------------------------------------------- DATABASE */

var SHEETS_ = {
  Users: ['username', 'display_name', 'role', 'kanwil', 'branch', 'salt', 'password_hash', 'mfa_enabled', 'active', 'last_login_at'],
  Orders: ['no', 'created_at', 'updated_at', 'status', 'kanwil', 'submitted_user', 'status_by', 'origin', 'destination',
           'commodity', 'mode', 'tier', 'equipment', 'basis', 'qty', 'uom', 'units', 'total_kg', 'price_unit',
           'price_total', 'lead_min', 'lead_max', 'ready_date', 'eta', 'json'],
  Buyers: ['id', 'name', 'city', 'lat', 'lon', 'island', 'service_port', 'location_source', 'created_by', 'created_at'],
  Audit: ['time', 'user', 'action', 'ref', 'detail']
};

function db_() {
  var id = CONFIG.SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) { setup(); id = PropertiesService.getScriptProperties().getProperty('DB_ID'); }
  return SpreadsheetApp.openById(id);
}

function sheet_(name) { return db_().getSheetByName(name); }

function ensureSetup_() {
  var p = PropertiesService.getScriptProperties();
  if ((!CONFIG.SPREADSHEET_ID && !p.getProperty('DB_ID')) || Number(p.getProperty('SEED_V') || 0) < (CONFIG.SEED_VERSION || 1)) setup();
}

/**
 * JALANKAN SEKALI dari editor (pilih fungsi "setup" → Run) untuk memberi izin
 * dan membuat database. Aman dijalankan ulang: tidak menghapus data.
 */
function setup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = PropertiesService.getScriptProperties();
    var id = CONFIG.SPREADSHEET_ID || p.getProperty('DB_ID');
    var ss;
    if (id) { ss = SpreadsheetApp.openById(id); }
    else {
      ss = SpreadsheetApp.create('ILND Database · BGR Logistik Indonesia');
      p.setProperty('DB_ID', ss.getId());
    }
    Object.keys(SHEETS_).forEach(function (name) {
      var sh = ss.getSheetByName(name) || ss.insertSheet(name);
      if (sh.getLastRow() === 0) {
        sh.getRange(1, 1, 1, SHEETS_[name].length).setValues([SHEETS_[name]]).setFontWeight('bold');
        sh.setFrozenRows(1);
      }
    });
    var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Lembar1');
    if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

    // seed users (hanya yang belum ada)
    var us = ss.getSheetByName('Users');
    var existing = us.getLastRow() > 1 ? us.getRange(2, 1, us.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).toLowerCase(); }) : [];
    var rows = [];
    USERS_SEED.forEach(function (u) {
      if (existing.indexOf(u.username.toLowerCase()) >= 0) return;
      var salt = Utilities.getUuid();
      rows.push([u.username.toLowerCase(), u.display, u.role, u.kanwil, u.branch, salt, hash_(u.password, salt), false, true, '']);
    });
    if (rows.length) us.getRange(us.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    p.setProperty('SEED_V', String(CONFIG.SEED_VERSION || 1));
    Logger.log('Database siap: ' + ss.getUrl());
    return ss.getUrl();
  } finally { lock.releaseLock(); }
}

/** Utilitas admin: ganti password akun dari editor Apps Script. */
function adminSetPassword(username, newPassword) {
  var sh = sheet_('Users'), vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === String(username).toLowerCase()) {
      var salt = Utilities.getUuid();
      sh.getRange(i + 1, 6, 1, 2).setValues([[salt, hash_(String(newPassword).trim(), salt)]]);
      audit_('admin', 'SET_PASSWORD', username, '');
      return 'Password ' + username + ' diperbarui';
    }
  }
  throw new Error('Akun tidak ditemukan: ' + username);
}

/** Utilitas admin: tambah akun baru. role: IDFOOD | KANWIL | CONTROL_TOWER | ADMIN */
function adminAddUser(username, password, displayName, role, kanwil, branch) {
  var sh = sheet_('Users');
  var salt = Utilities.getUuid();
  sh.appendRow([String(username).toLowerCase(), displayName, role, kanwil || '', branch || '', salt, hash_(password, salt), false, true, '']);
  audit_('admin', 'ADD_USER', username, role);
  return 'Akun ' + username + ' dibuat';
}

/** Utilitas admin: kosongkan semua order (untuk reset demo). */
function adminResetOrders() {
  var sh = sheet_('Orders');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  CacheService.getScriptCache().remove('orders_v');
  return 'Semua order dihapus';
}

function audit_(user, action, ref, detail) {
  try { sheet_('Audit').appendRow([nowIso_(), user, action, ref, typeof detail === 'string' ? detail : JSON.stringify(detail)]); } catch (e) { }
}

/* ------------------------------------------------------------------ AUTH */

function hash_(password, salt) {
  var v = salt + '|' + password;
  for (var i = 0; i < 64; i++) {
    v = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v + salt, Utilities.Charset.UTF_8));
  }
  return v;
}

function findUser_(username) {
  var vals = sheet_('Users').getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).toLowerCase() === username) {
      var r = vals[i];
      return { row: i + 1, username: r[0], display: r[1], role: r[2], kanwil: r[3], branch: r[4], salt: r[5], hash: r[6], active: r[8] !== false && r[8] !== 'FALSE' };
    }
  }
  return null;
}

function login_(p) {
  var username = String(p.username || '').trim().toLowerCase();
  if (username.indexOf('@') > 0) username = username.split('@')[0];
  var password = String(p.password || '').trim();
  if (!username || !password) throw new Error('Username dan password wajib diisi.');

  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + username;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= CONFIG.MAX_LOGIN_ATTEMPTS) {
    throw new Error('Terlalu banyak percobaan. Coba lagi dalam ' + CONFIG.LOCKOUT_MINUTES + ' menit.');
  }
  var u = findUser_(username);
  if (!u) throw new Error('Username "' + username + '" tidak ditemukan.');
  if (!u.active) throw new Error('Akun ini dinonaktifkan. Hubungi admin BGR LI.');
  if (hash_(password, u.salt) !== u.hash) {
    cache.put(failKey, String(fails + 1), CONFIG.LOCKOUT_MINUTES * 60);
    var left = CONFIG.MAX_LOGIN_ATTEMPTS - fails - 1;
    throw new Error('Password salah.' + (left > 0 ? ' Sisa ' + left + ' percobaan.' : ''));
  }
  cache.remove(failKey);
  try { sheet_('Users').getRange(u.row, 10).setValue(nowIso_()); } catch (e) { }

  var user = publicUser_(u);
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var remember = !!p.remember;
  var exp = Date.now() + (remember ? CONFIG.REMEMBER_DAYS * 864e5 : CONFIG.SESSION_HOURS * 36e5);
  var sess = JSON.stringify({ user: user, exp: exp });
  cache.put('s_' + token, sess, Math.min(21600, Math.floor((exp - Date.now()) / 1000)));
  if (remember) PropertiesService.getScriptProperties().setProperty('S_' + token, sess);
  audit_(user.username, 'LOGIN', user.role, '');
  return { token: token, remember: remember, user: user, roleAdjusted: p.role && p.role !== user.role ? user.role : null };
}

function publicUser_(u) {
  var off = u.role === 'CABANG' ? officeByCode_(u.branch) : null;
  return { username: u.username, display: u.display, role: u.role, kanwil: u.kanwil || '', kanwilName: KANWIL[u.kanwil] || '', branch: u.branch || '',
           office: off ? off.code : (u.role === 'KANWIL' ? 'KW-' + u.kanwil : ''), officeName: off ? off.name : '' };
}

function getSession_(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('s_' + token);
  if (!raw) {
    var props = PropertiesService.getScriptProperties();
    raw = props.getProperty('S_' + token);
    if (!raw) return null;
    var s0 = JSON.parse(raw);
    if (s0.exp < Date.now()) { props.deleteProperty('S_' + token); return null; }
    cache.put('s_' + token, raw, Math.min(21600, Math.floor((s0.exp - Date.now()) / 1000)));
  }
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { logout_(token); return null; }
  return s.user;
}

function logout_(token) {
  CacheService.getScriptCache().remove('s_' + token);
  PropertiesService.getScriptProperties().deleteProperty('S_' + token);
}

/** Bersihkan sesi "Ingat saya" yang kedaluwarsa (opsional: pasang trigger harian). */
function cleanupSessions() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties(), n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < Date.now()) { props.deleteProperty(k); n++; } } catch (e) { props.deleteProperty(k); }
  });
  return n + ' sesi dihapus';
}

/* ------------------------------------------------------------- BOOTSTRAP */

function isInternal_(user) { return user.role !== 'IDFOOD'; }

function bootstrap_(user) {
  var internal = isInternal_(user);
  var cacheKey = 'boot_v12_' + (internal ? 'int' : 'pub');
  var cache = CacheService.getScriptCache();
  var staticPart = null;
  var cached = cache.get(cacheKey);
  if (cached) { try { staticPart = JSON.parse(unzip_(cached)); } catch (e) { } }
  if (!staticPart) {
    var served = servedPortSet_();
    staticPart = {
      ports: PORTS.map(function (p) { return { code: p[0], name: p[1], city: p[2], lat: p[3], lon: p[4], cls: p[5], island: p[6], served: !!served[p[0]] }; }),
      shipNet: SERVICES.map(function (s) { return s.rot.slice(); }),
      points: POINTS.map(function (p) {
        var sp = nearestServedPort_(p.lat, p.lon);
        var o = { id: p.id, type: p.type, name: p.name, entity: p.entity, city: p.city, island: p.island, lat: p.lat, lon: p.lon, commodities: p.commodities, servicePort: sp.code, kanwil: kanwilFor_(p) };
        if (p.type === 'CABANG') {
          o.pic = p.pic || ''; o.picPhone = p.picPhone || '';
        }
        if (p.type === 'SUPPLIER' && p.company) {
          o.company = p.company; o.products = p.products || []; o.location = p.location || ''; o.ritMonth = p.ritMonth || 0; o.armada = p.armada || '';
          o.dist = (p.dist || []).map(function (d) { return { region: d[0], rit: d[1], cabang: d[2] }; });
        }
        return o;
      }),
      cities: CITIES.map(function (c) { return { name: c[0], island: c[1], lat: c[2], lon: c[3] }; }),
      schemes: SCHEMES,
      equipment: EQUIPMENT.map(function (e) { return { code: e.code, name: e.name, short: e.short, maxTon: e.maxTon, m3: e.m3, payload: e.payload, modes: e.modes }; }),
      milestones: MILESTONES,
      kanwil: KANWIL,
      offices: BLI_OFFICES.map(function (o) { return { code: o[0], name: o[1], type: o[2], kanwil: o[3] }; }),
      crossings: RORO_CROSSINGS,
      lanes: LANES.map(function (l, i) {
        var q = sanitizeQuote_(quote_({ origin: l[0], dest: { type: 'POINT', id: l[1] }, commodity: l[2] }), { role: internal ? 'KANWIL' : 'IDFOOD' });
        var m = q.modes[q.best];
        var eq = m && m.equipment.filter(function (e) { return e.code === m.cheapest; })[0];
        return {
          id: 'L' + ('00' + (i + 1)).slice(-3), origin: l[0], dest: l[1], commodity: l[2], rit: l[3] == null ? null : l[3], scheme: schemeOf_(l[0], l[1]),
          mode: q.best, eq: eq ? eq.short : '', rpkg: eq ? eq.reguler.rpkg : null, price: eq ? eq.reguler.price : null,
          leadMin: eq ? eq.reguler.leadMin : null, leadMax: eq ? eq.reguler.leadMax : null,
          segments: m ? m.segments.reguler : [], modesAvail: { LAUT: q.modes.LAUT.available, DARAT: q.modes.DARAT.available }
        };
      }),
      settings: { slaHours: CONFIG.SLA_CONFIRM_HOURS, lateGraceDays: CONFIG.LATE_GRACE_DAYS }
    };
    try { cache.put(cacheKey, zip_(JSON.stringify(staticPart)), 3600); } catch (e) { }
  }
  staticPart.user = user;
  staticPart.orders = listOrders_(user);
  return staticPart;
}

/** Kompres teks agar muat di CacheService (batas 100 KB per kunci). */
function zip_(str) { return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(str, 'application/json')).getBytes()); }
function unzip_(b64) { return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString(); }

function schemeOf_(o, d) {
  var a = pointById_(o).type, b = d && d.type === 'BUYER' ? 'BUYER' : pointById_(typeof d === 'string' ? d : d.id).type;
  var s = SCHEMES.filter(function (x) { return x.from === a && x.to === b; })[0];
  return s ? s.code : '';
}

/* ------------------------------------------------------------- GEO UTIL */

function kmBetween_(lat1, lon1, lat2, lon2) {
  var R = 6371, toR = Math.PI / 180;
  var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}
function nmPorts_(a, b) { return kmBetween_(a.lat, a.lon, b.lat, b.lon) / 1.852 * CONFIG.SEA_DETOUR; }
function round10k_(v) { return Math.round(v / 10000) * 10000; }
function roundHalf_(v) { return Math.round(v * 2) / 2; }

var PORT_IDX_ = null;
function portByCode_(code) {
  if (!PORT_IDX_) { PORT_IDX_ = {}; PORTS.forEach(function (p) { PORT_IDX_[p[0]] = { code: p[0], name: p[1], city: p[2], lat: p[3], lon: p[4], cls: p[5], island: p[6] }; }); }
  return PORT_IDX_[code];
}
function pointById_(id) {
  for (var i = 0; i < POINTS.length; i++) if (POINTS[i].id === id) return POINTS[i];
  throw new Error('Titik tidak ditemukan: ' + id);
}
function servedPortSet_() { var s = {}; SERVICES.forEach(function (sv) { sv.rot.forEach(function (c) { s[c] = true; }); }); return s; }
function nearestServedPort_(lat, lon) {
  var served = servedPortSet_(), best = null, bd = 1e9;
  PORTS.forEach(function (p) { if (!served[p[0]]) return; var d = kmBetween_(lat, lon, p[3], p[4]); if (d < bd) { bd = d; best = p[0]; } });
  return portByCode_(best);
}
function nearestCity_(lat, lon) {
  var best = null, bd = 1e9;
  CITIES.forEach(function (c) { var d = kmBetween_(lat, lon, c[2], c[3]); if (d < bd) { bd = d; best = c; } });
  return { name: best[0], island: best[1], lat: best[2], lon: best[3], km: Math.round(bd) };
}
function regionOf_(island) { return ISLAND_REGION[island] || island; }

/** Aturan sementara pembagian Kanwil berdasarkan lokasi pickup (FR-KW-01). */
function kanwilFor_(p) {
  if (p.kanwil && KANWIL[p.kanwil]) return p.kanwil; // dari data (mis. kolom KANWIL BLI Lembar Komitmen)
  var r = regionOf_(p.island);
  if (r === 'Sumatera') return p.lat >= 0 ? 'MDN' : 'PLG';
  if (r === 'Jawa') return p.lon < 109 ? 'DKI' : 'SBY';
  if (r === 'Kalimantan') return p.lon < 111.3 ? 'DKI' : 'SBY';
  if (r === 'Bali' || r === 'NTB' || r === 'NTT') return 'MTR';
  return 'MKS';
}

function officeByCode_(code) {
  for (var i = 0; i < BLI_OFFICES.length; i++) if (BLI_OFFICES[i][0] === code) { var o = BLI_OFFICES[i]; return { code: o[0], name: o[1], type: o[2], kanwil: o[3], lat: o[4], lon: o[5], island: o[6] || '' }; }
  return null;
}
/**
 * Kantor pelaksana order: kantor mitra BLI dari data cabang (bila ada), selain itu kantor BLI
 * terdekat dari titik pickup di dalam Kanwil yang bertanggung jawab.
 */
function officeFor_(p, kw) {
  if (p.bliOffice) {
    var nm = String(p.bliOffice).toLowerCase().replace(/\s+/g, ' ').trim();
    for (var i = 0; i < BLI_OFFICES.length; i++) if (BLI_OFFICES[i][1].toLowerCase() === nm) return officeByCode_(BLI_OFFICES[i][0]);
  }
  var cand = BLI_OFFICES.filter(function (o) { return o[3] === kw; });
  var same = cand.filter(function (o) { return o[6] && o[6] === p.island; });
  if (!same.length) return officeByCode_('KW-' + kw); // tidak ada kantor BLI di pulau ini → Kanwil yang eksekusi
  cand = same;                                         // kantor terdekat di pulau yang sama
  var best = null, bd = 1e9;
  cand.forEach(function (o) {
    var d = kmBetween_(p.lat, p.lon, o[4], o[5]);
    if (d < bd) { bd = d; best = o[0]; }
  });
  return officeByCode_(best || 'KW-' + kw);
}
function canExecute_(user, o) {
  if (user.role === 'CABANG') return o.office === user.branch;
  if (user.role === 'KANWIL') return o.office === 'KW-' + user.kanwil;
  return false;
}

/* ----------------------------------------------------- MESIN TARIF (QUOTE) */

function resolveDest_(d) {
  if (!d) throw new Error('Tujuan wajib diisi.');
  if (d.type === 'BUYER') {
    var name = String(d.name || '').trim();
    if (!name) throw new Error('Nama buyer wajib diisi.');
    var lat = Number(d.lat), lon = Number(d.lon);
    if (!isFinite(lat) || !isFinite(lon)) {
      var c = CITIES.filter(function (x) { return x[0].toLowerCase() === String(d.city || '').toLowerCase(); })[0];
      if (!c) throw new Error('Lokasi buyer belum dipilih (kota atau titik di peta).');
      lat = c[2]; lon = c[3];
    }
    var nc = nearestCity_(lat, lon);
    return { kind: 'BUYER', id: 'BUYER', name: name, city: d.source === 'PETA' ? nc.name : (d.city || nc.name), island: nc.island,
             lat: lat, lon: lon, source: d.source === 'PETA' ? 'PETA' : 'KOTA', nearestCityKm: nc.km };
  }
  var p = pointById_(d.id);
  return { kind: 'POINT', id: p.id, type: p.type, name: p.name, city: p.city, island: p.island, lat: p.lat, lon: p.lon };
}

function quote_(req) {
  var commodity = req.commodity === 'MINYAK' ? 'MINYAK' : 'GULA';
  var o = pointById_(req.origin);
  var origin = { kind: 'POINT', id: o.id, type: o.type, name: o.name, city: o.city, island: o.island, lat: o.lat, lon: o.lon };
  var dest = resolveDest_(req.dest);
  if (dest.kind === 'POINT' && dest.id === origin.id) throw new Error('Asal dan tujuan tidak boleh sama.');
  var kw = kanwilFor_(o);
  var off = officeFor_(o, kw);
  kw = off.kanwil;
  var sea = seaQuote_(origin, dest, commodity);
  var land = landQuote_(origin, dest, commodity);
  var best = null;
  var cand = [['LAUT', sea], ['DARAT', land]].filter(function (x) { return x[1].available; });
  cand.sort(function (a, b) { return a[1].minRpkg - b[1].minRpkg; });
  if (cand.length) best = cand[0][0];
  var sp = nearestServedPort_(dest.lat, dest.lon);
  dest.servicePort = sp.code; dest.servicePortName = sp.name + ', ' + sp.city;
  return { origin: origin, dest: dest, commodity: commodity, kanwil: kw, kanwilName: KANWIL[kw], office: off.code, officeName: off.name, officeType: off.type, best: best,
           modes: { LAUT: sea, DARAT: land } };
}

/** Jalan sepanjang rotasi pendulum dari port a ke port b (jarak & singgah minimum). */
function legAlong_(svc, a, b) {
  var rot = svc.rot;
  var seq = rot.concat(rot.slice(1, -1).reverse()); // pendulum loop
  var n = seq.length, best = null;
  for (var i = 0; i < n; i++) {
    if (seq[i] !== a) continue;
    var nm = 0, path = [a];
    for (var s = 1; s < n; s++) {
      var prev = seq[(i + s - 1) % n], cur = seq[(i + s) % n];
      nm += nmPorts_(portByCode_(prev), portByCode_(cur));
      path.push(cur);
      if (cur === b) {
        if (!best || nm < best.nm) best = { nm: nm, calls: path.length - 2, path: path.slice() };
        break;
      }
    }
  }
  return best;
}

function seaOptions_(pol, pod) {
  var opts = [];
  SERVICES.forEach(function (s) {
    if (s.rot.indexOf(pol) >= 0 && s.rot.indexOf(pod) >= 0) {
      var l = legAlong_(s, pol, pod);
      if (l) opts.push({ legs: [{ svc: s, nm: l.nm, calls: l.calls, path: l.path }], via: null });
    }
  });
  SERVICES.forEach(function (a) {
    if (a.rot.indexOf(pol) < 0) return;
    SERVICES.forEach(function (b) {
      if (a === b || b.rot.indexOf(pod) < 0) return;
      var bestX = null;
      a.rot.forEach(function (x) {
        if (x === pol || x === pod || b.rot.indexOf(x) < 0) return;
        var l1 = legAlong_(a, pol, x), l2 = legAlong_(b, x, pod);
        if (!l1 || !l2) return;
        var tot = l1.nm + l2.nm;
        if (!bestX || tot < bestX.tot) bestX = { tot: tot, x: x, l1: l1, l2: l2 };
      });
      if (bestX) opts.push({ legs: [{ svc: a, nm: bestX.l1.nm, calls: bestX.l1.calls, path: bestX.l1.path },
                                    { svc: b, nm: bestX.l2.nm, calls: bestX.l2.calls, path: bestX.l2.path }], via: bestX.x });
    });
  });
  return opts;
}

function truckLeg_(eq, from, to) {
  var km = kmBetween_(from.lat, from.lon, to.lat, to.lon) * CONFIG.TRUCK_SEA_DETOUR;
  return { km: km, days: Math.max(0.5, roundHalf_(0.5 + km / CONFIG.TRUCK_SEA_KMPD)), cost: eq.base + km * eq.perKm };
}

function seaCost_(opt, eq, pol, pod, destRegion, prime) {
  var dir = pod.lon < pol.lon - 0.3 ? CONFIG.WESTBOUND_FACTOR : 1;
  var rf = REGION_FACTOR[destRegion] || 1.1;
  var of = 0;
  opt.legs.forEach(function (l) { of += (CONFIG.OF_BASE_IDR + l.nm * CONFIG.OF_PER_NM_IDR) * l.svc.factor * rf * dir * eq.seaF; });
  var surcharge = prime ? of * CONFIG.PRIME_SURCHARGE + CONFIG.PRIME_FASTTRACK_IDR : 0;
  var thc = (CONFIG.THC_BY_CLASS[pol.cls] + CONFIG.THC_BY_CLASS[pod.cls]) * eq.thcF;
  if (opt.via) thc += CONFIG.THC_BY_CLASS[portByCode_(opt.via).cls] * eq.thcF;
  return { of: of, surcharge: surcharge, thc: thc, doc: CONFIG.DOC_SEAL_IDR, total: of + surcharge + thc + CONFIG.DOC_SEAL_IDR };
}

function sailDays_(opt) {
  var d = 0;
  opt.legs.forEach(function (l) { d += l.nm / (CONFIG.SHIP_SPEED_KNOT * 24) + CONFIG.DAYS_PER_CALL * l.calls; });
  if (opt.via) d += CONFIG.TRANSSHIP_DWELL_DAYS;
  return d;
}

function seaQuote_(o, d, commodity) {
  var pol = nearestServedPort_(o.lat, o.lon), pod = nearestServedPort_(d.lat, d.lon);
  var res = { mode: 'LAUT', available: false, reason: '', pol: pol, pod: pod, equipment: [], segments: {}, stages: {}, internal: {} };
  if (pol.code === pod.code) { res.reason = 'Asal dan tujuan memakai pelabuhan yang sama (' + pol.name + '). Gunakan moda darat.'; return res; }
  var opts = seaOptions_(pol.code, pod.code);
  if (!opts.length) { res.reason = 'Belum ada layanan kapal ' + pol.name + ' → ' + pod.name + '.'; return res; }

  var destRegion = regionOf_(d.island);
  var c20 = EQUIPMENT.filter(function (e) { return e.code === 'C20'; })[0];
  // Reguler: biaya pokok laut terendah (direct / 1× transshipment, termasuk Tol Laut)
  var reg = opts.slice().sort(function (a, b) { return seaCost_(a, c20, pol, pod, destRegion, false).total - seaCost_(b, c20, pol, pod, destRegion, false).total; })[0];
  // Prime: direct tercepat tanpa Tol Laut (fallback: opsi tercepat non Tol Laut, lalu apa saja)
  var directs = opts.filter(function (x) { return !x.via && !x.legs[0].svc.tolLaut; });
  var pool = directs.length ? directs : opts.filter(function (x) { return x.legs.every(function (l) { return !l.svc.tolLaut; }); });
  if (!pool.length) pool = opts;
  var prm = pool.slice().sort(function (a, b) { return sailDays_(a) - sailDays_(b); })[0];
  var invSum = 0; pool.filter(function (x) { return !x.via; }).forEach(function (x) { invSum += 1 / x.legs[0].svc.freq; });
  var cycleP = invSum ? 1 / invSum : prm.legs.reduce(function (s, l) { return s + l.svc.freq; }, 0);
  var waitP = Math.max(0.5, cycleP / 2);

  var fmDays = Math.max(0.5, roundHalf_(0.5 + kmBetween_(o.lat, o.lon, pol.lat, pol.lon) * CONFIG.TRUCK_SEA_DETOUR / CONFIG.TRUCK_SEA_KMPD));
  var lmDays = Math.max(0.5, roundHalf_(0.5 + kmBetween_(pod.lat, pod.lon, d.lat, d.lon) * CONFIG.TRUCK_SEA_DETOUR / CONFIG.TRUCK_SEA_KMPD));

  function leadOf(opt, tier) {
    var base = fmDays + sailDays_(opt) + (tier === 'PRIME' ? CONFIG.HANDLING_PRIME_DAYS : CONFIG.HANDLING_REGULER_DAYS) + lmDays;
    var cycle = tier === 'PRIME' ? waitP * 2 : opt.legs.reduce(function (s, l) { return s + l.svc.freq; }, 0);
    var mn = Math.max(1, Math.round(base)), mx = Math.max(mn + 1, Math.round(base + cycle));
    return { min: mn, max: mx, sail: sailDays_(opt), wait: tier === 'PRIME' ? waitP : cycle / 2,
             handling: tier === 'PRIME' ? CONFIG.HANDLING_PRIME_DAYS : CONFIG.HANDLING_REGULER_DAYS };
  }
  var leadR = leadOf(reg, 'REGULER'), leadP = leadOf(prm, 'PRIME');
  if (leadP.min > leadR.min) leadP.min = leadR.min;
  if (leadP.max >= leadR.max) leadP.max = Math.max(leadP.min + 1, leadR.max - 1);

  var minRpkg = Infinity, cheapest = null;
  EQUIPMENT.forEach(function (eq) {
    var item = { code: eq.code, name: eq.name, short: eq.short, maxTon: eq.maxTon, m3: eq.m3, payload: eq.payload[commodity], available: true, reason: '' };
    if (eq.modes.indexOf('LAUT') < 0) { item.available = false; item.reason = 'Hanya untuk moda darat'; }
    else if (eq.portClassRequired && (pol.cls !== eq.portClassRequired || pod.cls !== eq.portClassRequired)) {
      item.available = false; item.reason = 'Hanya bila pelabuhan muat & bongkar kelas utama';
    }
    if (item.available) {
      var fm = truckLeg_(eq, o, pol), lm = truckLeg_(eq, pod, d);
      var sR = seaCost_(reg, eq, pol, pod, destRegion, false), sP = seaCost_(prm, eq, pol, pod, destRegion, true);
      var costR = fm.cost + sR.total + lm.cost, costP = fm.cost + sP.total + lm.cost;
      var sellR = round10k_(costR * (1 + CONFIG.FEE_MARGIN));
      var sellP = round10k_(Math.max(costP * (1 + CONFIG.FEE_MARGIN), sellR * CONFIG.PRIME_MIN_MULTIPLIER));
      var kg = item.payload * 1000;
      item.reguler = { price: sellR, rpkg: Math.round(sellR / kg), leadMin: leadR.min, leadMax: leadR.max };
      item.prime = { price: sellP, rpkg: Math.round(sellP / kg), leadMin: leadP.min, leadMax: leadP.max };
      item.internal = {
        reguler: { cost: Math.round(costR), margin: sellR - costR, marginPct: (sellR - costR) / sellR, breakdown: { firstMile: Math.round(fm.cost), sea: Math.round(sR.total), lastMile: Math.round(lm.cost), oceanFreight: Math.round(sR.of), thc: Math.round(sR.thc), doc: sR.doc } },
        prime: { cost: Math.round(costP), margin: sellP - costP, marginPct: (sellP - costP) / sellP, breakdown: { firstMile: Math.round(fm.cost), sea: Math.round(sP.total), lastMile: Math.round(lm.cost), oceanFreight: Math.round(sP.of), surcharge: Math.round(sP.surcharge), thc: Math.round(sP.thc), doc: sP.doc } }
      };
      if (item.reguler.rpkg < minRpkg) { minRpkg = item.reguler.rpkg; cheapest = eq.code; }
    }
    res.equipment.push(item);
  });

  function segs(opt) {
    var s = [{ type: 'truck', coords: [[o.lon, o.lat], [pol.lon, pol.lat]] }];
    var pts = [];
    opt.legs.forEach(function (l, i) { l.path.forEach(function (c, j) { if (i > 0 && j === 0) return; var p = portByCode_(c); pts.push([p.lon, p.lat]); }); });
    s.push({ type: 'sea', coords: pts, simple: [[pol.lon, pol.lat], [pod.lon, pod.lat]] });
    s.push({ type: 'truck', coords: [[pod.lon, pod.lat], [d.lon, d.lat]] });
    return s;
  }
  function stages(opt, lead) {
    var fmKm = Math.round(kmBetween_(o.lat, o.lon, pol.lat, pol.lon) * CONFIG.TRUCK_SEA_DETOUR);
    var lmKm = Math.round(kmBetween_(pod.lat, pod.lon, d.lat, d.lon) * CONFIG.TRUCK_SEA_DETOUR);
    var nm = opt.legs.reduce(function (s, l) { return s + l.nm; }, 0);
    return [
      { kind: 'origin', label: o.name, detail: o.city },
      { kind: 'truck', label: 'Truk ke pelabuhan muat', detail: fmKm + ' km · ' + fmDays + ' hari' },
      { kind: 'ship', label: 'Kapal ' + pol.city + ' → ' + pod.city, detail: Math.round(nm) + ' nm · ±' + (Math.round(lead.sail * 2) / 2) + ' hari berlayar · tunggu kapal ±' + (Math.round(lead.wait * 2) / 2) + ' hari', internalDetail: opt.via ? 'Transshipment di ' + portByCode_(opt.via).name : 'Direct' },
      { kind: 'port', label: 'Pelabuhan bongkar ' + pod.name, detail: 'Handling ' + lead.handling + ' hari' },
      { kind: 'truck', label: 'Truk ke titik tujuan', detail: lmKm + ' km · ' + lmDays + ' hari' },
      { kind: 'dest', label: d.name, detail: d.city }
    ];
  }
  function mapping(opt) {
    return opt.legs.map(function (l) {
      return { service: l.svc.id, carrier: l.svc.carrier, tolLaut: l.svc.tolLaut, freqDays: l.svc.freq,
               route: l.path.map(function (c) { return portByCode_(c).city; }).join(' → ') };
    });
  }

  res.available = cheapest !== null;
  res.cheapest = cheapest; res.minRpkg = minRpkg;
  res.segments = { reguler: segs(reg), prime: segs(prm) };
  res.stages = { reguler: stages(reg, leadR), prime: stages(prm, leadP) };
  res.internal = { reguler: { mapping: mapping(reg), via: reg.via }, prime: { mapping: mapping(prm), via: prm.via },
                   candidates: opts.length };
  res.pol = { code: pol.code, name: pol.name, city: pol.city, lat: pol.lat, lon: pol.lon, cls: pol.cls };
  res.pod = { code: pod.code, name: pod.name, city: pod.city, lat: pod.lat, lon: pod.lon, cls: pod.cls };
  return res;
}

function landQuote_(o, d, commodity) {
  var res = { mode: 'DARAT', available: false, reason: '', equipment: [], segments: {}, stages: {}, crossings: [] };
  var crossings = [];
  if (o.island !== d.island) {
    var i = RORO_CHAIN.indexOf(o.island), j = RORO_CHAIN.indexOf(d.island);
    if (i < 0 || j < 0) { res.reason = 'Asal dan tujuan beda pulau dan tidak tersambung RoRo (Sumatera–Jawa–Bali–Lombok).'; return res; }
    if (i < j) { for (var k = i; k < j; k++) crossings.push({ name: RORO_CROSSINGS[k].name, from: RORO_CROSSINGS[k].a, to: RORO_CROSSINGS[k].b }); }
    else { for (var k2 = i - 1; k2 >= j; k2--) crossings.push({ name: RORO_CROSSINGS[k2].name.split(' – ').reverse().join(' – '), from: RORO_CROSSINGS[k2].b, to: RORO_CROSSINGS[k2].a }); }
  }
  var segs = [], cur = { lat: o.lat, lon: o.lon }, km = 0;
  crossings.forEach(function (c) {
    km += kmBetween_(cur.lat, cur.lon, c.from.lat, c.from.lon);
    segs.push({ type: 'truck', coords: [[cur.lon, cur.lat], [c.from.lon, c.from.lat]] });
    segs.push({ type: 'ferry', coords: [[c.from.lon, c.from.lat], [c.to.lon, c.to.lat]], name: c.name });
    cur = c.to;
  });
  km += kmBetween_(cur.lat, cur.lon, d.lat, d.lon);
  segs.push({ type: 'truck', coords: [[cur.lon, cur.lat], [d.lon, d.lat]] });
  km *= CONFIG.LAND_DETOUR;
  var n = crossings.length;

  var regMin = 1 + km / CONFIG.LAND_REG_KMPD + 0.5 * n;
  var prmMin = 1 + km / CONFIG.LAND_PRIME_KMPD + 0.5 * n;
  var leadR = { min: Math.max(1, Math.round(regMin)), max: Math.max(Math.round(regMin) + 1, Math.round(regMin + CONFIG.LAND_WAIT_MAX_DAYS)) };
  var leadP = { min: Math.max(1, Math.round(prmMin)), max: Math.max(1, Math.round(prmMin)) + 1 };
  if (leadP.min > leadR.min) leadP.min = leadR.min;
  if (leadP.max >= leadR.max) leadP.max = Math.max(leadP.min + 1, leadR.max - 1);
  if (leadP.max >= leadR.max) leadP.max = leadR.max;

  var minRpkg = Infinity, cheapest = null;
  EQUIPMENT.forEach(function (eq) {
    var item = { code: eq.code, name: eq.name, short: eq.short, maxTon: eq.maxTon, m3: eq.m3, payload: eq.payload[commodity], available: true, reason: '' };
    var allowance = CONFIG.ROAD_ALLOWANCE_IDR * Math.max(1, Math.ceil(km / CONFIG.ROAD_ALLOWANCE_KM));
    var costR = eq.base + km * eq.perKm + eq.ferry * n + allowance;
    var costP = costR * CONFIG.LAND_PRIME_MULTIPLIER;
    var sellR = round10k_(costR * (1 + CONFIG.FEE_MARGIN));
    var sellP = round10k_(Math.max(costP * (1 + CONFIG.FEE_MARGIN), sellR * CONFIG.PRIME_MIN_MULTIPLIER));
    var kg = item.payload * 1000;
    item.reguler = { price: sellR, rpkg: Math.round(sellR / kg), leadMin: leadR.min, leadMax: leadR.max };
    item.prime = { price: sellP, rpkg: Math.round(sellP / kg), leadMin: leadP.min, leadMax: leadP.max };
    item.internal = {
      reguler: { cost: Math.round(costR), margin: sellR - costR, marginPct: (sellR - costR) / sellR, breakdown: { trucking: Math.round(eq.base + km * eq.perKm), ferry: eq.ferry * n, roadAllowance: allowance } },
      prime: { cost: Math.round(costP), margin: sellP - costP, marginPct: (sellP - costP) / sellP, breakdown: { dedicated2Driver: Math.round(costP - eq.ferry * n * CONFIG.LAND_PRIME_MULTIPLIER), ferry: Math.round(eq.ferry * n * CONFIG.LAND_PRIME_MULTIPLIER) } }
    };
    if (item.reguler.rpkg < minRpkg) { minRpkg = item.reguler.rpkg; cheapest = eq.code; }
    res.equipment.push(item);
  });

  function stages(tier) {
    var st = [{ kind: 'origin', label: o.name, detail: o.city }];
    var kmDone = 0; var c0 = { lat: o.lat, lon: o.lon };
    crossings.forEach(function (c) {
      var k = Math.round(kmBetween_(c0.lat, c0.lon, c.from.lat, c.from.lon) * CONFIG.LAND_DETOUR);
      st.push({ kind: 'truck', label: 'Truk ke ' + c.from.name, detail: k + ' km' });
      st.push({ kind: 'ferry', label: 'Penyeberangan RoRo ' + c.name, detail: '±0,5 hari' });
      kmDone += k; c0 = c.to;
    });
    var last = Math.round(kmBetween_(c0.lat, c0.lon, d.lat, d.lon) * CONFIG.LAND_DETOUR);
    st.push({ kind: 'truck', label: crossings.length ? 'Truk ke titik tujuan' : 'Truk langsung ke tujuan', detail: last + ' km' + (tier === 'PRIME' ? ' · armada dedicated, 2 sopir' : ' · tunggu armada s.d. 2 hari') });
    st.push({ kind: 'dest', label: d.name, detail: d.city });
    return st;
  }

  res.available = true; res.cheapest = cheapest; res.minRpkg = minRpkg; res.km = Math.round(km);
  res.crossings = crossings.map(function (c) { return { name: c.name, lat: (c.from.lat + c.to.lat) / 2, lon: (c.from.lon + c.to.lon) / 2 }; });
  res.segments = { reguler: segs, prime: segs };
  res.stages = { reguler: stages('REGULER'), prime: stages('PRIME') };
  res.internal = { reguler: { mapping: [{ service: 'DARAT', carrier: 'Vendor armada darat (dummy)', route: Math.round(km) + ' km' + (n ? ' · ' + n + ' penyeberangan' : '') }] },
                   prime: { mapping: [{ service: 'DARAT-PRIME', carrier: 'Vendor armada dedicated (dummy)', route: Math.round(km) + ' km · 2 sopir' }] } };
  return res;
}

/** NFR-01: buang field internal untuk ID FOOD; buang margin untuk Kanwil. */
function sanitizeQuote_(q, user) {
  var role = user.role;
  var out = JSON.parse(JSON.stringify(q));
  ['LAUT', 'DARAT'].forEach(function (m) {
    var md = out.modes[m];
    if (!md) return;
    if (md.minRpkg === Infinity || md.minRpkg === null) md.minRpkg = null;
    if (role === 'IDFOOD') {
      delete md.internal;
      md.equipment.forEach(function (e) { delete e.internal; });
      ['reguler', 'prime'].forEach(function (t) {
        (md.segments[t] || []).forEach(function (s) { if (s.type === 'sea') { s.coords = s.simple; } delete s.simple; });
        (md.stages[t] || []).forEach(function (s) { delete s.internalDetail; });
      });
    } else {
      ['reguler', 'prime'].forEach(function (t) { (md.segments[t] || []).forEach(function (s) { delete s.simple; }); });
      if (role !== 'CONTROL_TOWER' && role !== 'ADMIN') {
        md.equipment.forEach(function (e) {
          if (!e.internal) return;
          ['reguler', 'prime'].forEach(function (t) { delete e.internal[t].margin; delete e.internal[t].marginPct; });
        });
      }
    }
  });
  return out;
}

/* ------------------------------------------------------------------ ORDER */

function nowIso_() { return new Date().toISOString(); }

function nextOrderNo_() {
  var ymd = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMdd');
  var p = PropertiesService.getScriptProperties();
  var key = 'SEQ_' + ymd;
  var n = Number(p.getProperty(key) || 0) + 1;
  p.setProperty(key, String(n));
  return 'ORD-' + ymd + '-' + ('000' + n).slice(-4);
}

function milestonesFor_(order) {
  if (order.mode === 'LAUT') return MILESTONES.LAUT;
  return order.geo && order.geo.crossings && order.geo.crossings.length ? MILESTONES.DARAT : MILESTONES.DARAT_NO_FERRY;
}

function createOrder_(user, p) {
  if (user.role !== 'IDFOOD') throw new Error('Hanya akun ID FOOD yang dapat membuat order.');
  var req = { origin: p.origin, dest: p.dest, commodity: p.commodity };
  var q = quote_(req);
  var mode = p.mode === 'DARAT' ? 'DARAT' : 'LAUT';
  var md = q.modes[mode];
  if (!md.available) throw new Error('Moda ' + mode + ' tidak tersedia: ' + md.reason);
  var eq = md.equipment.filter(function (e) { return e.code === p.equipment; })[0];
  if (!eq || !eq.available) throw new Error('Armada tidak tersedia untuk rute ini.');
  var tier = p.tier === 'PRIME' ? 'PRIME' : 'REGULER';
  var t = tier === 'PRIME' ? eq.prime : eq.reguler, ti = tier === 'PRIME' ? eq.internal.prime : eq.internal.reguler;

  ['readyDate', 'loadAddress', 'unloadAddress', 'picName', 'picPhone'].forEach(function (f) {
    if (!String(p[f] || '').trim()) throw new Error('Field wajib belum diisi: ' + ({ readyDate: 'Tanggal siap muat', loadAddress: 'Alamat muat', unloadAddress: 'Alamat bongkar', picName: 'Nama PIC', picPhone: 'No. HP PIC' })[f]);
  });
  if (!/^[0-9+\-\s()]{8,20}$/.test(String(p.picPhone).trim())) throw new Error('Format No. HP PIC tidak valid.');

  var payloadKg = eq.payload * 1000, basis = p.basis === 'QTY' ? 'QTY' : 'UNIT';
  var qty = Number(p.qty), uom, units, totalKg, total, ppk = t.price / payloadKg;
  if (basis === 'UNIT') {
    units = Math.floor(qty);
    if (!(units >= 1 && units <= 500)) throw new Error('Jumlah unit harus 1–500.');
    qty = units; uom = 'UNIT'; totalKg = units * payloadKg; total = t.price * units;
  } else {
    uom = p.uom === 'KG' ? 'KG' : 'TON';
    if (!(qty > 0)) throw new Error('Kuantitas harus lebih dari 0.');
    totalKg = uom === 'TON' ? qty * 1000 : qty;
    total = Math.round(totalKg * ppk / 1000) * 1000;
    units = Math.ceil(totalKg / payloadKg);
  }
  var ready = new Date(String(p.readyDate) + 'T00:00:00+07:00');
  if (isNaN(ready)) throw new Error('Tanggal siap muat tidak valid.');
  var eta = new Date(ready.getTime() + t.leadMax * 864e5);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var no = nextOrderNo_();
    var segs = md.segments[tier === 'PRIME' ? 'prime' : 'reguler'];
    var buyer = null;
    if (q.dest.kind === 'BUYER') buyer = upsertBuyer_(q.dest, user);
    var order = {
      no: no, created_at: nowIso_(), updated_at: nowIso_(), status: 'Baru', milestoneIdx: 0,
      kanwil: q.kanwil, kanwilName: q.kanwilName, office: q.office, officeName: q.officeName, officeType: q.officeType, exec: null,
      origin: { id: q.origin.id, name: q.origin.name, city: q.origin.city, type: q.origin.type, lat: q.origin.lat, lon: q.origin.lon },
      dest: q.dest.kind === 'POINT' ? { kind: 'POINT', id: q.dest.id, name: q.dest.name, city: q.dest.city, type: q.dest.type, lat: q.dest.lat, lon: q.dest.lon, pic: pointById_(q.dest.id).pic || '', picPhone: pointById_(q.dest.id).picPhone || '' } : null,
      buyer: buyer, scheme: schemeOf_(q.origin.id, q.dest.kind === 'BUYER' ? { type: 'BUYER' } : q.dest.id),
      commodity: q.commodity, mode: mode, tier: tier, equipment: eq.code, equipmentName: eq.name,
      basis: basis, qty: qty, uom: uom, units: units, total_kg: totalKg, ton_per_unit: eq.payload,
      price_unit: t.price, price_per_kg: Math.round(ppk * 100) / 100, price_total: total,
      lead_min: t.leadMin, lead_max: t.leadMax, ready_date: String(p.readyDate), eta: eta.toISOString(),
      load_address: String(p.loadAddress).trim(), unload_address: String(p.unloadAddress).trim(),
      pic_name: String(p.picName).trim(), pic_phone: String(p.picPhone).trim(), po_ref: String(p.poRef || '').trim(), note: String(p.note || '').trim(),
      submitted_user: user.username, submitted_name: user.display, status_by: user.username,
      geo: {
        origin: [q.origin.lon, q.origin.lat], dest: [q.dest.lon, q.dest.lat],
        pol: mode === 'LAUT' ? [md.pol.lon, md.pol.lat] : null, pod: mode === 'LAUT' ? [md.pod.lon, md.pod.lat] : null,
        polName: mode === 'LAUT' ? md.pol.name + ', ' + md.pol.city : null, podName: mode === 'LAUT' ? md.pod.name + ', ' + md.pod.city : null,
        crossings: mode === 'DARAT' ? md.crossings : [], segments: segs
      },
      stages: md.stages[tier === 'PRIME' ? 'prime' : 'reguler'],
      internal: { mapping: md.internal[tier === 'PRIME' ? 'prime' : 'reguler'].mapping, cost_unit: ti.cost, cost_total: Math.round(ti.cost * (basis === 'UNIT' ? units : totalKg / payloadKg)),
                  margin_pct: ti.marginPct, margin_total: Math.round(total - ti.cost * (basis === 'UNIT' ? units : totalKg / payloadKg)), breakdown: ti.breakdown },
      history: [{ at: nowIso_(), by: user.username, byName: user.display, milestone: 'Baru', note: 'Order dibuat dan diteruskan ke ' + (q.officeType === 'KANWIL' ? q.kanwilName : q.officeName + ' (monitor: ' + q.kanwilName + ')') }]
    };
    writeOrder_(order, null);
    audit_(user.username, 'CREATE_ORDER', no, { kanwil: order.kanwil, total: total });
    return sanitizeOrder_(decorate_(order), user);
  } finally { lock.releaseLock(); }
}

function upsertBuyer_(d, user) {
  var sh = sheet_('Buyers');
  var key = d.name.toLowerCase().replace(/\s+/g, ' ') + '|' + d.lat.toFixed(3) + '|' + d.lon.toFixed(3);
  var vals = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues() : [];
  for (var i = 0; i < vals.length; i++) {
    var k = String(vals[i][1]).toLowerCase().replace(/\s+/g, ' ') + '|' + Number(vals[i][3]).toFixed(3) + '|' + Number(vals[i][4]).toFixed(3);
    if (k === key) return { id: vals[i][0], name: vals[i][1], city: vals[i][2], lat: Number(vals[i][3]), lon: Number(vals[i][4]), island: d.island, servicePort: d.servicePort, servicePortName: d.servicePortName, source: d.source };
  }
  var id = 'B' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
  sh.appendRow([id, d.name, d.city, d.lat, d.lon, d.island, d.servicePort, d.source, user.username, nowIso_()]);
  return { id: id, name: d.name, city: d.city, lat: d.lat, lon: d.lon, island: d.island, servicePort: d.servicePort, servicePortName: d.servicePortName, source: d.source };
}

function orderRow_(o) {
  return [o.no, o.created_at, o.updated_at, o.status, o.kanwil + (o.office && o.office.indexOf('KW-') !== 0 ? ' · ' + o.officeName : ''), o.submitted_user, o.status_by, o.origin.name,
          o.dest ? o.dest.name : 'Buyer: ' + o.buyer.name + ' (' + o.buyer.city + ')', o.commodity, o.mode, o.tier, o.equipment,
          o.basis, o.qty, o.uom, o.units, o.total_kg, o.price_unit, o.price_total, o.lead_min, o.lead_max, o.ready_date, o.eta,
          JSON.stringify(o)];
}

function writeOrder_(o, row) {
  var sh = sheet_('Orders');
  var r = orderRow_(o);
  if (row) sh.getRange(row, 1, 1, r.length).setValues([r]);
  else sh.appendRow(r);
  CacheService.getScriptCache().remove('orders_v');
}

function readOrders_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('orders_v');
  if (c) { try { return JSON.parse(c); } catch (e) { } }
  var sh = sheet_('Orders'), last = sh.getLastRow();
  if (last < 2) return [];
  var jsonCol = SHEETS_.Orders.length;
  var vals = sh.getRange(2, jsonCol, last - 1, 1).getValues();
  var list = [];
  vals.forEach(function (v, i) { try { var o = JSON.parse(v[0]); o._row = i + 2; list.push(o); } catch (e) { } });
  try { var s = JSON.stringify(list); if (s.length < 95000) cache.put('orders_v', s, 120); } catch (e) { }
  return list;
}

function findOrder_(no) {
  var list = readOrders_();
  for (var i = 0; i < list.length; i++) if (list[i].no === no) return list[i];
  throw new Error('Order tidak ditemukan: ' + no);
}

function decorate_(o) {
  if (!o.office) { o.office = 'KW-' + o.kanwil; o.officeName = KANWIL[o.kanwil]; o.officeType = 'KANWIL'; }
  var ms = milestonesFor_(o);
  o.milestones = ms;
  o.phase = o.status === 'Ditolak' ? 'DITOLAK' : o.status === 'Terkirim' ? 'TERKIRIM' : o.status === 'Baru' ? 'BARU' : 'PROSES';
  var etaMs = new Date(o.eta).getTime();
  o.late = (o.phase === 'BARU' || o.phase === 'PROSES') && Date.now() > etaMs + CONFIG.LATE_GRACE_DAYS * 864e5;
  o.slaBreach = o.phase === 'BARU' && Date.now() - new Date(o.created_at).getTime() > CONFIG.SLA_CONFIRM_HOURS * 36e5;
  return o;
}

function sanitizeOrder_(o, user) {
  var x = JSON.parse(JSON.stringify(o));
  delete x._row;
  if (user.role === 'IDFOOD') {
    delete x.internal;
    if (x.geo && x.geo.segments) x.geo.segments.forEach(function (s) { if (s.type === 'sea' && x.geo.pol) s.coords = [x.geo.pol, x.geo.pod]; });
    if (x.stages) x.stages.forEach(function (s) { delete s.internalDetail; });
    if (x.exec) ['carrier', 'vessel', 'voyage', 'bl', 'vendor', 'truckVendor'].forEach(function (k) { delete x.exec[k]; });
  } else if (user.role === 'KANWIL' || user.role === 'CABANG') {
    if (x.internal) { delete x.internal.margin_pct; delete x.internal.margin_total; }
  }
  x.canExecute = canExecute_(user, o);
  return x;
}

function listOrders_(user) {
  var list = readOrders_().filter(function (o) {
    if (user.role === 'IDFOOD') return o.submitted_user === user.username;
    if (user.role === 'KANWIL') return o.kanwil === user.kanwil;
    if (user.role === 'CABANG') return o.office === user.branch;
    return true;
  });
  list.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  return list.map(function (o) { return sanitizeOrder_(decorate_(o), user); });
}

function updateOrder_(user, p) {
  if (user.role !== 'KANWIL' && user.role !== 'CABANG') throw new Error('Hanya kantor BLI pelaksana yang dapat memperbarui order.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    CacheService.getScriptCache().remove('orders_v');
    var o = findOrder_(p.no);
    decorate_(o);
    if (!canExecute_(user, o)) throw new Error(user.role === 'KANWIL' && o.kanwil === user.kanwil
      ? 'Order ini dieksekusi ' + o.officeName + '. Kanwil hanya memonitor.' : 'Order ini bukan tanggung jawab ' + user.display + '.');
    if (o.status === 'Ditolak' || o.status === 'Terkirim') throw new Error('Order sudah ' + o.status + '.');
    var ms = milestonesFor_(o);
    var hasMs = p.milestoneIdx !== null && p.milestoneIdx !== undefined && p.milestoneIdx !== '';
    var idx = hasMs ? Number(p.milestoneIdx) : o.milestoneIdx;
    if (hasMs && !(idx > o.milestoneIdx && idx < ms.length)) throw new Error('Pilih milestone setelah posisi saat ini (' + o.status + ').');
    var ex = p.exec ? normalizeExec_(o, p.exec) : (o.exec || null);
    validateExec_(o, ex, ms[idx], ms);
    if (!hasMs && !p.exec) throw new Error('Tidak ada perubahan untuk disimpan.');
    var row = o._row; delete o._row;
    ['milestones', 'phase', 'late', 'slaBreach'].forEach(function (k) { delete o[k]; });
    if (p.exec) { ex.updated_at = nowIso_(); ex.updated_by = user.display; o.exec = ex; }
    o.updated_at = nowIso_(); o.status_by = user.username;
    if (hasMs) { o.milestoneIdx = idx; o.status = ms[idx]; }
    var note = String(p.note || '').trim();
    o.history.push({ at: nowIso_(), by: user.username, byName: user.display, milestone: hasMs ? ms[idx] : o.status,
                     note: (note ? note : '') + (p.exec ? (note ? ' · ' : '') + 'Data eksekusi ' + (o.mode === 'LAUT' ? 'kontainer' : 'armada') + ' diperbarui' : '') });
    writeOrder_(o, row);
    audit_(user.username, 'UPDATE_ORDER', o.no, { status: o.status, exec: !!p.exec });
    return sanitizeOrder_(decorate_(o), user);
  } finally { lock.releaseLock(); }
}

/* ---------------------------------------------- DATA EKSEKUSI (kontainer / armada) */

var ISO6346_ = (function () {
  var m = {}, v = 10;
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (c) { if (v % 11 === 0) v++; m[c] = v++; });
  return m;
})();
/** Validasi nomor kontainer ISO 6346: 4 huruf (akhiran U/J/Z) + 6 digit + 1 cek digit. */
function containerOk_(no) {
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(no)) return false;
  var sum = 0;
  for (var i = 0; i < 10; i++) { var c = no.charAt(i); sum += (i < 4 ? ISO6346_[c] : Number(c)) * Math.pow(2, i); }
  return (sum % 11) % 10 === Number(no.charAt(10));
}
function cleanStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80); }
function normalizeExec_(o, e) {
  if (o.mode === 'LAUT') {
    return {
      carrier: cleanStr_(e.carrier), vessel: cleanStr_(e.vessel), voyage: cleanStr_(e.voyage, 30), bl: cleanStr_(e.bl, 40),
      etd: cleanStr_(e.etd, 10), etaVessel: cleanStr_(e.etaVessel, 10), truckVendor: cleanStr_(e.truckVendor),
      containers: (e.containers || []).slice(0, 500).map(function (c) {
        return { no: cleanStr_(c.no, 20).toUpperCase().replace(/[\s\-\.]/g, ''), seal: cleanStr_(c.seal, 30).toUpperCase(),
                 truck: cleanStr_(c.truck, 20).toUpperCase(), driver: cleanStr_(c.driver, 60), phone: cleanStr_(c.phone, 20) };
      }).filter(function (c) { return c.no || c.seal || c.truck || c.driver || c.phone; })
    };
  }
  return {
    vendor: cleanStr_(e.vendor), departDate: cleanStr_(e.departDate, 10),
    units: (e.units || []).slice(0, 500).map(function (u) {
      return { plate: cleanStr_(u.plate, 20).toUpperCase(), driver: cleanStr_(u.driver, 60), phone: cleanStr_(u.phone, 20) };
    }).filter(function (u) { return u.plate || u.driver || u.phone; })
  };
}
/** Data wajib bertahap: armada/kontainer sebelum "Muat di titik asal", kapal sebelum "Berlayar". */
function validateExec_(o, ex, target, ms) {
  var phoneRe = /^[0-9+\-\s()]{8,20}$/;
  var reachLoad = ms.indexOf(target) >= ms.indexOf('Muat di titik asal');
  if (o.mode === 'LAUT') {
    var list = (ex && ex.containers) || [];
    var seen = {};
    list.forEach(function (c, i) {
      if (!c.no) throw new Error('Kontainer #' + (i + 1) + ': nomor kontainer belum diisi.');
      if (!containerOk_(c.no)) throw new Error('Nomor kontainer ' + c.no + ' tidak valid (format ISO 6346, mis. MSKU1234565; cek digit terakhir).');
      if (seen[c.no]) throw new Error('Nomor kontainer ' + c.no + ' tercatat dua kali.');
      seen[c.no] = 1;
      if (c.phone && !phoneRe.test(c.phone)) throw new Error('No. HP supir kontainer ' + c.no + ' tidak valid.');
    });
    if (reachLoad && !list.length) throw new Error('Isi nomor kontainer (minimal 1) sebelum status "' + target + '".');
    if (ms.indexOf(target) >= ms.indexOf('Berlayar') && (!ex || !ex.vessel || !ex.voyage)) throw new Error('Isi nama kapal dan no. voyage sebelum status "' + target + '".');
  } else {
    var units = (ex && ex.units) || [];
    units.forEach(function (u, i) {
      if (!u.plate || !u.driver || !u.phone) throw new Error('Armada #' + (i + 1) + ': no. polisi, nama supir, dan no. HP supir wajib diisi.');
      if (!phoneRe.test(u.phone)) throw new Error('No. HP supir ' + u.driver + ' tidak valid.');
    });
    if (reachLoad && !units.length) throw new Error('Isi data armada (no. polisi, supir, HP) sebelum status "' + target + '".');
  }
}

function rejectOrder_(user, p) {
  if (user.role !== 'KANWIL' && user.role !== 'CABANG') throw new Error('Hanya kantor BLI pelaksana yang dapat menolak order.');
  var reason = String(p.reason || '').trim();
  if (!reason) throw new Error('Alasan penolakan wajib diisi.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    CacheService.getScriptCache().remove('orders_v');
    var o = findOrder_(p.no);
    decorate_(o);
    if (!canExecute_(user, o)) throw new Error(user.role === 'KANWIL' && o.kanwil === user.kanwil
      ? 'Order ini dieksekusi ' + o.officeName + '. Kanwil hanya memonitor.' : 'Order ini bukan tanggung jawab ' + user.display + '.');
    if (o.status !== 'Baru') throw new Error('Hanya order berstatus Baru yang dapat ditolak.');
    var row = o._row; delete o._row;
    ['milestones', 'phase', 'late', 'slaBreach'].forEach(function (k) { delete o[k]; });
    o.status = 'Ditolak'; o.updated_at = nowIso_(); o.status_by = user.username;
    o.history.push({ at: nowIso_(), by: user.username, byName: user.display, milestone: 'Ditolak', note: reason });
    writeOrder_(o, row);
    audit_(user.username, 'REJECT_ORDER', o.no, reason);
    return sanitizeOrder_(decorate_(o), user);
  } finally { lock.releaseLock(); }
}
