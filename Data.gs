/**
 * ============================================================================
 *  Integrated Logistics Network Dashboard (ILND) · BGR Logistik Indonesia
 *  File   : Data.gs  — KONFIGURASI & MASTER DATA (dummy, sesuai PRD v0.7)
 *  Versi  : 0.7-gas.1
 *
 *  Semua angka bisnis (margin, surcharge, tarif armada, payload) dan master
 *  data (titik, pelabuhan, layanan kapal, lane, kota) ada di file ini.
 *  Ubah di sini → simpan → Deploy ulang (Manage deployments → Edit → New version).
 * ============================================================================
 */

var CONFIG = {
  APP_NAME: 'Integrated Logistics Network Dashboard',
  ORG_NAME: 'BGR Logistik Indonesia',
  APP_VERSION: '0.7',

  // true  = halaman login menampilkan akun demo + password (HANYA untuk demo)
  // false = daftar akun demo disembunyikan (wajib untuk produksi)
  DEMO_MODE: true,

  // Logo resmi BGR LI sudah tertanam di Index.html. Isi URL ini hanya bila ingin
  // menggantinya dengan file lain (PNG/SVG, akses publik).
  LOGO_URL: '',

  // ID Spreadsheet database. Kosongkan → dibuat otomatis saat pertama dijalankan
  // (ID tersimpan di Script Properties dengan key DB_ID).
  SPREADSHEET_ID: '',

  // ---- Logika harga (parameter dummy, finalkan dengan tim komersial) ----
  FEE_MARGIN: 0.06,             // fee margin BLI atas biaya pokok
  PRIME_SURCHARGE: 0.12,        // surcharge Prime atas ocean freight
  PRIME_FASTTRACK_IDR: 750000,  // biaya fast-track Prime
  PRIME_MIN_MULTIPLIER: 1.10,   // Prime minimal 1,1 × harga Reguler
  DOC_SEAL_IDR: 250000,         // dokumen + seal per kontainer
  OF_BASE_IDR: 2200000,         // ocean freight dasar (20 ft)
  OF_PER_NM_IDR: 7000,          // ocean freight per nautical mile (20 ft)
  WESTBOUND_FACTOR: 0.72,       // faktor arah ke barat (backhaul)
  SEA_DETOUR: 1.18,             // jarak laut = garis lurus × faktor ini
  SHIP_SPEED_KNOT: 12.5,
  DAYS_PER_CALL: 0.8,           // tambahan hari per pelabuhan singgah
  TRANSSHIP_DWELL_DAYS: 1.0,
  HANDLING_REGULER_DAYS: 3.5,
  HANDLING_PRIME_DAYS: 2.5,
  THC_BY_CLASS: { A: 1250000, B: 1000000, C: 850000 }, // THC per 20 ft
  TRUCK_SEA_DETOUR: 1.30,       // first/last mile: jarak darat = garis lurus × 1,3
  TRUCK_SEA_KMPD: 350,          // first/last mile: km per hari
  LAND_DETOUR: 1.35,            // darat murni: jarak darat = garis lurus × 1,35
  LAND_REG_KMPD: 450,
  LAND_PRIME_KMPD: 650,
  LAND_PRIME_MULTIPLIER: 1.18,
  LAND_WAIT_MAX_DAYS: 2,
  ROAD_ALLOWANCE_IDR: 250000,   // uang jalan per 600 km
  ROAD_ALLOWANCE_KM: 600,
  DENSITY_T_PER_M3: { GULA: 0.75, MINYAK: 0.55 },

  // ---- Operasional ----
  SLA_CONFIRM_HOURS: 24,        // order Baru > SLA → "Perlu perhatian"
  LATE_GRACE_DAYS: 1,           // terlambat bila belum terkirim > ETA + 1 hari
  SESSION_HOURS: 6,             // sesi tanpa "Ingat saya"
  REMEMBER_DAYS: 30,            // sesi dengan "Ingat saya"
  MAX_LOGIN_ATTEMPTS: 5,        // batas percobaan login
  LOCKOUT_MINUTES: 10,
  TIMEZONE: 'Asia/Jakarta'
};

var KANWIL = {
  MDN: 'Kanwil Medan',
  PLG: 'Kanwil Palembang',
  DKI: 'Kanwil DKI Jakarta',
  SBY: 'Kanwil Surabaya',
  MKS: 'Kanwil Makassar',
  MTR: 'Kanwil Mataram'
};

/**
 * Akun awal. Password di sini HANYA dipakai saat setup untuk membuat hash
 * (disimpan di sheet Users). Setelah setup, ganti password lewat fungsi
 * adminSetPassword('username','PasswordBaru') di editor Apps Script.
 */
