# PRD — Backend Sistem Reservasi The Nail Palace

| | |
|---|---|
| **Versi** | 1.0 (draf) |
| **Tanggal** | 5 November 2026 |
| **Program** | Asah 2026 (led by Dicoding, supported by GoTo) |
| **Penyusun** | Arief (tim fullstack) |
| **Dokumen terkait** | `Hasil_Interview_The_Nail_Palace`, `Kontrak_API_dan_Format_Data.md`, `openapi.yaml`, `data_dummy_the_nail_palace/` |
| **Status** | Draf untuk direview tim (2 fullstack, 2 AI engineer, 2 data science) |

---

## 1. Ringkasan

The Nail Palace adalah studio nail art di Kota Jambi yang dijalankan satu orang. Reservasi dikelola manual lewat WhatsApp dan Instagram, sehingga terjadi jadwal bentrok, slot kosong akibat customer tidak datang (no-show), dan waktu pemilik habis untuk membalas pertanyaan berulang.

Dokumen ini mendefinisikan kebutuhan **backend REST API** yang menjadi inti sistem reservasi: katalog layanan, pengecekan slot, pembuatan dan pengelolaan reservasi, serta ringkasan dashboard untuk pemilik. Dokumen ini juga menetapkan stack teknis, struktur kode, dan alur container (development dan production) yang akan dipakai.

**Sumber kebenaran kontrak API adalah `openapi.yaml`.** PRD ini tidak mengulang detail request/response; jika ada konflik, `openapi.yaml` yang menang dan PRD diperbarui.

---

## 2. Tujuan dan Non-Tujuan

### 2.1 Tujuan

1. Customer dapat melihat layanan, memilih slot kosong, dan memesan sendiri tanpa menunggu balasan chat.
2. **Jadwal bentrok tidak mungkin terjadi**, dijamin di level database.
3. Pemilik mendapat jadwal terpusat dan ringkasan indikator keberhasilan.
4. Backend mudah dirawat tim kecil: struktur berlapis, tipe aman (TypeScript), dan semua pengecekan kualitas berjalan otomatis sebelum rilis.
5. Menghasilkan data terstruktur (termasuk riwayat perubahan status) yang bisa dipakai tim data science.

### 2.2 Non-tujuan (di luar MVP)

- Pembayaran online / DP / payment gateway.
- Integrasi WhatsApp API otomatis (pengingat hanya berupa tautan `wa.me` yang disiapkan backend). Notifikasi untuk admin lewat Web Push (FR-17) bukan bagian dari pengecualian ini karena tidak memakai WhatsApp.
- Akun customer (login customer, riwayat lintas perangkat).
- Aplikasi mobile native.
- Multi-cabang / multi-studio.
- Manajemen stok bahan dan pembukuan keuangan lengkap.

### 2.3 Indikator keberhasilan

Diambil dari hasil interview dengan pemilik, dan dapat dihitung dari `GET /admin/dashboard/summary`:

| Indikator (dari interview) | Metrik backend | Target awal (usulan) |
|---|---|---|
| Jadwal bentrok berkurang | Jumlah reservasi yang tumpang tindih | 0 (dijamin constraint DB) |
| No-show berkurang | `no_show_rate` | Turun dibanding baseline pemilik; target dikonfirmasi setelah ada data nyata |
| Chat berulang berkurang | `online_booking_ratio` | ≥ 60% reservasi masuk lewat sistem pada bulan ke-2 |
| Konfirmasi lebih cepat | `avg_confirmation_minutes` | ≤ 30 menit pada jam operasional |
| Reservasi lewat sistem meningkat | `total_bookings` sumber `online` | Tren naik per bulan |

---

## 3. Pengguna

| Persona | Kebutuhan | Cara akses |
|---|---|---|
| **Customer** (perempuan 17–35 tahun, Jambi) | Lihat layanan dan harga, pilih jadwal, cek atau batalkan pesanan | Endpoint publik, tanpa login |
| **Pemilik / admin** (sekaligus satu-satunya nail artist) | Kelola reservasi, jadwal, layanan; pantau ringkasan | Endpoint `/admin/*` dengan JWT |
| **Tim frontend / mobile** | Kontrak API stabil dan terdokumentasi | `openapi.yaml`, `/docs` |
| **Tim data science / AI** | Data bersih, riwayat status, ekspor | Seed data, tabel riwayat, ekspor CSV (P2) |

---

## 4. Kebutuhan Fungsional

Prioritas: **P0** = wajib MVP, **P1** = sangat diinginkan, **P2** = jika waktu cukup.

| ID | Kebutuhan | Prioritas | Endpoint utama |
|---|---|---|---|
| FR-01 | Katalog layanan aktif (daftar dan detail) | P0 | `GET /services`, `/services/{id}` |
| FR-02 | Daftar nail artist aktif | P0 | `GET /artists` |
| FR-03 | Cek slot tersedia pada tanggal tertentu | P0 | `GET /availability` |
| FR-04 | Buat reservasi tanpa akun, dengan anti-bentrok | P0 | `POST /bookings` |
| FR-05 | Customer cek status dan batalkan reservasi (kode booking + nomor HP) | P0 | `GET /bookings/{code}`, `PATCH /bookings/{code}/cancel` |
| FR-06 | Login admin, refresh token, profil | P0 | `/auth/*` |
| FR-07 | Admin kelola reservasi: daftar+filter, detail, ubah status, jadwal ulang, buat manual | P0 | `/admin/bookings*` |
| FR-08 | Admin CRUD layanan dan artist | P0 | `/admin/services*`, `/admin/artists*` |
| FR-09 | Atur jam operasional (termasuk jam istirahat) dan blokir waktu (libur, cuti), dengan penanganan reservasi yang terdampak | P0 | `/admin/business-hours`, `/admin/blocked-slots*` |
| FR-10 | Ringkasan dashboard (status, no-show, rasio online, pendapatan, waktu konfirmasi) | P0 | `/admin/dashboard/summary` |
| FR-11 | Riwayat perubahan status reservasi (siapa, kapan, dari-ke) | P1 | internal (tabel `booking_status_history`) |
| FR-12 | Rate limiting dan anti-spam pada endpoint publik | P1 | middleware |
| FR-13 | Tautan pengingat WhatsApp (`wa.me` + teks terisi) pada detail reservasi admin | P1 | field `reminder_url` |
| FR-14 | Dokumentasi interaktif dari `openapi.yaml` | P1 | `GET /docs` (hanya non-production atau dilindungi) |
| FR-15 | Ekspor reservasi ke CSV untuk tim data science | P2 | `GET /admin/export/bookings.csv` |
| FR-16 | Titik sambung skor risiko no-show dari layanan ML | P2 | field opsional pada booking |
| FR-17 | Notifikasi pembaruan untuk admin: kotak masuk dalam aplikasi dan Web Push (reservasi baru, dibatalkan customer, belum dikonfirmasi, pengingat jadwal) | P1 | `/admin/notifications*`, `/admin/push-subscriptions`, `/admin/push/public-key` |

