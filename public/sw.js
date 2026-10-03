/* Çevrimdışı service worker.
   Kurulumda iki şey önbelleğe alınır:
     1) Uygulama kabuğu (index.html + üretilen js/css + font dosyaları).
        Dosya adları derlemede hash aldığı için buraya elle yazılamaz;
        bunun yerine index.html okunup içindeki varlıklar çıkarılır.
     2) Hareket görselleri (her hareketin başlangıç + bitiş karesi).
   Sonrasında her şey önce önbellekten okunur; internet gerekmez.
   CACHE adını değiştirmek eski önbelleği temizler. */
const CACHE = 'demir-v4'

/* ignoreVary: Bazı sunucular (ör. `vite preview`) varlıkları "Vary: Origin" ile
   gönderir. Vite'ın <script type="module" crossorigin> etiketi de isteğe Origin
   başlığı ekler; kurulumda Origin'siz saklanan kayıt bu yüzden eşleşmez ve
   uygulama çevrimdışı açılmaz. Tek origin'li bir uygulamada Vary'yi yok saymak
   doğru ve güvenlidir. */
const ESLESME = { ignoreVary: true }

// public/ex/ içindeki hareket görselleri
const EX_IDS = [
  'Leverage_Chest_Press', 'Wide-Grip_Lat_Pulldown', 'Butterfly', 'Seated_Cable_Rows',
  'Side_Lateral_Raise', 'Triceps_Pushdown', 'Standing_Biceps_Cable_Curl', 'Pullups',
  'Pushups', 'Underhand_Cable_Pulldowns', 'Hammer_Curls',
  'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench', 'One_Leg_Barbell_Squat', 'Leg_Extensions',
  'Romanian_Deadlift', 'Standing_Calf_Raises', 'Crunches', 'Natural_Glute_Ham_Raise',
  'Barbell_Hip_Thrust', 'Dumbbell_Step_Ups', 'Flat_Bench_Lying_Leg_Raise',
  'Close-Grip_Front_Lat_Pulldown', 'Push-Ups_With_Feet_Elevated', 'Bench_Dips',
  'Push-Ups_-_Close_Triceps_Position', 'Kettlebell_Pistol_Squat', 'Butt_Lift_Bridge',
  'Reverse_Hyperextension', 'Dips_-_Triceps_Version', 'Single_Leg_Glute_Bridge',
  'Standing_One-Arm_Cable_Curl',
  // kardiyo + ekipmansız
  'Running_Treadmill', 'Trail_Running_Walking', 'Walking_Treadmill', 'Bicycling_Stationary',
  'Rope_Jumping', 'Rowing_Stationary', 'Stairmaster', 'Elliptical_Trainer',
  'Mountain_Climbers', 'Plank', 'Bodyweight_Walking_Lunge', 'Glute_Kickback', 'Superman',
]
const GORSELLER = EX_IDS.flatMap((id) => [`./ex/${id}_0.jpg`, `./ex/${id}_1.jpg`])

/** index.html'i ve içindeki js/css'i, css içindeki fontları bulup listeler */
async function kabukListesi() {
  const yollar = new Set([
    './', './index.html', './manifest.webmanifest',
    './icon-192.png', './icon-512.png', './icon-maskable.png',
  ])
  try {
    const html = await fetch('./index.html', { cache: 'reload' }).then((r) => r.text())
    const varliklar = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((u) => /\.(js|css)(\?|$)/.test(u))

    for (const v of varliklar) yollar.add(v)

    // CSS dosyalarının içindeki font (woff2) referansları
    for (const cssYol of varliklar.filter((u) => /\.css(\?|$)/.test(u))) {
      const cssUrl = new URL(cssYol, self.location.href)
      const metin = await fetch(cssUrl).then((r) => r.text())
      for (const m of metin.matchAll(/url\(\s*["']?([^"')]+\.woff2?)["']?\s*\)/g)) {
        yollar.add(new URL(m[1], cssUrl).href)
      }
    }
  } catch {
    // Ağ yoksa kurulum yine de tamamlansın; çalışma anında önbelleğe alınır
  }
  return [...yollar]
}

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil((async () => {
    const c = await caches.open(CACHE)
    // Kabuk önemli — önce ve beklenerek alınır
    const kabuk = await kabukListesi()
    await Promise.allSettled(kabuk.map((u) => c.add(u)))
    // Görseller büyük; tek tek başarısız olabilir, kurulumu engellemesin
    await Promise.allSettled(GORSELLER.map((u) => c.add(u)))
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Sayfa gezinmesi: önce ağ (güncel sürüm), olmazsa önbellekteki index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const kopya = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', kopya))
          return res
        })
        .catch(async () => (await caches.match(req, ESLESME))
          || (await caches.match('./index.html', ESLESME))
          || new Response('<h1>Çevrimdışı</h1><p>Uygulamayı bir kez internete bağlıyken aç.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
    )
    return
  }

  // Diğer dosyalar (js/css/font/görsel): önce önbellek, arkada tazele
  e.respondWith(
    caches.match(req, ESLESME).then((hit) => {
      const ag = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const kopya = res.clone()
            caches.open(CACHE).then((c) => c.put(req, kopya))
          }
          return res
        })
        .catch(() => hit)
      return hit || ag
    }),
  )
})