var USERS_SEED = [
  { username: 'scm.idfood',       password: 'IDFood@2026', display: 'Tim SCM ID FOOD Pusat',   role: 'IDFOOD',        kanwil: '',    branch: 'Pusat' },
  { username: 'scm.ppi',          password: 'PPI@2026',    display: 'SCM PPI (Cabang)',        role: 'IDFOOD',        kanwil: '',    branch: 'PPI' },
  { username: 'kanwil.medan',     password: 'Kanwil@2026', display: 'Kanwil Medan',            role: 'KANWIL',        kanwil: 'MDN', branch: '' },
  { username: 'kanwil.palembang', password: 'Kanwil@2026', display: 'Kanwil Palembang',        role: 'KANWIL',        kanwil: 'PLG', branch: '' },
  { username: 'kanwil.dki',       password: 'Kanwil@2026', display: 'Kanwil DKI Jakarta',      role: 'KANWIL',        kanwil: 'DKI', branch: '' },
  { username: 'kanwil.surabaya',  password: 'Kanwil@2026', display: 'Kanwil Surabaya',         role: 'KANWIL',        kanwil: 'SBY', branch: '' },
  { username: 'kanwil.makassar',  password: 'Kanwil@2026', display: 'Kanwil Makassar',         role: 'KANWIL',        kanwil: 'MKS', branch: '' },
  { username: 'kanwil.mataram',   password: 'Kanwil@2026', display: 'Kanwil Mataram',          role: 'KANWIL',        kanwil: 'MTR', branch: '' },
  { username: 'ct.pusat',         password: 'Pusat@2026',  display: 'Control Tower Kantor Pusat', role: 'CONTROL_TOWER', kanwil: '', branch: 'Pusat' }
];

/** Pulau → wilayah (untuk faktor harga, aturan Kanwil, dan ketersediaan darat) */
var ISLAND_REGION = {
  Sumatera: 'Sumatera', Bangka: 'Sumatera', Belitung: 'Sumatera', Batam: 'Sumatera',
  Jawa: 'Jawa', Bali: 'Bali', Lombok: 'NTB', Sumbawa: 'NTB',
  Flores: 'NTT', Timor: 'NTT', Sumba: 'NTT', Alor: 'NTT',
  Kalimantan: 'Kalimantan', Tarakan: 'Kalimantan',
  Sulawesi: 'Sulawesi', Buton: 'Sulawesi',
  Maluku: 'Maluku', Ternate: 'Maluku', Kei: 'Maluku', Tanimbar: 'Maluku',
  Papua: 'Papua', Biak: 'Papua'
};

/** Faktor wilayah tujuan untuk ocean freight */
var REGION_FACTOR = {
  Jawa: 1.00, Sumatera: 1.05, Kalimantan: 1.05, Bali: 1.08, NTB: 1.12,
  Sulawesi: 1.10, NTT: 1.25, Maluku: 1.30, Papua: 1.45
};

/** Rantai pulau yang tersambung RoRo (urutan barat → timur) */
var RORO_CHAIN = ['Sumatera', 'Jawa', 'Bali', 'Lombok'];
var RORO_CROSSINGS = [ // penyeberangan antara RORO_CHAIN[i] dan RORO_CHAIN[i+1]
  { name: 'Bakauheni – Merak',    a: { name: 'Bakauheni', lat: -5.872, lon: 105.752 }, b: { name: 'Merak',    lat: -5.931, lon: 106.004 } },
  { name: 'Ketapang – Gilimanuk', a: { name: 'Ketapang',  lat: -8.143, lon: 114.398 }, b: { name: 'Gilimanuk', lat: -8.165, lon: 114.437 } },
  { name: 'Padangbai – Lembar',   a: { name: 'Padangbai', lat: -8.531, lon: 115.509 }, b: { name: 'Lembar',    lat: -8.729, lon: 116.074 } }
];