### 4.1 Kriteria penerimaan inti

**FR-03 Cek slot**
- Slot hanya muncul pada jam operasional, di luar jam istirahat, dan tidak melewati jam tutup.
- Slot yang bertabrakan dengan reservasi `pending`/`confirmed` atau blokir waktu tidak muncul.
- Slot berada pada kelipatan `SLOT_STEP_MINUTES` (default 30) dan durasi mengikuti layanan.
- Reservasi aktif menempati artist-nya sampai `end_at` ditambah `BOOKING_BUFFER_MINUTES` (default 15); dua reservasi hanya boleh berdampingan bila rentang terpakai keduanya tidak bertabrakan. Blokir waktu, jam istirahat, dan jam tutup memakai waktu persis tanpa jeda.

**FR-04 Buat reservasi**
- Status awal `pending`; reservasi yang dibuat admin langsung `confirmed`.
- Dua permintaan bersamaan untuk slot yang sama: satu berhasil (`201`), yang lain `409 SLOT_UNAVAILABLE`.
- Harga disalin ke `total_price` saat booking (snapshot).
- Tanggal di masa lalu atau melebihi `MAX_ADVANCE_DAYS` ditolak (`422`).
- Nomor HP dinormalisasi ke format E.164 sebelum disimpan.

**FR-09 Jam operasional dan blokir waktu**
- Jam operasional mingguan memuat tepat 7 hari (0 = Minggu sampai 6 = Sabtu); hari buka wajib punya `open_time` < `close_time`, dan jam istirahat (`break_start` / `break_end`) bersifat opsional, harus berpasangan, dan berada di dalam jam buka. Perubahan bersifat atomik dan hanya berlaku untuk slot ke depan; reservasi yang sudah ada tidak berubah.
- Pemilik boleh memblokir waktu yang sudah berisi reservasi `pending` atau `confirmed`, melalui langkah sadar yang dipaksa server: `POST /admin/blocked-slots/check` hanya menampilkan reservasi terdampak (tanpa menyimpan), dan `POST /admin/blocked-slots` yang bertabrakan dengan reservasi ditolak `409 BLOCK_HAS_BOOKINGS` (berisi daftar konflik) kecuali body memuat `acknowledge_conflicts: true`.
- Tidak ada pembatalan otomatis. Reservasi yang terdampak ditandai sebagai konflik jadwal (dihitung dari data, hilang sendiri bila reservasi dipindah, dibatalkan, atau blokir dihapus), dan respons blokir menyertakan `contact_url` (`wa.me` dengan pesan siap kirim, memakai pembuat tautan yang sama dengan FR-13) untuk tiap reservasi terdampak. Pesan tidak memuat alasan internal pemilik secara otomatis.
- Kesepakatan jadwal ulang atau pembatalan terjadi antara pemilik dan customer lewat chat. Pemilik mencatat hasilnya sendiri: menjadwal ulang atau membatalkan dengan alasan (FR-07), dan menulis ringkasan kesepakatan di `admin_note`. Sistem tidak dapat memverifikasi persetujuan customer.
- Slot yang terblokir langsung tidak tersedia untuk pemesanan baru. Pembuatan blokir dan pembuatan reservasi memakai kunci advisory PostgreSQL yang sama di dalam transaksi masing-masing agar tidak bisa berjalan bersamaan.

**FR-05 Pembatalan customer**
- Hanya untuk status `pending`/`confirmed` dan hanya sebelum `start_at` (batas waktu dapat diatur via `CANCEL_MIN_HOURS_BEFORE`, default 0).
- Nomor HP yang tidak cocok mengembalikan `404` (bukan `403`) agar kode booking tidak bisa ditebak.
- Respons status reservasi menyertakan `schedule_conflict: true` bila reservasi bertabrakan dengan blokir waktu (FR-09), agar halaman cek status dapat menampilkan banner bahwa pemilik akan menghubungi customer.

**FR-07 Transisi status**
- Hanya transisi yang valid; selainnya `409 INVALID_STATUS_TRANSITION`: `pending` → `confirmed` | `cancelled`; `confirmed` → `completed` | `cancelled` | `no_show`; `completed`, `cancelled`, dan `no_show` adalah status akhir.
- Pembatalan wajib menyertakan alasan. `completed` dan `no_show` hanya boleh setelah waktu mulai reservasi, karena status itu melepas slot.
- Jadwal ulang hanya untuk `pending`/`confirmed` dan mengikuti aturan slot, jeda, dan blokir yang sama dengan reservasi baru; reservasi itu sendiri tidak dihitung sebagai penghalang.
- Detail reservasi admin menyertakan `reminder_url` (FR-13) untuk reservasi `pending`/`confirmed`.
- Setiap perubahan tercatat di riwayat status (FR-11).