/** Pelabuhan domestik: [kode, nama, kota, lat, lon, kelas, pulau] — 57 pelabuhan */
var PORTS = [
  ['IDTPP', 'Tanjung Priok', 'Jakarta', -6.104, 106.883, 'A', 'Jawa'],
  ['IDSUB', 'Tanjung Perak', 'Surabaya', -7.198, 112.732, 'A', 'Jawa'],
  ['IDSRG', 'Tanjung Emas', 'Semarang', -6.945, 110.423, 'A', 'Jawa'],
  ['IDCXP', 'Tanjung Intan', 'Cilacap', -7.738, 109.008, 'B', 'Jawa'],
  ['IDCBN', 'Cirebon', 'Cirebon', -6.712, 108.569, 'C', 'Jawa'],
  ['IDTWA', 'Tanjung Wangi', 'Banyuwangi', -8.138, 114.398, 'C', 'Jawa'],
  ['IDCIW', 'Ciwandan', 'Cilegon', -6.022, 105.958, 'B', 'Jawa'],
  ['IDBLW', 'Belawan', 'Medan', 3.787, 98.690, 'A', 'Sumatera'],
  ['IDKTJ', 'Kuala Tanjung', 'Batubara', 3.362, 99.461, 'B', 'Sumatera'],
  ['IDLSW', 'Krueng Geukueh', 'Lhokseumawe', 5.245, 97.031, 'C', 'Sumatera'],
  ['IDMLH', 'Malahayati', 'Banda Aceh', 5.594, 95.513, 'C', 'Sumatera'],
  ['IDDUM', 'Dumai', 'Dumai', 1.685, 101.453, 'B', 'Sumatera'],
  ['IDTLB', 'Teluk Bayur', 'Padang', -1.000, 100.370, 'B', 'Sumatera'],
  ['IDDJB', 'Talang Duku', 'Jambi', -1.580, 103.720, 'C', 'Sumatera'],
  ['IDPLM', 'Boom Baru', 'Palembang', -2.977, 104.776, 'B', 'Sumatera'],
  ['IDBKS', 'Pulau Baai', 'Bengkulu', -3.900, 102.300, 'C', 'Sumatera'],
  ['IDPNJ', 'Panjang', 'Bandar Lampung', -5.475, 105.322, 'B', 'Sumatera'],
  ['IDBTH', 'Batu Ampar', 'Batam', 1.159, 104.010, 'B', 'Batam'],
  ['IDPGX', 'Pangkal Balam', 'Pangkalpinang', -2.100, 106.140, 'C', 'Bangka'],
  ['IDTJQ', 'Tanjung Pandan', 'Belitung', -2.740, 107.630, 'C', 'Belitung'],
  ['IDPNK', 'Dwikora', 'Pontianak', -0.020, 109.337, 'B', 'Kalimantan'],
  ['IDKTG', 'Ketapang', 'Ketapang', -1.830, 109.970, 'C', 'Kalimantan'],
  ['IDKUM', 'Kumai', 'Kotawaringin Barat', -2.740, 111.730, 'C', 'Kalimantan'],
  ['IDSMQ', 'Sampit', 'Kotawaringin Timur', -2.550, 112.960, 'C', 'Kalimantan'],
  ['IDBDJ', 'Trisakti', 'Banjarmasin', -3.329, 114.566, 'B', 'Kalimantan'],
  ['IDBPN', 'Semayang', 'Balikpapan', -1.262, 116.805, 'A', 'Kalimantan'],
  ['IDSRI', 'Palaran', 'Samarinda', -0.580, 117.180, 'B', 'Kalimantan'],
  ['IDBXT', 'Lok Tuan', 'Bontang', 0.100, 117.490, 'C', 'Kalimantan'],
  ['IDTRK', 'Malundung', 'Tarakan', 3.290, 117.580, 'C', 'Tarakan'],
  ['IDBOA', 'Benoa', 'Denpasar', -8.745, 115.210, 'B', 'Bali'],
  ['IDLEM', 'Lembar', 'Lombok Barat', -8.729, 116.074, 'C', 'Lombok'],
  ['IDBMU', 'Bima', 'Bima', -8.450, 118.720, 'C', 'Sumbawa'],
  ['IDLBJ', 'Labuan Bajo', 'Manggarai Barat', -8.490, 119.880, 'C', 'Flores'],
  ['IDENE', 'Ende', 'Ende', -8.850, 121.650, 'C', 'Flores'],
  ['IDMOF', 'Lorens Say', 'Maumere', -8.620, 122.210, 'C', 'Flores'],
  ['IDKOE', 'Tenau', 'Kupang', -10.200, 123.530, 'B', 'Timor'],
  ['IDWGP', 'Waingapu', 'Sumba Timur', -9.650, 120.260, 'C', 'Sumba'],
  ['IDKLB', 'Kalabahi', 'Alor', -8.220, 124.520, 'C', 'Alor'],
  ['IDMAK', 'Soekarno-Hatta', 'Makassar', -5.115, 119.407, 'A', 'Sulawesi'],
  ['IDPRE', 'Nusantara', 'Parepare', -4.010, 119.620, 'C', 'Sulawesi'],
  ['IDKDI', 'Bungkutoko', 'Kendari', -3.970, 122.590, 'C', 'Sulawesi'],
  ['IDBUW', 'Murhum', 'Baubau', -5.460, 122.610, 'C', 'Buton'],
  ['IDPLW', 'Pantoloan', 'Palu', -0.710, 119.860, 'C', 'Sulawesi'],
  ['IDLUW', 'Luwuk', 'Banggai', -0.950, 122.790, 'C', 'Sulawesi'],
  ['IDGTO', 'Gorontalo', 'Gorontalo', 0.500, 123.060, 'C', 'Sulawesi'],
  ['IDBIT', 'Bitung', 'Bitung', 1.441, 125.193, 'A', 'Sulawesi'],
  ['IDAMQ', 'Yos Sudarso', 'Ambon', -3.690, 128.180, 'B', 'Maluku'],
  ['IDTTE', 'Ahmad Yani', 'Ternate', 0.780, 127.380, 'C', 'Ternate'],
  ['IDTUA', 'Tual', 'Maluku Tenggara', -5.630, 132.750, 'C', 'Kei'],
  ['IDSXK', 'Saumlaki', 'Kepulauan Tanimbar', -7.980, 131.300, 'C', 'Tanimbar'],
  ['IDSOQ', 'Sorong', 'Sorong', -0.880, 131.250, 'B', 'Papua'],
  ['IDMKW', 'Manokwari', 'Manokwari', -0.860, 134.080, 'C', 'Papua'],
  ['IDBIK', 'Biak', 'Biak Numfor', -1.180, 136.080, 'C', 'Biak'],
  ['IDNBX', 'Nabire', 'Nabire', -3.360, 135.500, 'C', 'Papua'],
  ['IDDJJ', 'Jayapura', 'Jayapura', -2.540, 140.710, 'B', 'Papua'],
  ['IDFKQ', 'Fakfak', 'Fakfak', -2.920, 132.300, 'C', 'Papua'],
  ['IDTIM', 'Amamapare', 'Mimika', -4.820, 136.890, 'C', 'Papua'],
  ['IDMKQ', 'Merauke', 'Merauke', -8.480, 140.380, 'C', 'Papua']
];

/**
 * Layanan kapal domestik (INTERNAL, rotasi indikatif / dummy).
 * rot = urutan singgah (pendulum: kembali lewat urutan terbalik)
 * freq = frekuensi (hari), factor = faktor tarif pelayaran, tolLaut = layanan Tol Laut
 */
var SERVICES = [
  { id: 'MRT-1', carrier: 'Meratus Line',        rot: ['IDSUB', 'IDMAK', 'IDBIT', 'IDAMQ', 'IDSOQ', 'IDDJJ'], freq: 7,  factor: 1.00, tolLaut: false },
  { id: 'MRT-2', carrier: 'Meratus Line',        rot: ['IDSUB', 'IDBPN', 'IDSRI', 'IDBXT', 'IDTRK'],          freq: 7,  factor: 1.00, tolLaut: false },
  { id: 'SPL-1', carrier: 'SPIL',                rot: ['IDTPP', 'IDSUB', 'IDMAK', 'IDKDI', 'IDBUW'],          freq: 7,  factor: 0.97, tolLaut: false },
  { id: 'SPL-2', carrier: 'SPIL',                rot: ['IDTPP', 'IDBTH', 'IDDUM', 'IDBLW'],                   freq: 7,  factor: 0.97, tolLaut: false },
  { id: 'SPL-3', carrier: 'SPIL',                rot: ['IDSUB', 'IDBDJ', 'IDSMQ', 'IDKUM'],                   freq: 7,  factor: 0.97, tolLaut: false },
  { id: 'SPL-4', carrier: 'SPIL',                rot: ['IDBLW', 'IDKTJ', 'IDLSW', 'IDMLH'],                   freq: 10, factor: 0.97, tolLaut: false },
  { id: 'TNT-1', carrier: 'Tanto Intim Line',    rot: ['IDTPP', 'IDPNK', 'IDKTG'],                            freq: 5,  factor: 1.02, tolLaut: false },
  { id: 'TNT-2', carrier: 'Tanto Intim Line',    rot: ['IDSUB', 'IDBOA', 'IDLEM', 'IDBMU', 'IDLBJ', 'IDKOE'], freq: 10, factor: 1.02, tolLaut: false },
  { id: 'TMS-1', carrier: 'Temas Line',          rot: ['IDTPP', 'IDPLM', 'IDPGX', 'IDTJQ'],                   freq: 7,  factor: 0.99, tolLaut: false },
  { id: 'TMS-2', carrier: 'Temas Line',          rot: ['IDTPP', 'IDPNJ', 'IDBKS', 'IDTLB'],                   freq: 10, factor: 0.99, tolLaut: false },
  { id: 'TMS-3', carrier: 'Temas Line',          rot: ['IDTPP', 'IDDJB', 'IDBTH'],                            freq: 10, factor: 0.99, tolLaut: false },
  { id: 'SMD-1', carrier: 'Samudera Indonesia',  rot: ['IDCIW', 'IDTPP', 'IDSRG', 'IDSUB', 'IDBPN'],          freq: 4,  factor: 1.05, tolLaut: false },
  { id: 'SMD-2', carrier: 'Samudera Indonesia',  rot: ['IDBLW', 'IDTPP', 'IDSUB', 'IDMAK'],                   freq: 7,  factor: 1.05, tolLaut: false },
  { id: 'SMD-3', carrier: 'Samudera Indonesia',  rot: ['IDSUB', 'IDMAK', 'IDPRE', 'IDPLW', 'IDGTO', 'IDBIT'], freq: 10, factor: 1.05, tolLaut: false },
  { id: 'MNT-1', carrier: 'Mentari Line',        rot: ['IDSUB', 'IDAMQ', 'IDTUA', 'IDFKQ', 'IDTIM', 'IDMKQ'], freq: 14, factor: 1.03, tolLaut: false },
  { id: 'MNT-2', carrier: 'Mentari Line',        rot: ['IDSUB', 'IDSOQ', 'IDMKW', 'IDBIK', 'IDNBX', 'IDDJJ'], freq: 14, factor: 1.03, tolLaut: false },
  { id: 'TOL-1', carrier: 'Tol Laut (Pelni)',    rot: ['IDSUB', 'IDKOE', 'IDWGP', 'IDKLB', 'IDSXK', 'IDTUA'], freq: 10, factor: 0.80, tolLaut: true },
  { id: 'TOL-2', carrier: 'Tol Laut (Pelni)',    rot: ['IDMAK', 'IDLUW', 'IDTTE', 'IDSOQ'],                   freq: 14, factor: 0.80, tolLaut: true },
  { id: 'TOL-3', carrier: 'Tol Laut (Pelni)',    rot: ['IDSUB', 'IDENE', 'IDMOF', 'IDKOE'],                   freq: 14, factor: 0.80, tolLaut: true }
];