**FR-10 Dashboard**
- Periode dihitung dari `start_at` reservasi menurut hari WIB (`date_from` dan `date_to` inklusif, maksimal 366 hari) dan mencakup semua status.
- `no_show_rate` = `no_show` / (`completed` + `no_show`); `online_booking_ratio` = reservasi `online` / seluruh reservasi pada periode; `revenue_completed` = jumlah `total_price` reservasi `completed`.
- `avg_confirmation_minutes` = rata-rata selisih `confirmed_at` dan `created_at` hanya untuk reservasi online yang pernah dikonfirmasi (reservasi admin langsung `confirmed`, sehingga tidak dihitung).
- Rasio dan rata-rata bernilai `null`, bukan 0, bila belum ada data pembaginya.

**FR-15 Ekspor CSV**
- Hanya role `owner`. Satu baris per reservasi, urut `start_at`, dikirim bertahap dari database sehingga riwayat besar tidak perlu muat di memori; filter opsional `date_from`, `date_to` (hari WIB, inklusif), dan `status`.
- Data pribadi tidak diekspor (tanpa nama, nomor telepon, kode booking, dan catatan bebas). Customer yang sama dikenali lewat `customer_ref` (HMAC nomor telepon dengan kunci rahasia server); `has_customer_note` dan `has_reference_image` hanya menyatakan ada atau tidaknya.
- Memuat kolom turunan untuk analisis: `lead_time_hours`, `confirmation_minutes`, `status_changes`, `last_status_change_at`, dan `cancelled_by`. Daftar kolom lengkap ada di `openapi.yaml`.
- Sel teks yang diawali `=`, `+`, `-`, atau `@` diberi awalan `'` agar tidak dijalankan sebagai rumus oleh aplikasi spreadsheet.
- FR-16 (titik sambung skor risiko no-show) belum dikerjakan: menunggu jawaban pertanyaan terbuka nomor 7.

**FR-17 Notifikasi admin**
- Pemicu tambahan: reservasi aktif yang bertabrakan dengan blokir waktu (`schedule_conflict`, sekali per reservasi). Reservasi yang dibuat atau dibatalkan admin sendiri tidak memicu notifikasi.
- Pemicu: reservasi baru dari customer (`source=online`), pembatalan oleh customer, reservasi `pending` lebih lama dari `NOTIFY_UNCONFIRMED_AFTER_MINUTES` (default 15), dan reservasi `confirmed` yang dimulai dalam `NOTIFY_UPCOMING_MINUTES_BEFORE` (default 120).
- Notifikasi dibuat dalam transaksi database yang sama dengan perubahan reservasi, dan tiap peristiwa hanya menghasilkan satu notifikasi (`dedupe_key` unik) walau penjadwal berjalan berulang.
- Status baca disimpan per admin; daftar mendukung filter belum dibaca dan paginasi, dan ada endpoint jumlah belum dibaca.
- Endpoint langganan harus https dan milik layanan push browser yang dikenal (Chrome/FCM, Firefox, Safari, Edge), karena server yang menghubungi alamat itu; selain itu ditolak `422` (mencegah SSRF). Pengirim berjalan terpisah dari permintaan reservasi, tiap notifikasi dikirim paling banyak sekali (ditandai `pushed_at` saat diambil), dan notifikasi lebih tua dari 15 menit tidak dikirim.
- Web Push bersifat best effort dan tidak boleh menggagalkan atau memperlambat reservasi; langganan yang dijawab 404/410 oleh layanan push dihapus.
- Teks notifikasi dan payload push memuat kode booking, layanan, waktu, dan nama depan saja, tanpa nomor telepon (UU No. 27 Tahun 2022).

---

## 5. Kebutuhan Non-Fungsional

| Kategori | Kebutuhan |
|---|---|
| **Performa** | Endpoint baca p95 < 300 ms; `/availability` p95 < 500 ms pada beban ≤ 20 pengguna bersamaan (1 vCPU / 1 GB RAM) |
| **Keandalan** | Graceful shutdown (SIGTERM), health check liveness dan readiness, restart otomatis, migrasi database terpisah dari proses API |
| **Keamanan** | Hash password argon2id; access token JWT berumur pendek (15 menit) + refresh token dengan rotasi (disimpan sebagai hash); `helmet`; CORS allowlist; rate limit pada login dan `POST /bookings`; validasi semua input; query lewat Prisma (parameterized); secret hanya lewat environment/secret, tidak masuk image |
| **Privasi** | Nomor HP dan nama customer adalah data pribadi (mengacu UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi): kumpulkan seminimal mungkin, redaksi di log, tampilkan penuh hanya ke admin |
| **Observabilitas** | Log JSON terstruktur dengan `request_id`; level log dari environment; error tak terduga dicatat lengkap tetapi tidak dibocorkan ke klien |
| **Kualitas kode** | TypeScript `strict`; ESLint tanpa error; cakupan unit test ≥ 80% untuk `services/` dan `utils/` |
| **Portabilitas** | Dijalankan identik lewat Podman (rootless) di mesin developer dan server |
| **Zona waktu** | Database menyimpan `timestamptz` (UTC); API menerima dan mengembalikan ISO 8601 offset `+07:00`; aturan jam operasional dihitung dalam Asia/Jakarta |

---

## 6. Stack Teknis