/**
 * Armada (PRD: Moda darat dan pilihan armada).
 * payload = muatan acuan (ton) per komoditas; base/perKm = tarif darat dummy;
 * seaF = faktor ocean freight thd 20 ft; thcF = faktor THC; ferry = tiket RoRo per armada
 */
var EQUIPMENT = [
  { code: 'CDE',     name: 'CDE (Colt Diesel Engkel)', short: 'CDE',       maxTon: 2.2, m3: 9,  payload: { GULA: 2,   MINYAK: 2 },   modes: ['DARAT'],         base: 600000,  perKm: 4500,  ferry: 650000,  seaF: 0,    thcF: 0 },
  { code: 'CDD',     name: 'CDD (Colt Diesel Double)', short: 'CDD',       maxTon: 4.5, m3: 16, payload: { GULA: 4.5, MINYAK: 4.5 }, modes: ['DARAT'],         base: 800000,  perKm: 6000,  ferry: 900000,  seaF: 0,    thcF: 0 },
  { code: 'FUSO',    name: 'Fuso / medium truck',      short: 'Fuso',      maxTon: 8,   m3: 24, payload: { GULA: 8,   MINYAK: 8 },   modes: ['DARAT'],         base: 1000000, perKm: 8500,  ferry: 1350000, seaF: 0,    thcF: 0 },
  { code: 'TRONTON', name: 'Tronton bak',              short: 'Tronton',   maxTon: 15,  m3: 36, payload: { GULA: 15,  MINYAK: 15 },  modes: ['DARAT'],         base: 1300000, perKm: 11000, ferry: 1900000, seaF: 0,    thcF: 0 },
  { code: 'WINGBOX', name: 'Tronton wingbox',          short: 'Wingbox',   maxTon: 22,  m3: 50, payload: { GULA: 22,  MINYAK: 22 },  modes: ['DARAT'],         base: 1500000, perKm: 12500, ferry: 2300000, seaF: 0,    thcF: 0 },
  { code: 'C20',     name: 'Kontainer 20 ft (20GP)',   short: '20 ft',     maxTon: 22,  m3: 33, payload: { GULA: 22,  MINYAK: 18 },  modes: ['DARAT', 'LAUT'], base: 1200000, perKm: 14000, ferry: 2100000, seaF: 1.00, thcF: 1.00 },
  { code: 'C40',     name: 'Kontainer 40 ft (40GP)',   short: '40 ft',     maxTon: 26,  m3: 67, payload: { GULA: 26,  MINYAK: 26 },  modes: ['DARAT', 'LAUT'], base: 1560000, perKm: 18200, ferry: 2900000, seaF: 1.62, thcF: 1.50 },
  { code: 'C40HC',   name: 'Kontainer 40 ft High Cube', short: '40 ft HC', maxTon: 26,  m3: 76, payload: { GULA: 26,  MINYAK: 26 },  modes: ['DARAT', 'LAUT'], base: 1620000, perKm: 18900, ferry: 3000000, seaF: 1.72, thcF: 1.55 },
  { code: 'C45HC',   name: 'Kontainer 45 ft High Cube', short: '45 ft HC', maxTon: 27,  m3: 86, payload: { GULA: 27,  MINYAK: 27 },  modes: ['DARAT', 'LAUT'], base: 1740000, perKm: 20300, ferry: 3300000, seaF: 1.95, thcF: 1.75, portClassRequired: 'A' }
];