| Komponen | Pilihan | Peran dan catatan |
|---|---|---|
| Framework HTTP | **Express.js** (v5) | Routing dan middleware. Express 5 menangani error dari handler async secara native |
| Bahasa | **TypeScript** (`strict`) | Seluruh kode aplikasi |
| Database | **PostgreSQL** | Penyimpanan utama; memakai ekstensi `btree_gist` untuk constraint anti-bentrok |
| Driver | **node-postgres (`pg`)** | Driver di bawah Prisma melalui adapter |
| ORM | **Prisma ORM 7** + `@prisma/adapter-pg` | Schema, migrasi, query bertipe. Prisma 7 mewajibkan driver adapter, URL koneksi diatur di `prisma.config.ts`, dan client digenerate ke folder proyek |
| Runtime development | **Bun** | Menjalankan TypeScript langsung, watch mode, dan test runner (`bun test`) |
| Runtime production | **Node.js 26 (LTS)** | Menjalankan JavaScript hasil transpile. Node 26 resmi masuk Active LTS pada 28 Oktober 2026 |
| Linting | **ESLint** (flat config) + `typescript-eslint` | Termasuk aturan batas antar-layer |
| Format kode | **Prettier** + `.editorconfig` | Kutip ganda, titik koma, 2 spasi, koma di akhir, 120 kolom. `format:check` dijalankan di `verify`, CI, dan tahap `verify` `Dockerfile.prod`. Markdown, migrasi, kode hasil generate, dan `documents/` dikecualikan lewat `.prettierignore` |
| CI | **GitHub Actions** | `ci.yml`: format, lint, typecheck, tes unit, build, dan smoke test di Node 26, ditambah tes integrasi dengan container PostgreSQL. `pr-base.yml`: PR ke `main` hanya boleh berasal dari `develop` |
| Container | **Podman** (rootless) + `podman compose` | Build dan run; file `Dockerfile.*` tetap kompatibel dengan Podman |
| Validasi | `zod` | Validasi body, query, params, dan environment (dipakai) |
| Autentikasi | `jose`, `@node-rs/argon2` | Dipakai: JWT HS256 lewat `jose`, hash argon2id; keduanya jalan di Bun dan Node (termasuk Alpine/musl) |
| Keamanan HTTP | `helmet`, `cors`, `express-rate-limit` | Usulan |
| Logging | `pino`, `pino-http` | Dipakai; header otorisasi, kata sandi, token, dan nomor telepon diredaksi |
| Tanggal/zona waktu | Offset tetap +07:00 (`src/utils/datetime.ts`), tanpa library | Asia/Jakarta tidak memakai waktu musim panas, jadi offset tetap sudah tepat. Tidak memakai Temporal agar perilaku sama di Bun dan Node |
| Pengujian | `bun test` dan `fetch` ke `app.listen(0)` | Unit (repository di-mock) dan integrasi (Express + PostgreSQL asli). Tidak memakai `supertest` |

> Item bertanda "usulan" bukan keputusan final dan boleh diganti selama memenuhi kebutuhan non-fungsional.

### 6.1 Paritas Bun (dev) dan Node (prod)

Kode ditulis dan diuji di Bun, tetapi dijalankan di Node pada production. Untuk mengurangi risiko perbedaan perilaku:

1. Hanya pakai API standar Node/Web. **Dilarang memakai API khusus Bun** (`Bun.*`, `bun:sqlite`, dll.) di `src/`; ditegakkan lewat ESLint (`no-restricted-globals`/`no-restricted-imports`).
2. TypeScript memakai `module: NodeNext`, sehingga import relatif wajib menyertakan ekstensi `.js` (contoh: `import { x } from './x.js'`). Bun dan Node sama-sama bisa membacanya.
3. Hasil build wajib lolos **smoke test di Node** (bagian 9.3).
4. Pada paket yang punya native binding (hash password), pilih yang punya binary prebuilt untuk Alpine (musl) dan jalan di kedua runtime.

---

## 7. Arsitektur dan Struktur Kode

### 7.1 Arsitektur berlapis

```
HTTP request
  → middleware (request-id, logger, helmet, cors, rate-limit, auth, validate)
  → routes        : memetakan URL ke controller
  → controllers   : membaca request, memanggil service, membentuk response
  → services      : aturan bisnis (anti-bentrok, transisi status, hitung slot)
  → repositories  : satu-satunya tempat yang memakai Prisma
  → PostgreSQL
```

Aturan dependensi (ditegakkan ESLint): `routes → controllers → services → repositories`. Lapisan atas boleh memanggil lapisan di bawahnya, **tidak sebaliknya**, dan hanya `repositories/` yang boleh mengimpor Prisma Client. `utils/` bebas dipakai semua lapisan tetapi tidak boleh mengimpor lapisan lain.

### 7.2 Struktur folder

```
nailpalace-api/
├── src/
│   ├── app.ts                  # membuat instance Express (tanpa listen, agar mudah diuji)
│   ├── server.ts               # entry point: listen, graceful shutdown
│   ├── config/
│   │   └── env.ts              # baca dan validasi environment (fail-fast)
│   ├── middleware/
│   │   ├── request-id.ts
│   │   ├── auth.ts             # verifikasi JWT, cek role
│   │   ├── validate.ts         # validasi zod untuk body/query/params
│   │   ├── rate-limit.ts
│   │   ├── not-found.ts
│   │   └── error-handler.ts    # petakan error ke format { error: { code, message, details } }
│   ├── routes/
│   │   ├── index.ts            # mount semua router di /api/v1
│   │   ├── health.routes.ts
│   │   ├── public.routes.ts    # services, artists, availability, bookings
│   │   ├── auth.routes.ts
│   │   └── admin.routes.ts
│   ├── controllers/
│   ├── services/
│   │   ├── availability.service.ts
│   │   ├── booking.service.ts
│   │   └── dashboard.service.ts
│   ├── repositories/
│   │   ├── booking.repository.ts
│   │   ├── service.repository.ts
│   │   ├── artist.repository.ts
│   │   ├── schedule.repository.ts   # business_hours + blocked_slots
│   │   └── admin.repository.ts
│   ├── schemas/                # skema zod per endpoint
│   ├── utils/
│   │   ├── prisma.ts           # instance PrismaClient + adapter pg (singleton)
│   │   ├── datetime.ts         # konversi WIB (offset tetap +07:00), kelipatan slot
│   │   ├── whatsapp.ts         # pembuat tautan wa.me (dipakai FR-09 dan FR-13)
│   │   ├── phone.ts            # normalisasi E.164
│   │   ├── booking-code.ts     # NP-YYYYMMDD-XXXX
│   │   ├── errors.ts           # kelas AppError + kode error
│   │   ├── logger.ts
│   │   └── response.ts         # helper { data, meta }
│   ├── types/
│   └── generated/prisma/       # hasil `prisma generate` (tidak di-commit)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── prisma.config.ts
├── tests/
│   ├── unit/                   # services, utils (repository di-mock)
│   ├── integration/            # Express + PostgreSQL asli
│   └── helpers/
├── scripts/
│   ├── dev-entrypoint.sh
│   └── release.sh              # gerbang rilis (bagian 9.4)
├── documents/
│   └── openapi.yaml            # kontrak API (PRD ada di root: PRD_Backend_The_Nail_Palace.md)
├── .github/workflows/          # ci.yml dan pr-base.yml
├── Dockerfile.dev
├── Dockerfile.prod
├── compose.dev.yaml
├── compose.prod.yaml
├── eslint.config.mjs
├── .prettierrc.json
├── .editorconfig
├── tsconfig.json
├── tsconfig.build.json         # untuk build production (tanpa tests)
├── bunfig.toml
├── package.json                # "type": "module"
├── .env.example
├── .dockerignore               # dibaca juga oleh Podman
└── .gitignore
```

Folder `controllers/`, `services/`, dan `schemas/` ditambahkan di luar daftar awal (`middleware/`, `routes/`, `repositories/`, `utils/`) agar aturan bisnis tidak bocor ke route atau repository. Jika tim ingin lebih ringkas, controller dan service dapat digabung, tetapi `repositories/` tetap dipisah.

### 7.3 Konvensi penanganan error

- Semua error bisnis dilempar sebagai `AppError(code, httpStatus, message, details?)`.
- `error-handler.ts` mengubahnya menjadi format error di kontrak API; error tak dikenal menjadi `500 INTERNAL_ERROR` tanpa membocorkan detail.
- Error constraint database dipetakan di repository/service (contoh: SQLSTATE `23P01` exclusion violation menjadi `409 SLOT_UNAVAILABLE`).

---

## 8. Data

### 8.1 Model Prisma

Mengikuti `Kontrak_API_dan_Format_Data.md`:

| Model | Tabel | Catatan |
|---|---|---|
| `Service` | `services` | Harga integer Rupiah, durasi kelipatan 15 menit |
| `Artist` | `artists` | Saat ini 1 baris (pemilik); struktur tetap mendukung banyak artist |
| `Booking` | `bookings` | `status`, `source`, snapshot `total_price`, `confirmed_at` |
| `BookingStatusHistory` | `booking_status_history` | **Baru (FR-11):** `booking_id`, `from_status`, `to_status`, `changed_by`, `changed_at`, `reason` |
| `BusinessHour` | `business_hours` | Jam buka per hari, istirahat |
| `BlockedSlot` | `blocked_slots` | `artist_id` null = seluruh studio |
| `Admin` | `admins` | `password_hash`, role `owner`/`staff` |
| `RefreshToken` | `refresh_tokens` | **Baru:** hash token, `expires_at`, `revoked_at`, untuk rotasi |

Konvensi: ID `@db.Uuid` dengan `gen_random_uuid()`; kolom waktu `@db.Timestamptz`; nama tabel dan kolom `snake_case` lewat `@@map`/`@map`; enum untuk `BookingStatus`, `BookingSource`, `AdminRole`.

### 8.2 Constraint anti-bentrok (wajib)