/** Titik ID FOOD (dummy): 7 Supplier, 4 Repacker, 16 Cabang PPI/Nusindo */
var POINTS = [
  { id: 'S01', type: 'SUPPLIER', name: 'Supplier Gula A',   entity: 'Supplier', city: 'Sidoarjo',        island: 'Jawa',       lat: -7.447, lon: 112.718, commodities: ['GULA'] },
  { id: 'S02', type: 'SUPPLIER', name: 'Supplier Gula B',   entity: 'Supplier', city: 'Lampung Tengah',  island: 'Sumatera',   lat: -4.850, lon: 105.220, commodities: ['GULA'] },
  { id: 'S03', type: 'SUPPLIER', name: 'Supplier Minyak A', entity: 'Supplier', city: 'Dumai',           island: 'Sumatera',   lat: 1.660,  lon: 101.430, commodities: ['MINYAK'] },
  { id: 'S04', type: 'SUPPLIER', name: 'Supplier Minyak B', entity: 'Supplier', city: 'Deli Serdang',    island: 'Sumatera',   lat: 3.700,  lon: 98.700,  commodities: ['MINYAK'] },
  { id: 'S05', type: 'SUPPLIER', name: 'Supplier Gula C',   entity: 'Supplier', city: 'Cilegon',         island: 'Jawa',       lat: -6.010, lon: 106.050, commodities: ['GULA'] },
  { id: 'S06', type: 'SUPPLIER', name: 'Supplier Minyak C', entity: 'Supplier', city: 'Bekasi',          island: 'Jawa',       lat: -6.300, lon: 107.150, commodities: ['MINYAK'] },
  { id: 'S07', type: 'SUPPLIER', name: 'Supplier Gula D',   entity: 'Supplier', city: 'Takalar',         island: 'Sulawesi',   lat: -5.400, lon: 119.450, commodities: ['GULA'] },

  { id: 'R01', type: 'REPACKER', name: 'Repacker Marunda',  entity: 'Repacker', city: 'Jakarta Utara',   island: 'Jawa',       lat: -6.105, lon: 106.960, commodities: ['GULA', 'MINYAK'] },
  { id: 'R02', type: 'REPACKER', name: 'Repacker Gresik',   entity: 'Repacker', city: 'Gresik',          island: 'Jawa',       lat: -7.160, lon: 112.650, commodities: ['GULA', 'MINYAK'] },
  { id: 'R03', type: 'REPACKER', name: 'Repacker Medan',    entity: 'Repacker', city: 'Medan',           island: 'Sumatera',   lat: 3.560,  lon: 98.720,  commodities: ['GULA', 'MINYAK'] },
  { id: 'R04', type: 'REPACKER', name: 'Repacker Makassar', entity: 'Repacker', city: 'Makassar',        island: 'Sulawesi',   lat: -5.140, lon: 119.470, commodities: ['GULA', 'MINYAK'] },

  { id: 'C01', type: 'CABANG', name: 'PPI Cabang Kupang',          entity: 'PPI',     city: 'Kupang',      island: 'Timor',      lat: -10.170, lon: 123.600, commodities: ['GULA', 'MINYAK'] },
  { id: 'C02', type: 'CABANG', name: 'PPI Cabang Ambon',           entity: 'PPI',     city: 'Ambon',       island: 'Maluku',     lat: -3.700,  lon: 128.170, commodities: ['GULA', 'MINYAK'] },
  { id: 'C03', type: 'CABANG', name: 'PPI Cabang Jayapura',        entity: 'PPI',     city: 'Jayapura',    island: 'Papua',      lat: -2.570,  lon: 140.700, commodities: ['GULA', 'MINYAK'] },
  { id: 'C04', type: 'CABANG', name: 'Nusindo Cabang Sorong',      entity: 'Nusindo', city: 'Sorong',      island: 'Papua',      lat: -0.880,  lon: 131.270, commodities: ['GULA', 'MINYAK'] },
  { id: 'C05', type: 'CABANG', name: 'PPI Cabang Makassar',        entity: 'PPI',     city: 'Makassar',    island: 'Sulawesi',   lat: -5.150,  lon: 119.430, commodities: ['GULA', 'MINYAK'] },
  { id: 'C06', type: 'CABANG', name: 'Nusindo Cabang Manado',      entity: 'Nusindo', city: 'Manado',      island: 'Sulawesi',   lat: 1.470,   lon: 124.840, commodities: ['GULA', 'MINYAK'] },
  { id: 'C07', type: 'CABANG', name: 'PPI Cabang Balikpapan',      entity: 'PPI',     city: 'Balikpapan',  island: 'Kalimantan', lat: -1.240,  lon: 116.860, commodities: ['GULA', 'MINYAK'] },
  { id: 'C08', type: 'CABANG', name: 'PPI Cabang Banjarmasin',     entity: 'PPI',     city: 'Banjarmasin', island: 'Kalimantan', lat: -3.320,  lon: 114.590, commodities: ['GULA', 'MINYAK'] },
  { id: 'C09', type: 'CABANG', name: 'Nusindo Cabang Pontianak',   entity: 'Nusindo', city: 'Pontianak',   island: 'Kalimantan', lat: -0.030,  lon: 109.330, commodities: ['GULA', 'MINYAK'] },
  { id: 'C10', type: 'CABANG', name: 'PPI Cabang Medan',           entity: 'PPI',     city: 'Medan',       island: 'Sumatera',   lat: 3.590,   lon: 98.670,  commodities: ['GULA', 'MINYAK'] },
  { id: 'C11', type: 'CABANG', name: 'PPI Cabang Padang',          entity: 'PPI',     city: 'Padang',      island: 'Sumatera',   lat: -0.950,  lon: 100.350, commodities: ['GULA', 'MINYAK'] },
  { id: 'C12', type: 'CABANG', name: 'Nusindo Cabang Palembang',   entity: 'Nusindo', city: 'Palembang',   island: 'Sumatera',   lat: -2.980,  lon: 104.750, commodities: ['GULA', 'MINYAK'] },
  { id: 'C13', type: 'CABANG', name: 'PPI Cabang Denpasar',        entity: 'PPI',     city: 'Denpasar',    island: 'Bali',       lat: -8.650,  lon: 115.220, commodities: ['GULA', 'MINYAK'] },
  { id: 'C14', type: 'CABANG', name: 'PPI Cabang Mataram',         entity: 'PPI',     city: 'Mataram',     island: 'Lombok',     lat: -8.580,  lon: 116.110, commodities: ['GULA', 'MINYAK'] },
  { id: 'C15', type: 'CABANG', name: 'Nusindo Cabang Ternate',     entity: 'Nusindo', city: 'Ternate',     island: 'Ternate',    lat: 0.790,   lon: 127.380, commodities: ['GULA', 'MINYAK'] },
  { id: 'C16', type: 'CABANG', name: 'PPI Cabang Jakarta',         entity: 'PPI',     city: 'Jakarta',     island: 'Jawa',       lat: -6.180,  lon: 106.830, commodities: ['GULA', 'MINYAK'] }
];