Prisma schema tidak dapat menyatakan exclusion constraint, jadi ditambahkan lewat **migrasi SQL manual** (`prisma migrate dev --create-only`, lalu edit file SQL):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    artist_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'));
```

Dengan constraint ini, dua permintaan serentak untuk slot yang sama tidak bisa lolos keduanya, walau aplikasi belum sempat mengecek. Service tetap mengecek lebih dulu agar pesan error ramah, tetapi **constraint adalah penjaga terakhir**. Jeda antar-reservasi (buffer, default 15 menit) dihitung saat membentuk slot di `availability.service.ts`, bukan di constraint.

### 8.3 Migrasi dan seed

- Development: `prisma migrate dev`. Production: hanya `prisma migrate deploy` lewat container `migrate` terpisah (bagian 9.2).
- File migrasi di-commit dan tidak pernah diubah setelah dirilis.
- `prisma/seed.ts` mengisi data **bersih** dari `services.csv`, `jam_operasional.csv`, dan satu artist (pemilik), serta satu akun admin dari environment. Data reservasi mentah (`booking_raw.csv`) **tidak** di-seed ke aplikasi; itu bahan latihan tim data science. Opsi `SEED_DEMO_BOOKINGS=true` boleh menyediakan contoh reservasi bersih untuk demo.

---

## 9. Container dan Environment

### 9.1 Dua lingkungan, dua Dockerfile, dua compose

| | **Development** | **Production** |
|---|---|---|
| Dockerfile | `Dockerfile.dev` | `Dockerfile.prod` (multi-stage) |
| Compose | `compose.dev.yaml` | `compose.prod.yaml` |
| Runtime | Bun (`bun --watch src/server.ts`) | Node.js 26 LTS (`node dist/server.js`) |
| Kode | Bind mount dari host (hot reload) | Disalin ke image, JavaScript hasil transpile |
| Database | Port dipublikasikan ke host untuk alat bantu; ada database `*_test` | Tidak ada port ke host; jaringan internal |
| Migrasi | `prisma migrate dev` saat start | Container `migrate` terpisah: `prisma migrate deploy` |
| Tes | Dijalankan di container (`bun test`) | Dijalankan saat **build image** sebagai gerbang |
| Pengguna proses | root rootless Podman (dengan `--userns=keep-id` untuk bind mount) | Non-root (`node`), filesystem read-only |

Jalankan dengan `podman compose -f compose.dev.yaml up` atau `podman compose -f compose.prod.yaml up -d`.

### 9.2 Rancangan `Dockerfile.prod` (multi-stage)

```
Stage 1  deps      : node:26-alpine + bun → install dependensi (frozen lockfile)
Stage 2  verify    : prisma generate → lint → typecheck → test:unit → build (tsc) → smoke test di Node
Stage 3  prod-deps : instal hanya dependensi production
Stage 4  migrator  : node:26-alpine + prisma CLI + folder prisma/ + prisma.config.ts   (target untuk container migrate)
Stage 5  runtime   : node:26-alpine, non-root, salin dist/ dari verify + node_modules dari prod-deps  (target untuk container api)
```

Poin penting:

- **Stage `runtime` dan `migrator` menyalin artefak dari stage `verify`** (`COPY --from=verify ...`). Karena itu `verify` wajib dieksekusi dan wajib lolos; jika satu langkah gagal, build berhenti dan **tidak ada image yang dihasilkan**. Stage yang tidak direferensikan bisa dilewati oleh builder, jadi ketergantungan ini tidak boleh dihapus.
- Image runtime tidak berisi source TypeScript, devDependencies, maupun Prisma CLI.
- Base image dipatok ke tag minor dan sebaiknya digest (contoh `node:26-alpine`), bukan `latest`.
- `HEALTHCHECK` dari Dockerfile diabaikan pada format OCI default Podman, jadi health check didefinisikan di compose.
- Proses dijalankan dengan init (`init: true` di compose) agar sinyal SIGTERM diteruskan dengan benar.

### 9.3 Smoke test di Node

Setelah `tsc`, stage `verify` menjalankan `node dist/scripts/smoke.js` yang mengimpor `app` hasil build dan memastikan modul terbaca di Node (menangkap kesalahan seperti ekstensi import hilang atau API khusus Bun) lalu menjawab `GET /health/live`. Smoke test **tidak memerlukan database** (liveness tidak menyentuh DB).

### 9.4 Gerbang rilis: "semua testing selesai sebelum container jalan"

Pengujian terbagi dua karena tes integrasi membutuhkan PostgreSQL asli, yang tidak praktis dijalankan di dalam `podman build`:

| Gerbang | Isi | Dijalankan di | Jika gagal |
|---|---|---|---|
| **A. Build-time** | lint, typecheck, unit test + coverage, build, smoke test Node | Stage `verify` di `Dockerfile.prod` | Image tidak terbentuk |
| **B. Pra-build** | Tes integrasi (Express + PostgreSQL asli) dan contract test terhadap `openapi.yaml` | Container dev (`compose.dev.yaml`, database `*_test`) | Rilis dihentikan sebelum build |

`scripts/release.sh` (`set -euo pipefail`) menjalankan urutan berikut dan berhenti pada kegagalan pertama:

1. Naikkan database dev (`podman compose -f compose.dev.yaml up -d db`) dan tunggu sehat.
2. Jalankan tes integrasi di container dev: `run --rm api bun run test:integration`.
3. Build image runtime dan migrator dari `Dockerfile.prod` (gerbang A berjalan di sini), diberi tag `git rev-parse --short HEAD`.
4. Jalankan production: `IMAGE_TAG=<sha> podman compose -f compose.prod.yaml up -d`.

`compose.prod.yaml` hanya memakai image dengan tag hasil langkah 3. Urutan start di production: `db` sehat → `migrate` selesai sukses → `api` start; `api` dinyatakan siap setelah `GET /health/ready` (cek koneksi database) berhasil.

> Kesenjangan yang diterima: tes unit/integrasi berjalan di Bun, sedangkan production di Node. Smoke test (9.3) dan larangan API khusus Bun (6.1) menutup sebagian besar risikonya. Jika waktu memungkinkan, tes integrasi dapat dijalankan juga terhadap hasil build di Node (P2).

### 9.5 Rancangan compose

**`compose.dev.yaml`**

| Service | Detail |
|---|---|
| `db` | PostgreSQL, volume bernama, healthcheck `pg_isready`, port dipublikasikan (mis. `5432`), skrip init membuat database `nailpalace_dev` dan `nailpalace_test` |
| `api` | `build: Dockerfile.dev`, bind mount `./:/app` (label `:Z` untuk SELinux), volume anonim untuk `node_modules`, `env_file: .env.dev`, port `3000`, `depends_on: db (service_healthy)`, entrypoint menjalankan `prisma generate`, `prisma migrate dev`, lalu `bun --watch` |
| `adminer` *(opsional)* | Profil `tools` untuk melihat data |

**`compose.prod.yaml`**

| Service | Detail |
|---|---|
| `db` | PostgreSQL, volume bernama, healthcheck, **tanpa `ports`**, `restart: unless-stopped` |
| `migrate` | Image target `migrator`, perintah `prisma migrate deploy`, `restart: "no"`, menunggu `db` sehat |
| `api` | Image target `runtime` (tag dari `IMAGE_TAG`), `depends_on: migrate (service_completed_successfully)`, publish hanya ke `127.0.0.1:3000` (di belakang reverse proxy), `read_only: true` + `tmpfs: /tmp`, `init: true`, batas memori/CPU, healthcheck memanggil `/health/live`, `restart: unless-stopped` |

Reverse proxy dengan HTTPS (Caddy/Nginx) tidak termasuk dalam dua compose ini; lihat pertanyaan terbuka.

### 9.6 Variabel environment

| Variabel | Contoh / default | Keterangan |
|---|---|---|
| `NODE_ENV` | `development` / `production` | |
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgresql://user:pass@db:5432/nailpalace_dev` | Dipakai Prisma CLI dan adapter |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | acak ≥ 32 byte | Wajib; tidak boleh ada di image |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `15m` / `7d` | |
| `CORS_ORIGINS` | `https://...` | Daftar origin diizinkan |
| `TRUST_PROXY` | kosong | Jumlah reverse proxy di depan aplikasi; kosong = 1 di production, 0 di lainnya |
| `RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_BOOKING_MAX` / `RATE_LIMIT_LOOKUP_MAX` / `RATE_LIMIT_GENERAL_MAX` | `10` / `10` / `30` / `300` | Batas permintaan per IP per jendela: login (hanya yang gagal, 15 menit), buat reservasi (1 jam), cek/batal reservasi (15 menit), seluruh API (1 menit) |
| `NOTIFY_UNCONFIRMED_AFTER_MINUTES` / `NOTIFY_UPCOMING_MINUTES_BEFORE` | `15` / `120` | Menit sebelum reservasi `pending` diingatkan, dan menit sebelum reservasi `confirmed` dimulai untuk pengingat jadwal (FR-17) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | kosong | Web Push (FR-17): ketiganya diisi atau tidak sama sekali; kosong = Web Push mati. `VAPID_SUBJECT` berupa `mailto:` atau URL https; kunci dibuat dengan `bunx web-push generate-vapid-keys` |
| `DOCS_USER`, `DOCS_PASSWORD` | `docs` / kosong | `/docs` terbuka di luar production; di production hanya aktif bila `DOCS_PASSWORD` (≥ 12 karakter) diisi, dengan HTTP Basic auth |
| `TZ` | `Asia/Jakarta` | |
| `LOG_LEVEL` | `info` | |
| `SLOT_STEP_MINUTES` | `30` | |
| `BOOKING_BUFFER_MINUTES` | `15` | Jeda antar-reservasi |
| `MAX_ADVANCE_DAYS` | `60` | Batas pemesanan ke depan |
| `CANCEL_MIN_HOURS_BEFORE` | `0` | |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | | Hanya untuk seed |

Semua variabel divalidasi di `config/env.ts` saat boot; aplikasi **gagal start** jika ada yang hilang atau tidak valid. `.env.*` tidak di-commit; hanya `.env.example`.

---

## 10. Strategi Pengujian

| Jenis | Alat | Cakupan | Dijalankan di |
|---|---|---|---|
| Lint | ESLint flat config, `typescript-eslint` | Aturan umum, `no-floating-promises`, `no-misused-promises`, `consistent-type-imports`, batas antar-layer, larangan API Bun | Gerbang A, dev, CI |
| Typecheck | `tsc --noEmit` | Seluruh `src/` dan `tests/` | Gerbang A, dev, CI |
| Unit | `bun test` | `services/` (slot, transisi status, anti-bentrok di level logika), `utils/`; repository di-mock; target ≥ 80% | Gerbang A, dev, CI |
| Integrasi | `bun test` + `supertest` + PostgreSQL asli | Alur endpoint penuh; **tes konkurensi** (dua `POST /bookings` serentak ke slot sama → satu `201`, satu `409`); constraint DB; auth dan role | Gerbang B (container dev) |
| Contract | Validasi respons terhadap `openapi.yaml` | Bentuk respons sesuai kontrak | Gerbang B |
| Smoke | `node dist/scripts/smoke.js` | Build berjalan di Node | Gerbang A |

Database tes: skema dibuat ulang (`prisma migrate reset --force` pada `nailpalace_test`) sebelum rangkaian tes integrasi; setiap tes membersihkan datanya atau berjalan dalam transaksi terisolasi.

Kasus uji wajib:
- Booking di luar jam operasional, saat istirahat, atau pada hari libur/blokir ditolak.
- Reservasi bertumpuk (termasuk batas tepat `end_at = start_at`) ditangani benar.
- Transisi status tidak valid ditolak; riwayat status tercatat.
- Pembatalan oleh customer dengan nomor HP salah → `404`.
- Token kedaluwarsa/dicabut ditolak; refresh token yang sudah dipakai tidak bisa dipakai ulang.

---

## 11. Keamanan: Daftar Periksa

- [ ] Secret tidak ada di repository maupun layer image
- [ ] Container production berjalan non-root, filesystem read-only
- [ ] Database tidak terekspos ke host/publik di production
- [x] Rate limit aktif pada `/auth/login` dan `POST /bookings` (juga cek/batal reservasi dan batas umum API)
- [x] `helmet` dan CORS allowlist aktif
- [ ] Nomor HP diredaksi di log
- [ ] Pesan error tidak membocorkan detail internal
- [x] `/docs` dinonaktifkan atau dilindungi di production (404 bila `DOCS_PASSWORD` kosong, selain itu Basic auth)
- [ ] Dependensi diaudit (`bun audit`/setara) sebelum rilis
- [ ] Backup database terjadwal (lihat pertanyaan terbuka)

---

## 12. Tahapan Pengerjaan

**Tenggat: Selasa, 8 Desember 2026** (demo prototipe ke pemilik). Urutan modul di bawah dipetakan ke titik pemeriksaan berikut; bila sebuah titik terlewat, pekerjaan yang paling akhir dalam daftar ditunda lebih dulu.

| Tanggal | Target | Keputusan di titik ini |
|---|---|---|
| 14 Nov 2026 | Jam operasional + blokir waktu, dan cek ketersediaan slot | |
| 21 Nov 2026 | Booking publik (buat, cek, batalkan, riwayat status) | |
| 28 Nov 2026 | Booking admin dan dashboard: **prototipe utuh yang bisa didemokan** | Bila belum tercapai, Web Push dan ekspor CSV ditunda |
| 3 Des 2026 | Kotak masuk notifikasi dan hardening dasar | |
| 4-7 Des 2026 | Web Push bila sesuai jadwal, integrasi dengan frontend, latihan demo, penyangga | |

| Fase | Isi | Selesai bila |
|---|---|---|
| **0. Fondasi** | Repo, TypeScript, ESLint, struktur folder, `config/env.ts`, Prisma 7 + adapter pg, kedua Dockerfile dan compose, health check | `podman compose -f compose.dev.yaml up` berjalan; build prod menghasilkan image dan smoke test lolos |
| **1. Inti reservasi (P0 publik)** | Model data + migrasi + constraint anti-bentrok, FR-01 s.d. FR-05, seed | Alur pilih layanan → cek slot → booking → cek status berjalan; tes konkurensi lolos |
| **2. Admin (P0)** | FR-06 s.d. FR-10, riwayat status (FR-11) | Pemilik dapat login, mengelola reservasi, jadwal, layanan, dan melihat dashboard |
| **3. Pengerasan** | FR-12 s.d. FR-14, FR-17, contract test, cakupan tes, `release.sh`, audit keamanan | Daftar periksa keamanan terpenuhi; satu kali rilis penuh lewat `release.sh` sukses |
| **4. Opsional** | FR-15 s.d. FR-16 | Sesuai kebutuhan tim data/AI |