/** Contoh lane gula & minyak: [asal, tujuan, komoditas] — 32 lane */
var LANES = [
  ['S01', 'C01', 'GULA'], ['S01', 'C02', 'GULA'], ['S01', 'C03', 'GULA'], ['S01', 'C05', 'GULA'],
  ['S01', 'C07', 'GULA'], ['S01', 'C08', 'GULA'], ['S01', 'C13', 'GULA'], ['S01', 'C14', 'GULA'],
  ['S02', 'C12', 'GULA'], ['S02', 'C16', 'GULA'], ['S05', 'C10', 'GULA'], ['S05', 'C09', 'GULA'],
  ['S05', 'C11', 'GULA'], ['S07', 'C06', 'GULA'], ['S07', 'C02', 'GULA'], ['S07', 'C15', 'GULA'],
  ['S01', 'R04', 'GULA'], ['R02', 'C01', 'GULA'], ['R04', 'C06', 'GULA'], ['C16', 'C14', 'GULA'],
  ['S03', 'C10', 'MINYAK'], ['S03', 'C16', 'MINYAK'], ['S03', 'C09', 'MINYAK'], ['S04', 'C10', 'MINYAK'],
  ['S04', 'C12', 'MINYAK'], ['S06', 'C01', 'MINYAK'], ['S06', 'C04', 'MINYAK'], ['S06', 'C03', 'MINYAK'],
  ['S06', 'C05', 'MINYAK'], ['S06', 'R02', 'MINYAK'], ['R01', 'C09', 'MINYAK'], ['R03', 'C11', 'MINYAK']
];