### Definition of Done (per fitur)
1. Sesuai `openapi.yaml` (atau kontrak diperbarui lebih dulu).
2. Ada tes unit dan, bila menyentuh database/endpoint, tes integrasi.
3. Lint, typecheck, dan seluruh tes lolos di container.
4. Tidak menambah API khusus Bun.
5. Dokumentasi/README diperbarui bila ada variabel environment atau perintah baru.

---

## 13. Risiko

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Perbedaan perilaku Bun (dev/test) vs Node (prod) | Bug hanya muncul di production | Larang API Bun, smoke test Node, `NodeNext` dengan ekstensi `.js`, pertimbangkan tes integrasi di Node |
| R2 | Constraint exclusion tidak terwakili di schema Prisma | Migrasi berikutnya bisa menghapusnya diam-diam | Simpan di file migrasi SQL yang di-commit; tes integrasi memverifikasi constraint aktif |
| R3 | Prisma 7 berbasis ESM, client digenerate ke folder proyek, dan membutuhkan adapter | Salah konfigurasi menyebabkan error build/runtime | Siapkan di Fase 0 dan uji lewat build prod; ikuti dokumentasi Prisma 7 saat setup |
| R4 | Node 26 baru masuk LTS (28 Okt 2026) | Beberapa paket mungkin belum menguji Node 26 | Jalankan seluruh tes di image Node 26 sejak awal; catat paket bermasalah; tetap bisa turun ke Node 24 LTS bila perlu |
| R5 | Podman rootless: izin bind mount dan SELinux | Hot reload gagal / permission denied | `:Z`, `--userns=keep-id`, dokumentasikan di README |
| R6 | Tes integrasi tidak ikut dalam `podman build` | Image bisa dibangun tanpa tes integrasi bila orang melewati skrip | Wajibkan `release.sh` sebagai satu-satunya jalur rilis; blok di CI |
| R7 | Pemilik studio hanya satu orang, tidak punya waktu mengisi data | Data awal minim | Seed dari file yang sudah disiapkan; admin diberi halaman minimal dan cepat |
| R8 | Data dummy berbeda dengan perilaku asli | Model/analisis salah arah | Tandai data sintetis; ganti dengan data nyata setelah sistem dipakai |
| R9 | Antrean review menahan modul (aturan satu persetujuan dari kolaborator lain) | Modul menumpuk dan tenggat 8 Desember 2026 terlewat | Sepakati waktu respons review; PR kecil dan berfokus satu hal; setelah modul 7, modul 8, 9, 10, dan 12a dikerjakan paralel |
| R10 | Frontend bergantung pada kontrak yang masih berubah, dan Web Push butuh service worker di repo frontend | Integrasi terlambat | Frontend memakai server tiruan dari `openapi.yaml`; kontrak diubah lebih dulu dan diumumkan; konfirmasi kapasitas frontend sebelum modul 12b |

---

## 14. Pertanyaan Terbuka

1. **Konfirmasi reservasi:** manual oleh pemilik (`pending` → `confirmed`) atau otomatis? Draf memakai manual. **Diputuskan (8 Nov 2026): manual.**
2. **Artist:** karena pemilik satu-satunya pelaku, apakah `artist_id` disembunyikan dari alur customer? **Diputuskan (8 Nov 2026):** `artist_id` opsional di API dan disembunyikan secara default di frontend; bila kosong, sistem memilih artist yang tersedia.
3. **Lokasi deploy:** VPS, mesin lokal, atau layanan cloud? Menentukan reverse proxy, HTTPS, dan backup.
4. **CI:** memakai apa (GitHub Actions, GitLab CI)? Bagaimana menjalankan Podman di sana? **Diputuskan: GitHub Actions** (`ci.yml`, `pr-base.yml`). CI tidak memakai Podman; tes integrasi memakai container layanan PostgreSQL, dan image produksi tetap dibangun lewat `scripts/release.sh`.
5. **Backup database:** frekuensi dan lokasi penyimpanan.
6. **Tenggat Asah:** tanggal demo/penilaian untuk memetakan fase 0–4. **Diputuskan: 8 Desember 2026** (lihat bagian 12).
7. **Pembagian kerja:** apa yang dibutuhkan tim AI engineer dari backend (mis. endpoint, webhook, skor risiko no-show)? Poin FR-15 s.d. FR-16 masih tentatif sampai ini jelas.
8. **Hal yang perlu diverifikasi saat implementasi:** tag image PostgreSQL yang dipakai (termasuk lokasi volume data sesuai versi), versi minor Prisma 7, opsi generator `prisma-client` (`output`, `moduleFormat`, `importFileExtension`), dan ketersediaan binary prebuilt paket hash di Alpine.

---

## Lampiran A — Skrip `package.json` (sesuai kondisi saat ini)

```json
{
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "bun run test:unit && bun run test:integration",
    "test:unit": "bun test tests/unit --coverage --pass-with-no-tests",
    "test:integration": "bun test tests/integration --pass-with-no-tests",
    "prisma:generate": "prisma generate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:seed": "bun prisma/seed.ts",
    "db:test:reset": "DATABASE_URL=\"$DATABASE_URL_TEST\" prisma migrate reset --force",
    "verify": "bun run format:check && bun run lint && bun run typecheck && bun run test:unit && bun run build"
  }
}
```

## Lampiran B — `tsconfig` (usulan)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```
`tsconfig.json` untuk editor/typecheck juga menyertakan `tests/` dan `prisma.config.ts`; `tsconfig.build.json` hanya `src/` (tanpa tests).

## Lampiran C — Kerangka `scripts/release.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

TAG="$(git rev-parse --short HEAD)"

# Gerbang B: tes integrasi di container dev
podman compose -f compose.dev.yaml up -d db
podman compose -f compose.dev.yaml run --rm api bun run test:integration

# Gerbang A: build prod (lint, typecheck, unit, build, smoke test dijalankan di stage verify)
podman build -f Dockerfile.prod --target runtime  -t nailpalace-api:"$TAG" .
podman build -f Dockerfile.prod --target migrator -t nailpalace-migrator:"$TAG" .

# Jalankan production hanya jika semua langkah di atas lolos
IMAGE_TAG="$TAG" podman compose -f compose.prod.yaml up -d
```