/** 60 kota/kabupaten untuk lokasi buyer: [nama, pulau, lat, lon] */
var CITIES = [
  ['Banda Aceh', 'Sumatera', 5.55, 95.32], ['Medan', 'Sumatera', 3.59, 98.67], ['Pekanbaru', 'Sumatera', 0.51, 101.45],
  ['Padang', 'Sumatera', -0.95, 100.35], ['Jambi', 'Sumatera', -1.61, 103.61], ['Palembang', 'Sumatera', -2.99, 104.76],
  ['Bengkulu', 'Sumatera', -3.80, 102.27], ['Bandar Lampung', 'Sumatera', -5.43, 105.26], ['Batam', 'Batam', 1.13, 104.05],
  ['Pangkalpinang', 'Bangka', -2.13, 106.11], ['Tanjung Pandan', 'Belitung', -2.75, 107.65], ['Dumai', 'Sumatera', 1.67, 101.45],
  ['Jakarta', 'Jawa', -6.20, 106.85], ['Bogor', 'Jawa', -6.60, 106.80], ['Bekasi', 'Jawa', -6.24, 106.99],
  ['Tangerang', 'Jawa', -6.18, 106.63], ['Serang', 'Jawa', -6.12, 106.15], ['Bandung', 'Jawa', -6.91, 107.61],
  ['Cirebon', 'Jawa', -6.73, 108.55], ['Tasikmalaya', 'Jawa', -7.33, 108.22], ['Semarang', 'Jawa', -6.97, 110.42],
  ['Surakarta', 'Jawa', -7.57, 110.82], ['Yogyakarta', 'Jawa', -7.80, 110.36], ['Purwokerto', 'Jawa', -7.42, 109.23],
  ['Surabaya', 'Jawa', -7.25, 112.75], ['Malang', 'Jawa', -7.98, 112.63], ['Madiun', 'Jawa', -7.63, 111.52],
  ['Jember', 'Jawa', -8.17, 113.70], ['Banyuwangi', 'Jawa', -8.22, 114.37], ['Denpasar', 'Bali', -8.65, 115.22],
  ['Singaraja', 'Bali', -8.11, 115.09], ['Mataram', 'Lombok', -8.58, 116.12], ['Sumbawa Besar', 'Sumbawa', -8.49, 117.42],
  ['Bima', 'Sumbawa', -8.46, 118.73], ['Kupang', 'Timor', -10.18, 123.61], ['Ende', 'Flores', -8.84, 121.66],
  ['Maumere', 'Flores', -8.62, 122.21], ['Labuan Bajo', 'Flores', -8.50, 119.89], ['Waingapu', 'Sumba', -9.66, 120.26],
  ['Pontianak', 'Kalimantan', -0.03, 109.33], ['Singkawang', 'Kalimantan', 0.91, 108.98], ['Palangka Raya', 'Kalimantan', -2.21, 113.92],
  ['Banjarmasin', 'Kalimantan', -3.32, 114.59], ['Balikpapan', 'Kalimantan', -1.24, 116.85], ['Samarinda', 'Kalimantan', -0.50, 117.15],
  ['Tarakan', 'Tarakan', 3.30, 117.63], ['Makassar', 'Sulawesi', -5.15, 119.43], ['Parepare', 'Sulawesi', -4.01, 119.62],
  ['Kendari', 'Sulawesi', -3.97, 122.51], ['Palu', 'Sulawesi', -0.90, 119.87], ['Gorontalo', 'Sulawesi', 0.54, 123.06],
  ['Manado', 'Sulawesi', 1.47, 124.84], ['Ambon', 'Maluku', -3.70, 128.18], ['Ternate', 'Ternate', 0.79, 127.38],
  ['Tual', 'Kei', -5.64, 132.75], ['Sorong', 'Papua', -0.88, 131.26], ['Manokwari', 'Papua', -0.86, 134.06],
  ['Jayapura', 'Papua', -2.53, 140.72], ['Merauke', 'Papua', -8.49, 140.40], ['Timika', 'Papua', -4.55, 136.89]
];

var SCHEMES = [
  { code: 'S2C', label: 'Supplier → Cabang',   from: 'SUPPLIER', to: 'CABANG' },
  { code: 'S2R', label: 'Supplier → Repacker', from: 'SUPPLIER', to: 'REPACKER' },
  { code: 'R2C', label: 'Repacker → Cabang',   from: 'REPACKER', to: 'CABANG' },
  { code: 'C2C', label: 'Cabang → Cabang',     from: 'CABANG',   to: 'CABANG' },
  { code: 'S2B', label: 'Supplier → Buyer',    from: 'SUPPLIER', to: 'BUYER' },
  { code: 'R2B', label: 'Repacker → Buyer',    from: 'REPACKER', to: 'BUYER' },
  { code: 'C2B', label: 'Cabang → Buyer',      from: 'CABANG',   to: 'BUYER' }
];

var MILESTONES = {
  LAUT: ['Baru', 'Dikonfirmasi', 'Penjemputan', 'Muat di titik asal', 'Di pelabuhan muat', 'Berlayar',
         'Tiba di pelabuhan bongkar', 'Pengiriman last mile', 'Terkirim'],
  DARAT: ['Baru', 'Dikonfirmasi', 'Penjemputan', 'Muat di titik asal', 'Dalam perjalanan', 'Penyeberangan',
          'Tiba & bongkar', 'Terkirim'],
  DARAT_NO_FERRY: ['Baru', 'Dikonfirmasi', 'Penjemputan', 'Muat di titik asal', 'Dalam perjalanan',
                   'Tiba & bongkar', 'Terkirim']
};
