/* ══════════════════════════════════════════════════════════════════════════
   DEMİR — Antrenman Defteri
   Tek kullanıcılık, çevrimdışı çalışan antrenman + kilo takip uygulaması.

   Tüm uygulama mantığı bu dosyadadır. Bölümler:
     1) Yardımcı fonksiyonlar (tarih, sayı, biçimlendirme)
     2) Hareket veritabanı (teknik, hatalar, görsel, alternatifler)
     3) Varsayılan program ve varsayılan uygulama durumu
     4) Kalıcı depolama (localStorage) + store hook'u
     5) Türetilmiş veriler (rekorlar, hacim, seri, ilerleme önerileri)
     6) Arayüz parçaları (buton, kart, sayı girişi, grafik...)
     7) Ekranlar: Bugün / Antrenman / Geçmiş / İlerleme / Ayarlar
     8) Kök bileşen ve alt menü

   Veriler yalnızca cihazda (localStorage) saklanır. Sunucu, hesap, giriş yok.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

/* ═══ 1) YARDIMCILAR ═══════════════════════════════════════════════════════ */

/** Date → "2026-08-05" (yerel saate göre, UTC kaymasız) */
const iso = (d) => {
  const t = new Date(d)
  t.setMinutes(t.getMinutes() - t.getTimezoneOffset())
  return t.toISOString().slice(0, 10)
}
/** "2026-08-05" → Date (yerel gece yarısı) */
const gun = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const bugun = () => iso(new Date())
/** Bir tarihe n gün ekler, ISO döner */
const ekleGun = (s, n) => {
  const d = gun(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
/** İki ISO tarih arasındaki tam gün farkı */
const gunFark = (a, b) => Math.round((gun(b) - gun(a)) / 86400000)
/** Haftanın pazartesisi (ISO döner) */
const haftaBasi = (s) => {
  const d = gun(s)
  const k = (d.getDay() + 6) % 7 // Pazartesi = 0
  d.setDate(d.getDate() - k)
  return iso(d)
}
/** JS getDay() (0=Pazar) → program anahtarı için 0=Pazartesi..6=Pazar */
const gunIndex = (s) => (gun(s).getDay() + 6) % 7

const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const GUN_UZUN = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** "2026-08-05" → "5 Ağustos" veya "5 Ağustos 2026" */
const trTarih = (s, yil = false) => {
  const d = gun(s)
  return `${d.getDate()} ${AY[d.getMonth()]}${yil ? ' ' + d.getFullYear() : ''}`
}
/** Türkçe sayı: ondalık ayırıcı virgül. nf(69.42, 1) → "69,4" */
const nf = (n, basamak = 1) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toFixed(basamak).replace('.', ',')
}
/** İşaretli gösterim: +0,3 / −0,2. Yuvarlandığında sıfır olan değere işaret konmaz ("−0,0" olmasın) */
const nfSigned = (n, basamak = 1) => {
  const y = Number(Number(n).toFixed(basamak))
  return (y > 0 ? '+' : y < 0 ? '−' : '') + nf(Math.abs(y), basamak)
}
/** Saniye → "12:05" */
const sure = (sn) => {
  const m = Math.floor(sn / 60)
  const s = Math.floor(sn % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
/** Saniye → "1 sa 12 dk" / "42 dk". Önce toplam dakikaya yuvarlanır;
    böylece 3599 sn "60 dk" değil "1 sa 0 dk", 7170 sn "1 sa 60 dk" değil "2 sa 0 dk" olur */
const sureUzun = (sn) => {
  const top = Math.round(Math.max(0, Number(sn) || 0) / 60)
  const sa = Math.floor(top / 60)
  const dk = top % 60
  return sa > 0 ? `${sa} sa ${dk} dk` : `${dk} dk`
}
const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
const uid = () => Math.random().toString(36).slice(2, 10)
/** Bir dizinin son elemanı */
const son = (a) => (a && a.length ? a[a.length - 1] : undefined)

/* ═══ 2) HAREKET VERİTABANI ════════════════════════════════════════════════

   Alanlar:
     ad      : Türkçe isim
     en      : İnternette aratmak için İngilizce terim (YouTube linki bundan üretilir)
     kas     : Çalışan kas grupları
     tip     : 'bilesik' → set arası uzun dinlenme | 'izolasyon' → kısa dinlenme
     giris   : 'agirlik'    → kg + tekrar girilir
               'tekrar'     → sadece tekrar (vücut ağırlığı)
               'tekrar+ek'  → tekrar + istersen ek ağırlık (sırt çantası, kemer)
     img     : public/ex/ altındaki görsel öneki (_0.jpg başlangıç, _1.jpg bitiş karesi)
     teknik  : 2-3 cümlelik kısa anlatım
     hatalar : sık yapılan 1-2 hata
     alt     : alternatifler — neden: 'ekipman' (alet yok) | 'zor' (daha kolayı)
               | 'kolay' (daha zoru)
   ═══════════════════════════════════════════════════════════════════════════ */

const EX = {
  /* ---------- ÜST GÖVDE — itiş ---------- */
  chestPress: {
    ad: 'Chest Press', en: 'machine chest press proper form',
    kas: 'Göğüs, ön omuz, triceps', tip: 'bilesik', giris: 'agirlik', img: 'Leverage_Chest_Press',
    teknik: 'Sırtını ve kalçanı desteğe yapıştır, ayakların yerde sabit dursun. Kürek kemiklerini geride ve aşağıda kilitleyip kolları öne it; dirsekleri sonuna kadar kilitleme. Geri dönüşü 2 saniyede kontrollü yap, göğsünde gerilme hissettiğin noktada dur.',
    hatalar: ['Dirsekleri gövdeye tam dik (90°) açmak — omuz sıkışmasına yol açar, 45° civarında tut.',
      'Ağırlık geri giderken kürek kemiklerinin öne kaymasına izin vermek.'],
    alt: [{ id: 'chestPressTempo', neden: 'kolay' }, { id: 'chestPressTekKol', neden: 'kolay' },
      { id: 'sinavAgirlikli', neden: 'ekipman' }],
  },
  chestPressTempo: {
    ad: 'Yavaş Tempolu Chest Press', en: 'tempo chest press 3 second eccentric',
    kas: 'Göğüs, ön omuz, triceps', tip: 'bilesik', giris: 'agirlik', img: 'Leverage_Chest_Press',
    teknik: 'Aynı hareket, ama inişi 3 saniyede sayarak yap. 45 kg plaka artık hafif geliyorsa, ağırlığı değil kas altında geçen süreyi artırıyorsun. Alt noktada 1 saniye bekleyip patlayıcı şekilde it.',
    hatalar: ['Sayarken nefesini tutmak — inerken nefes al, iterken ver.',
      'İnişi hızlandırıp sadece son tekrarlarda yavaşlamak.'],
    alt: [{ id: 'chestPress', neden: 'zor' }, { id: 'chestPressTekKol', neden: 'kolay' }],
  },
  chestPressTekKol: {
    ad: 'Tek Kol Chest Press', en: 'single arm chest press',
    kas: 'Göğüs, ön omuz, triceps, gövde', tip: 'bilesik', giris: 'agirlik', img: 'Leverage_Chest_Press',
    teknik: 'Tek kolla it; aynı ağırlık tek tarafa bindiği için iki katı yük hissedersin. Boştaki elini göğsüne koy, gövdenin dönmesini engelle. Her iki tarafı da eşit tekrarla çalış.',
    hatalar: ['Gövdeyi iterken karşı tarafa döndürmek.', 'Zayıf kolu ihmal edip güçlü kolla fazla set yapmak.'],
    alt: [{ id: 'chestPress', neden: 'zor' }, { id: 'chestPressTempo', neden: 'zor' }],
  },
  kelebek: {
    ad: 'Kelebek (Pec Deck)', en: 'pec deck butterfly machine form',
    kas: 'Göğüs (özellikle iç kısım), ön omuz', tip: 'izolasyon', giris: 'agirlik', img: 'Butterfly',
    teknik: 'Dirsekler hafif bükük ve sabit kalsın; hareket sadece omuz ekleminden gelsin. Kolları önde birleştirdiğinde 1 saniye sıkıp bekle. Açarken göğsünde gerilme hissedene kadar git, omzunu zorlama.',
    hatalar: ['Dirsekleri bükerek hareketi kol çalışmasına çevirmek.', 'Fazla geriye açıp omuz ön kapsülünü zorlamak.'],
    alt: [{ id: 'kelebekTekKol', neden: 'kolay' }, { id: 'sinav', neden: 'ekipman' }],
  },
  kelebekTekKol: {
    ad: 'Tek Kol Kelebek', en: 'single arm cable chest fly',
    kas: 'Göğüs, ön omuz', tip: 'izolasyon', giris: 'agirlik', img: 'Butterfly',
    teknik: 'Tek kolla çalış, hareketi göğsünün orta hattını geçecek kadar götür. Tek taraf daha geniş hareket açıklığı verir ve zayıf tarafı yakalamanı sağlar. Karşı elinle çalışan göğsüne dokunup kasılmayı hisset.',
    hatalar: ['Gövdeyi çevirerek hile yapmak.', 'Dönüşte ağırlığı geri fırlatmak.'],
    alt: [{ id: 'kelebek', neden: 'zor' }, { id: 'sinav', neden: 'ekipman' }],
  },
  sinav: {
    ad: 'Şınav', en: 'proper push up form',
    kas: 'Göğüs, triceps, ön omuz, gövde', tip: 'bilesik', giris: 'tekrar', img: 'Pushups',
    teknik: 'Eller omuz hizasından biraz geniş, vücut baştan topuğa tek çizgi halinde. Kalçanı sıkıp karnını içeri çek, bel çukurlaşmasın. Göğsün yere birkaç santim kalana kadar in, sonra yeri iterek çık.',
    hatalar: ['Kalçayı yukarı kaldırıp hareketi kısaltmak.', 'Dirsekleri yanlara tam dik açmak — 45°ye yakın tut.'],
    alt: [{ id: 'sinavAyakYuksek', neden: 'kolay' }, { id: 'sinavAgirlikli', neden: 'kolay' },
      { id: 'darTutusSinav', neden: 'kolay' }],
  },
  sinavAyakYuksek: {
    ad: 'Ayakları Yükseltilmiş Şınav', en: 'decline push up feet elevated',
    kas: 'Üst göğüs, omuz, triceps', tip: 'bilesik', giris: 'tekrar', img: 'Push-Ups_With_Feet_Elevated',
    teknik: 'Ayaklarını sehpa, sandalye veya bench üzerine koy; yükseldikçe zorlaşır. Vücut çizgisini koru, kalçanı yukarı kaldırma. 20 tekrarı rahat geçiyorsan bir kademe daha yükselt.',
    hatalar: ['Boyunla öne uzanıp alnını yere değdirmek — göğsün insin.', 'Ayak yüksekliğini bir anda çok artırmak.'],
    alt: [{ id: 'sinav', neden: 'zor' }, { id: 'sinavAgirlikli', neden: 'kolay' }],
  },
  sinavAgirlikli: {
    ad: 'Ağırlıklı Şınav (sırt çantası)', en: 'weighted push up backpack',
    kas: 'Göğüs, triceps, ön omuz', tip: 'bilesik', giris: 'tekrar+ek', img: 'Pushups',
    teknik: 'Sırt çantasına kitap/plaka koyup sırtına al; çanta kürek kemiklerinin üstünde dursun. 5 kg ile başla, 12 tekrarı geçince 2,5 kg ekle. Formu bozulmadan yapabildiğin en ağır yükte kal.',
    hatalar: ['Çantanın belde durması — yükü omuz hizasına yaklaştır.', 'Ağırlıkla birlikte hareket açıklığını kısaltmak.'],
    alt: [{ id: 'sinav', neden: 'zor' }, { id: 'sinavAyakYuksek', neden: 'zor' }],
  },
  darTutusSinav: {
    ad: 'Dar Tutuş Şınav', en: 'close grip diamond push up',
    kas: 'Triceps, iç göğüs', tip: 'bilesik', giris: 'tekrar', img: 'Push-Ups_-_Close_Triceps_Position',
    teknik: 'Elleri göğüs genişliğinde veya baş parmaklar birleşecek kadar yakın koy. Dirsekler gövdeye yakın, geriye doğru sürtünerek insin. Triceps için normal şınavdan çok daha zordur, tekrar sayın düşecek, normal.',
    hatalar: ['Dirsekleri yanlara açmak — o zaman normal şınava dönüşür.', 'Bilek ağrısını yok saymak; ağrırsa yumruk üstünde veya tutamakla yap.'],
    alt: [{ id: 'sinav', neden: 'zor' }, { id: 'sandalyeDips', neden: 'ekipman' }],
  },
  dips: {
    ad: 'Dips (paralel bar)', en: 'parallel bar dips proper form',
    kas: 'Alt göğüs, triceps, ön omuz', tip: 'bilesik', giris: 'tekrar+ek', img: 'Dips_-_Triceps_Version',
    teknik: 'Kollar düz başla, gövdeyi hafif öne eğ (göğüs) veya dik tut (triceps). Dirsekler geriye bakacak şekilde, üst kolun yere paralel olduğu noktaya kadar in. Omzun kulağına doğru kalkmasın, kürekleri aşağıda tut.',
    hatalar: ['Çok derine inip omuz ön kapsülünü zorlamak.', 'Sallanarak momentum almak.'],
    alt: [{ id: 'sandalyeDips', neden: 'ekipman' }, { id: 'darTutusSinav', neden: 'zor' }],
  },
  sandalyeDips: {
    ad: 'Sandalye Arası Dips', en: 'bench dips triceps form',
    kas: 'Triceps, ön omuz', tip: 'bilesik', giris: 'tekrar+ek', img: 'Bench_Dips',
    teknik: 'Ellerini arkandaki sandalyenin kenarına koy, ayaklarını öne uzat. Kalçan sandalyeye yakın kayarak insin, üst kolun paralel olduğu noktada dur. Zorlaşsın istiyorsan ayaklarını ikinci bir sandalyeye koy veya kucağına ağırlık al.',
    hatalar: ['Kalçayı sandalyeden uzaklaştırıp omza yüklenmek.', 'Çok derine inmek — omuz için risklidir.'],
    alt: [{ id: 'darTutusSinav', neden: 'ekipman' }, { id: 'dips', neden: 'kolay' }],
  },

  /* ---------- ÜST GÖVDE — çekiş ---------- */
  latPulldownGenis: {
    ad: 'Lat Pulldown (geniş tutuş)', en: 'wide grip lat pulldown form',
    kas: 'Latissimus (sırt kanadı), arka omuz, biceps', tip: 'bilesik', giris: 'agirlik', img: 'Wide-Grip_Lat_Pulldown',
    teknik: 'Barı omuz genişliğinin bir buçuk katı tut, göğsünü hafif yukarı çevir. Dirsekleri aşağı-geri doğru çekerek barı köprücük kemiğine getir; kolunla değil sırtınla çek. Yukarıda kollar tam açılsın ama omuzların kulaklarına yapışmasın.',
    hatalar: ['Gövdeyi geriye yatırıp sallanarak çekmek.', 'Barı ensenin arkasına indirmek — omuz için riskli, öne çek.'],
    alt: [{ id: 'barfiks', neden: 'kolay' }, { id: 'darTutusPulldown', neden: 'zor' }],
  },
  latPulldownTers: {
    ad: 'Lat Pulldown (ters tutuş)', en: 'underhand reverse grip lat pulldown',
    kas: 'Alt latissimus, biceps', tip: 'bilesik', giris: 'agirlik', img: 'Underhand_Cable_Pulldowns',
    teknik: 'Avuç içleri sana bakacak şekilde omuz genişliğinde tut. Dirsekleri gövdene yakın tutarak barı göğüs altına çek, sırtını aşağı-geri sık. Ters tutuş biceps katkısını artırır, geniş tutuştan daha ağır kaldırırsın.',
    hatalar: ['Bilekleri geriye kırmak — bilek düz kalsın.', 'Hareketi tamamen biceps ile yapmak; dirsek liderliğini kaybetme.'],
    alt: [{ id: 'darTutusPulldown', neden: 'zor' }, { id: 'barfiks', neden: 'kolay' }],
  },
  darTutusPulldown: {
    ad: 'Dar Tutuş Lat Pulldown', en: 'close grip lat pulldown v bar',
    kas: 'Latissimus, orta sırt, biceps', tip: 'bilesik', giris: 'agirlik', img: 'Close-Grip_Front_Lat_Pulldown',
    teknik: 'V tutamak veya dar tutuşla, eller birbirine yakın. Göğsünü barı karşılamak için hafif yukarı çevir, dirsekleri gövdene sürterek aşağı çek. Barfiks çekemiyorsan bu hareket aynı kasları güvenli şekilde güçlendirir.',
    hatalar: ['Omuzları öne düşük bırakmak — göğsü açık tut.', 'Aşağıda duraklamadan hemen geri bırakmak.'],
    alt: [{ id: 'latPulldownGenis', neden: 'kolay' }, { id: 'seatedRow', neden: 'ekipman' }],
  },
  barfiks: {
    ad: 'Barfiks', en: 'pull up proper form beginner',
    kas: 'Latissimus, orta sırt, biceps, ön kol', tip: 'bilesik', giris: 'tekrar+ek', img: 'Pullups',
    teknik: 'Avuç içleri dışa bakacak şekilde omuzdan biraz geniş tut. Kürek kemiklerini önce aşağı çek, sonra dirsekleri kaburgana doğru getirerek çeneyi barın üstüne çıkar. Aşağıda tam açıl ama omuzları gevşek bırakma.',
    hatalar: ['Bacak sallayarak (kipping) momentum almak.', 'Yarım hareket açıklığı — ya tam yukarı ya tam aşağı.'],
    alt: [{ id: 'negatifBarfiks', neden: 'zor' }, { id: 'darTutusPulldown', neden: 'zor' }],
  },
  negatifBarfiks: {
    ad: 'Negatif Barfiks', en: 'negative eccentric pull up progression',
    kas: 'Latissimus, biceps, kavrama', tip: 'bilesik', giris: 'tekrar', img: 'Pullups',
    teknik: 'Sandalye veya sıçrayarak çeneni barın üstüne getir, sonra 3-5 saniyede yavaşça aşağı in. Barfiks çekemiyorsan güç kazanmanın en hızlı yolu budur. 5 tekrarlık 4 set yap, iniş süresi 5 saniyeye çıkınca normal barfiksi dene.',
    hatalar: ['Kontrolsüz düşmek — asıl iş inişte, süreyi say.', 'Aşağıda omuzları tamamen gevşetip eklemde asılı kalmak.'],
    alt: [{ id: 'darTutusPulldown', neden: 'zor' }, { id: 'barfiks', neden: 'kolay' }],
  },
  seatedRow: {
    ad: 'Seated Row', en: 'seated cable row proper form',
    kas: 'Orta sırt, romboidler, latissimus, biceps', tip: 'bilesik', giris: 'agirlik', img: 'Seated_Cable_Rows',
    teknik: 'Dizler hafif bükük, sırt dik ve göğüs açık otur. Tutamağı karın üst kısmına çek, kürek kemiklerini birbirine sık ve 1 saniye bekle. Geri bırakırken gövden öne yatmasın, sadece kollar uzasın.',
    hatalar: ['Gövdeyi ileri-geri sallayarak çekmek.', 'Omuzları yukarı kaldırmak (kas trapeze kayar).'],
    alt: [{ id: 'tekKolRow', neden: 'kolay' }, { id: 'darTutusPulldown', neden: 'ekipman' }],
  },
  tekKolRow: {
    ad: 'Tek Kol Row', en: 'single arm cable row',
    kas: 'Latissimus, orta sırt, biceps', tip: 'bilesik', giris: 'agirlik', img: 'Seated_Cable_Rows',
    teknik: 'Tek kolla çek; hareket sonunda gövdeni hafifçe o tarafa doğru açarak kürek kemiğini iyice geri götür. Tek taraflı çalışmak sağ-sol farkını kapatır. Boştaki elini dizine dayayıp gövdeni sabitle.',
    hatalar: ['Gövdeyi aşırı döndürüp beli zorlamak.', 'Zayıf tarafı güçlü tarafın tekrarına yetiştirmeye çalışmak.'],
    alt: [{ id: 'seatedRow', neden: 'zor' }, { id: 'latPulldownGenis', neden: 'ekipman' }],
  },

  /* ---------- OMUZ & KOL ---------- */
  yanKaldirma: {
    ad: 'Yan Kaldırma (tek kol, alt makara)', en: 'cable lateral raise one arm form',
    kas: 'Yan omuz (orta deltoid)', tip: 'izolasyon', giris: 'agirlik', img: 'Side_Lateral_Raise',
    teknik: 'Makarayı vücudunun önünden geçirip karşı elle tut, kolu yana doğru omuz hizasına kaldır. Dirsek hafif bükük ve sabit, küçük parmak hafif yukarıda olsun. Hafif ağırlıkla, 2 saniyede indirerek yap — burada ağırlık değil his önemli.',
    hatalar: ['Gövdeyi sallayarak ağırlığı yukarı fırlatmak.', 'Omuz hizasını geçip trapeze yüklenmek.'],
    alt: [{ id: 'yanKaldirmaCift', neden: 'ekipman' }, { id: 'yanKaldirmaEgik', neden: 'kolay' }],
  },
  yanKaldirmaCift: {
    ad: 'Çift Kol Yan Kaldırma', en: 'dumbbell lateral raise form',
    kas: 'Yan omuz (orta deltoid)', tip: 'izolasyon', giris: 'agirlik', img: 'Side_Lateral_Raise',
    teknik: 'İki elde ağırlıkla (dambıl, plaka veya su bidonu) aynı anda yana kaldır. Gövde dik, hafif öne eğilerek omuzun orta lifini hedefle. Ağırlık yoksa lastik bantla veya çok yavaş tempoyla zorlaştır.',
    hatalar: ['Dirsekleri düz kilitleyip dirsek eklemini zorlamak.', 'İnişi serbest bırakmak — indirme de çalışmanın parçası.'],
    alt: [{ id: 'yanKaldirma', neden: 'kolay' }, { id: 'yanKaldirmaEgik', neden: 'kolay' }],
  },
  yanKaldirmaEgik: {
    ad: 'Eğik Yan Kaldırma', en: 'lean away lateral raise',
    kas: 'Yan omuz — genişletilmiş hareket açıklığı', tip: 'izolasyon', giris: 'agirlik', img: 'Side_Lateral_Raise',
    teknik: 'Bir elinle direğe tutunup gövdeni çalışan kolun tersine yatır. Bu duruş omuzu hareketin en alt noktasında da gergin tutar, normalinden çok daha zor gelir. Ağırlığı düşür, tekrar sayısını koru.',
    hatalar: ['Tutunduğun kolla kendini yukarı çekmek.', 'Fazla yatıp dengeyi kaybetmek.'],
    alt: [{ id: 'yanKaldirma', neden: 'zor' }, { id: 'yanKaldirmaCift', neden: 'zor' }],
  },
  tricepsPushdown: {
    ad: 'Triceps Pushdown', en: 'triceps pushdown cable form',
    kas: 'Triceps', tip: 'izolasyon', giris: 'agirlik', img: 'Triceps_Pushdown',
    teknik: 'Dirsekleri gövdene sabitle, sadece ön kolun hareket etsin. Aşağıda kolları tam düzleştirip 1 saniye sık, yukarı çıkarken 90°yi geçme. Gövdeni öne eğip ağırlığı bastırma.',
    hatalar: ['Dirseklerin öne-arkaya kaymasına izin vermek.', 'Omuzlarla iterek hareketi göğse kaydırmak.'],
    alt: [{ id: 'darTutusSinav', neden: 'ekipman' }, { id: 'sandalyeDips', neden: 'ekipman' }],
  },
  bicepsCurl: {
    ad: 'Biceps Curl (alt makara)', en: 'cable biceps curl form',
    kas: 'Biceps', tip: 'izolasyon', giris: 'agirlik', img: 'Standing_Biceps_Cable_Curl',
    teknik: 'Dirsekler gövdenin yanında sabit, avuç içleri yukarı bakacak şekilde tut. Yukarı sadece ön kolunu getir, dirsek öne kaymasın. İnişi 2 saniyede kontrollü yap; makara sabit gerilim verdiği için dambıla göre daha yakıcıdır.',
    hatalar: ['Beli geriye atarak ağırlığı savurmak.', 'Dirseği yukarı kaldırıp omuzla çekmek.'],
    alt: [{ id: 'cekicCurl', neden: 'ekipman' }, { id: 'tekKolCurl', neden: 'kolay' }],
  },
  cekicCurl: {
    ad: 'Çekiç Curl', en: 'hammer curl proper form',
    kas: 'Biceps (brachialis), ön kol', tip: 'izolasyon', giris: 'agirlik', img: 'Hammer_Curls',
    teknik: 'Avuç içleri birbirine bakacak şekilde (çekiç tutar gibi) kaldır. Bu tutuş kolun altındaki brachialis kasını çalıştırır ve kolun kalınlığını artırır. Dirsekler sabit, sallanma yok.',
    hatalar: ['Bileği çevirip normal curl’e dönüştürmek.', 'Omuzları öne çekerek yardım almak.'],
    alt: [{ id: 'bicepsCurl', neden: 'ekipman' }, { id: 'tekKolCurl', neden: 'kolay' }],
  },
  tekKolCurl: {
    ad: 'Tek Kol Makara Curl', en: 'one arm cable curl',
    kas: 'Biceps', tip: 'izolasyon', giris: 'agirlik', img: 'Standing_One-Arm_Cable_Curl',
    teknik: 'Tek kolla, kolun gövdenin biraz arkasında kalacak şekilde çalış — biceps daha uzun bir hareket açıklığı görür. Tepe noktada bileği hafifçe dışa çevirip 1 saniye sık. Sağ-sol farkını kapatmak için zayıf kolla başla.',
    hatalar: ['Gövdeyi çalışan kolun tersine yatırmak.', 'Ağırlığı geri bırakırken kolun serbest düşmesi.'],
    alt: [{ id: 'bicepsCurl', neden: 'zor' }, { id: 'cekicCurl', neden: 'ekipman' }],
  },
  bilekCurl: {
    ad: 'Bilek Curl', en: 'wrist curl forearm exercise',
    kas: 'Ön kol (bilek bükücüler)', tip: 'izolasyon', giris: 'agirlik', img: 'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench',
    teknik: 'Ön kolunu bench veya dizine yasla, bilekler kenardan sarksın; avuç içi yukarı baksın. Ağırlığı parmak uçlarına kadar aç, sonra bileği yukarı kıvırıp sık. Kısa hareket, yüksek tekrar — 15-20 arası çalış.',
    hatalar: ['Ön kolun bench’ten kalkması — sadece bilek hareket etsin.', 'Çok ağır yükle hareket açıklığını kaybetmek.'],
    alt: [{ id: 'bilekCurlTers', neden: 'ekipman' }, { id: 'kavramaAsilma', neden: 'ekipman' }],
  },
  bilekCurlTers: {
    ad: 'Ters Bilek Curl', en: 'reverse wrist curl extensor',
    kas: 'Ön kol (bilek gericiler)', tip: 'izolasyon', giris: 'agirlik', img: 'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench',
    teknik: 'Aynı kurulum, ama avuç içi aşağı baksın. Bileği yukarı kaldırıp 1 saniye tut, yavaşça indir. Ön kolun üst yüzünü çalıştırır; normal bilek curl’den çok daha hafif ağırlık gerekir.',
    hatalar: ['Ağırlığı fazla tutup dirsekten yardım almak.', 'Hareketi çok hızlı yapmak.'],
    alt: [{ id: 'bilekCurl', neden: 'ekipman' }, { id: 'kavramaAsilma', neden: 'ekipman' }],
  },
  kavramaAsilma: {
    ad: 'Barda Asılma (kavrama)', en: 'dead hang grip strength',
    kas: 'Ön kol, kavrama, omuz stabilitesi', tip: 'izolasyon', giris: 'tekrar',
    img: 'Pullups',
    teknik: 'Bara asıl ve dayanabildiğin kadar dur; "tekrar" yerine saniye gir. Omuzları tamamen gevşetme, hafifçe aşağı çekili tut. 60 saniyeyi geçince tek kola veya ek ağırlığa geç.',
    hatalar: ['Tamamen gevşeyip omuz eklemine asılmak.', 'Nefesi tutmak.'],
    alt: [{ id: 'bilekCurl', neden: 'ekipman' }, { id: 'bilekCurlTers', neden: 'ekipman' }],
  },

  /* ---------- ALT GÖVDE ---------- */
  bulgarSplit: {
    ad: 'Bulgar Split Squat', en: 'bulgarian split squat proper form',
    kas: 'Quadriceps, kalça (gluteus), denge', tip: 'bilesik', giris: 'agirlik', perBacak: true,
    img: 'One_Leg_Barbell_Squat',
    teknik: 'Arka ayağının üstünü arkandaki bench/sandalyeye koy, ön ayağını bir adım öne al. Gövde dik, ön dizin ayak ucu yönünde bükülerek arka dizin yere yaklaşana kadar in. Ön topuğunla iterek kalk; ağırlığın %80’i ön bacakta olsun.',
    hatalar: ['Ön ayağı çok yakın koymak — diz ayak ucunu fazla geçer ve dize biner.', 'Arka bacakla itip yükü paylaştırmak.'],
    alt: [{ id: 'bulgarAgirlikli', neden: 'kolay' }, { id: 'tekBacakSquat', neden: 'kolay' },
      { id: 'stepUp', neden: 'zor' }],
  },
  bulgarAgirlikli: {
    ad: 'Ağırlıklı Bulgar Split Squat', en: 'weighted bulgarian split squat backpack',
    kas: 'Quadriceps, kalça', tip: 'bilesik', giris: 'agirlik', perBacak: true, img: 'One_Leg_Barbell_Squat',
    teknik: 'Sırt çantasına ağırlık koy veya elinde plaka/bidon tut. Vücut ağırlığıyla 12 tekrarı temiz yapabiliyorsan artık yük ekleme zamanı. 5 kg ile başla, formu koruyabildiğin en ağır yükte 8-12 tekrar hedefle.',
    hatalar: ['Ağırlıkla birlikte gövdeyi öne yatırmak.', 'Denge bozulunca hareketi yarıda kesmek — önce hafif yükle alış.'],
    alt: [{ id: 'bulgarSplit', neden: 'zor' }, { id: 'tekBacakSquat', neden: 'kolay' }],
  },
  tekBacakSquat: {
    ad: 'Tek Bacak Squat (Pistol)', en: 'pistol squat progression',
    kas: 'Quadriceps, kalça, denge, hareket açıklığı', tip: 'bilesik', giris: 'tekrar', perBacak: true,
    img: 'Kettlebell_Pistol_Squat',
    teknik: 'Tek bacak üstünde, diğer bacağı öne uzatarak çök. Başlangıçta bir sandalyeye oturup kalkarak veya kapı kenarına tutunarak çalış. Kontrolü kaybetmeden inebildiğin derinlikte kal, zamanla derinleştir.',
    hatalar: ['Topuğu yerden kaldırmak — bilek esnekliği yetmiyorsa topuk altına ince bir şey koy.', 'Kendini aşağı bırakıp zıplayarak kalkmak.'],
    alt: [{ id: 'bulgarSplit', neden: 'zor' }, { id: 'stepUp', neden: 'zor' }],
  },
  legExtension: {
    ad: 'Leg Extension', en: 'leg extension machine form',
    kas: 'Quadriceps', tip: 'izolasyon', giris: 'agirlik', img: 'Leg_Extensions',
    teknik: 'Sırtını desteğe yasla, diz ekseni makinenin dönme ekseniyle aynı hizada olsun. Bacakları tam düzleştirip 1 saniye sık, sonra 2 saniyede indir. Ağırlığı yere bırakmadan sıradaki tekrara geç.',
    hatalar: ['Kalçayı koltuktan kaldırıp sallanmak.', 'Aşağıda ağırlığı çarptırıp dinlenmek.'],
    alt: [{ id: 'bulgarSplit', neden: 'ekipman' }, { id: 'stepUp', neden: 'ekipman' }],
  },
  legCurl: {
    ad: 'Leg Curl', en: 'lying leg curl hamstring machine',
    kas: 'Hamstring (arka bacak)', tip: 'izolasyon', giris: 'agirlik', img: 'Natural_Glute_Ham_Raise',
    ekipmanYok: true,
    teknik: 'Senin istasyonunda leg curl bölümü yok — bu hareketi Nordic curl veya tek bacak RDL ile karşılıyoruz. Aleti olan bir yerde çalışırsan: karın üstü yat, topukları kalçana çek, 1 saniye sık, yavaş indir.',
    hatalar: ['Kalçayı yukarı kaldırıp beli zorlamak.', 'Ağırlığı hızla geri bırakmak.'],
    alt: [{ id: 'nordicCurl', neden: 'ekipman' }, { id: 'tekBacakRDL', neden: 'ekipman' }],
  },
  nordicCurl: {
    ad: 'Nordic Curl', en: 'nordic hamstring curl progression beginner',
    kas: 'Hamstring (eksantrik), kalça, gövde', tip: 'bilesik', giris: 'tekrar', img: 'Natural_Glute_Ham_Raise',
    teknik: 'Diz üstü otur, ayaklarını ağır bir mobilyanın altına veya istasyonun ayak sabitleme yerine sıkıştır. Gövde baştan dize kadar tek çizgi halinde, kalçadan kırılmadan öne yavaşça düş. Baştan hiç yapamaman normal: elini yere dayayıp itersin, süreyi her hafta biraz uzatırsın.',
    hatalar: ['Kalçadan kırılıp öne eğilmek — vücut düz bir çizgi kalmalı.', 'Kontrolü kaybedip yüzüstü düşmek; ellerini hep hazır tut.'],
    alt: [{ id: 'tekBacakRDL', neden: 'zor' }, { id: 'gluteBridge', neden: 'zor' }],
  },
  tekBacakRDL: {
    ad: 'Tek Bacak RDL', en: 'single leg romanian deadlift form',
    kas: 'Hamstring, kalça, bel dengeleyicileri', tip: 'bilesik', giris: 'agirlik', perBacak: true,
    img: 'Romanian_Deadlift',
    teknik: 'Tek bacak üstünde dur, diğer bacağı geriye uzatarak kalçandan öne kırıl. Sırtın düz kalsın, arka bacağın gövdenle aynı çizgide geriye gitsin. Arka bacağının hamstringinde gerilme hissettiğinde dur ve kalçanı öne iterek doğrul.',
    hatalar: ['Sırtı yuvarlamak — hareket belden değil kalçadan gelir.', 'Kalçayı yana açmak; leğen kemiği yere paralel kalsın.'],
    alt: [{ id: 'nordicCurl', neden: 'kolay' }, { id: 'gluteBridge', neden: 'zor' }],
  },
  tekBacakHipThrust: {
    ad: 'Tek Bacak Hip Thrust', en: 'single leg hip thrust form',
    kas: 'Kalça (gluteus maximus), hamstring', tip: 'bilesik', giris: 'agirlik', perBacak: true,
    img: 'Barbell_Hip_Thrust',
    teknik: 'Kürek kemiklerini bench kenarına yasla, tek ayak yerde diğeri havada. Topuğundan iterek kalçanı yukarı kaldır, tepede 1 saniye kalçanı sık. Çeneni hafif içeri çek, kaburgaları aşağıda tut — bel çukurlaşmasın.',
    hatalar: ['Beli aşırı çukurlaştırarak yukarı çıkmak — hareket kalçadan gelmeli.', 'Ayağı çok öne koyup hamstring krampı yapmak.'],
    alt: [{ id: 'gluteBridge', neden: 'zor' }, { id: 'tersHiper', neden: 'ekipman' }],
  },
  gluteBridge: {
    ad: 'Glute Bridge', en: 'glute bridge floor form',
    kas: 'Kalça (gluteus), hamstring', tip: 'izolasyon', giris: 'agirlik', img: 'Butt_Lift_Bridge',
    teknik: 'Sırt üstü yat, dizler bükük, ayaklar kalçana yakın. Topuklarından iterek kalçanı yukarı kaldır, tepede kalçanı 2 saniye sık. Yerde yapıldığı için hip thrust’tan daha kolaydır — zorlaşsın istersen tek bacakla veya kucağına plaka koyarak yap.',
    hatalar: ['Beli aşırı gerip kaburgaları açmak.', 'Ayakları çok uzağa koyup yükü hamstringe kaydırmak.'],
    alt: [{ id: 'tekBacakGluteBridge', neden: 'kolay' }, { id: 'tekBacakHipThrust', neden: 'kolay' }],
  },
  tekBacakGluteBridge: {
    ad: 'Tek Bacak Glute Bridge', en: 'single leg glute bridge',
    kas: 'Kalça, hamstring, gövde', tip: 'izolasyon', giris: 'agirlik', perBacak: true,
    img: 'Single_Leg_Glute_Bridge',
    teknik: 'Glute bridge ile aynı, ama bir bacağı havaya kaldır. Leğen kemiğin yere paralel kalsın, çalışmayan tarafa düşmesin. Tek bacak yükü ikiye katlar, ağırlığa gerek kalmadan zorlaşır.',
    hatalar: ['Kalçanın bir tarafının düşmesi.', 'Havadaki bacakla momentum almak.'],
    alt: [{ id: 'gluteBridge', neden: 'zor' }, { id: 'tekBacakHipThrust', neden: 'kolay' }],
  },
  tersHiper: {
    ad: 'Ters Hiperekstansiyon', en: 'reverse hyperextension form',
    kas: 'Kalça, hamstring, bel', tip: 'izolasyon', giris: 'tekrar', img: 'Reverse_Hyperextension',
    teknik: 'Gövden bench üstünde, kalçadan aşağısı boşta yüzüstü yat. Bacakları birleştirip kalça hizasına kadar kaldır, tepede 1 saniye sık, kontrollü indir. Bele bindirmeden kalça çalıştırmanın rahat bir yoludur.',
    hatalar: ['Bacakları kalça hizasının çok üstüne atıp beli hiperekstansiyona sokmak.', 'Sallanarak momentum almak.'],
    alt: [{ id: 'gluteBridge', neden: 'ekipman' }, { id: 'tekBacakHipThrust', neden: 'kolay' }],
  },
  stepUp: {
    ad: 'Step-up', en: 'dumbbell step up proper form',
    kas: 'Quadriceps, kalça, denge', tip: 'bilesik', giris: 'agirlik', perBacak: true, img: 'Dumbbell_Step_Ups',
    teknik: 'Diz hizasına yakın sağlam bir bench/sandalye seç. Tüm ayağını basamağa koy, arka ayakla itmeden sadece üstteki bacakla kendini yukarı çek. İnerken kontrollü in, düşer gibi bırakma.',
    hatalar: ['Arka ayakla zıplayarak yardım almak.', 'Basamağın çok yüksek olması — kalça 90°yi fazla geçmesin.'],
    alt: [{ id: 'bulgarSplit', neden: 'kolay' }, { id: 'tekBacakSquat', neden: 'kolay' }],
  },
  ayaktaKalf: {
    ad: 'Ayakta Kalf', en: 'standing calf raise form',
    kas: 'Baldır (gastrocnemius)', tip: 'izolasyon', giris: 'agirlik', img: 'Standing_Calf_Raises',
    teknik: 'Ayak ucunu bir kalasın/basamağın kenarına koy, topuklar boşta kalsın. Topukları olabildiğince aşağı indirip gerdikten sonra parmak ucuna kadar yüksel, tepede 1 saniye sık. Dizler hafif bükük değil, düz kalsın.',
    hatalar: ['Kısa hareket — asıl kazanç en alttaki gerilmede.', 'Zıplayarak seri yapmak.'],
    alt: [{ id: 'tekBacakKalf', neden: 'kolay' }, { id: 'oturarakKalf', neden: 'ekipman' }],
  },
  tekBacakKalf: {
    ad: 'Tek Bacak Kalf', en: 'single leg calf raise',
    kas: 'Baldır', tip: 'izolasyon', giris: 'agirlik', perBacak: true, img: 'Standing_Calf_Raises',
    teknik: 'Tek ayakla, bir elinle duvara veya direğe tutunarak dengeni sağla. Vücut ağırlığının tamamı tek baldıra bindiği için ekstra ağırlığa gerek kalmaz. 20 tekrarı geçersen elinde ağırlıkla yap.',
    hatalar: ['Tutunduğun kolla kendini yukarı çekmek.', 'Aşağıda gerilmeyi atlamak.'],
    alt: [{ id: 'ayaktaKalf', neden: 'zor' }, { id: 'oturarakKalf', neden: 'ekipman' }],
  },
  oturarakKalf: {
    ad: 'Oturarak Kalf', en: 'seated calf raise soleus',
    kas: 'Baldır (soleus — derin baldır kası)', tip: 'izolasyon', giris: 'agirlik', img: 'Standing_Calf_Raises',
    teknik: 'Otur, dizler 90° bükük, ayak ucu kalas üstünde; dizlerinin üstüne ağırlık koy. Diz bükükken derin baldır kası çalışır, ayaktaki versiyondan farklı bir lif grubudur. Yavaş ve tam hareket açıklığıyla 15-20 tekrar.',
    hatalar: ['Ağırlığı diz kapağının üstüne koyup ağrıtmak — biraz uyluğa doğru kaydır.', 'Hızlı zıplama tarzı tekrarlar.'],
    alt: [{ id: 'ayaktaKalf', neden: 'ekipman' }, { id: 'tekBacakKalf', neden: 'kolay' }],
  },

  /* ---------- GÖVDE / KARIN ---------- */
  mekik: {
    ad: 'Mekik', en: 'crunch proper form abs',
    kas: 'Karın (rectus abdominis)', tip: 'izolasyon', giris: 'tekrar', img: 'Crunches',
    teknik: 'Sırt üstü yat, dizler bükük, eller şakakta veya göğüste. Kaburgalarını leğen kemiğine yaklaştırır gibi omuzları yerden kaldır, belin yerde kalsın. Tepede 1 saniye sık, kontrollü in.',
    hatalar: ['Elle ensesini öne çekmek — boyun ağrısı yapar.', 'Tam oturup kalkmak; kalça fleksörleri devralır.'],
    alt: [{ id: 'mekikAgirlikli', neden: 'kolay' }, { id: 'bacakKaldirma', neden: 'kolay' }],
  },
  mekikAgirlikli: {
    ad: 'Ağırlıklı Mekik', en: 'weighted crunch plate',
    kas: 'Karın', tip: 'izolasyon', giris: 'tekrar+ek', img: 'Crunches',
    teknik: 'Göğsünde bir plaka veya ağırlık tutarak mekik yap. 20 tekrarı rahat geçiyorsan karın kası da diğerleri gibi ağırlığa ihtiyaç duyar. 5 kg ile başla, 15 tekrarda zorlanacağın yükü bul.',
    hatalar: ['Ağırlığı yukarı savurup momentum almak.', 'Boyunla öne uzanmak.'],
    alt: [{ id: 'mekik', neden: 'zor' }, { id: 'bacakKaldirma', neden: 'ekipman' }],
  },
  bacakKaldirma: {
    ad: 'Yatarak Bacak Kaldırma', en: 'lying leg raise form lower abs',
    kas: 'Alt karın, kalça fleksörleri', tip: 'izolasyon', giris: 'tekrar', img: 'Flat_Bench_Lying_Leg_Raise',
    teknik: 'Sırt üstü yat, ellerini kalçanın altına koyup beli yere yapıştır. Bacakları düz tutarak dik konuma kaldır, sonra topukların yere değmeden kontrollü indir. Belin yerden kalkmaya başladığı nokta senin sınırın.',
    hatalar: ['Belin yerden kalkması — hareket açıklığını kısalt veya dizleri hafif bük.', 'Bacakları hızla yere bırakmak.'],
    alt: [{ id: 'tersMekik', neden: 'zor' }, { id: 'mekik', neden: 'ekipman' }],
  },
  tersMekik: {
    ad: 'Ters Mekik', en: 'reverse crunch lower abs',
    kas: 'Alt karın', tip: 'izolasyon', giris: 'tekrar', img: 'Flat_Bench_Lying_Leg_Raise',
    teknik: 'Sırt üstü yat, dizler 90° bükük. Kalçanı yerden kıvırarak dizleri göğsüne getir; bacakları değil leğen kemiğini yukarı rulo yapıyorsun. Kontrollü indir, momentum kullanma.',
    hatalar: ['Bacakları sallayarak kalçayı yukarı fırlatmak.', 'Sadece kalça fleksörüyle çekip karnı devre dışı bırakmak.'],
    alt: [{ id: 'bacakKaldirma', neden: 'kolay' }, { id: 'mekik', neden: 'ekipman' }],
  },
  plank: {
    ad: 'Plank', en: 'plank proper form',
    kas: 'Karın, gövde stabilizasyonu', tip: 'izolasyon', giris: 'sure', img: 'Plank',
    teknik: 'Dirsekler omuz altında, vücut baştan topuğa tek çizgi. Kalçanı sık, karnını içeri çek, bel çukurlaşmasın. Süre bittiğinde değil, form bozulduğunda dur — 60 saniyeyi geçiyorsan tek kol/tek bacak kaldırarak zorlaştır.',
    hatalar: ['Kalçayı yukarı kaldırıp dinlenmek.', 'Beli sarkıtmak — bu bele biner, karına değil.'],
    alt: [{ id: 'mekik', neden: 'zor' }, { id: 'dagci', neden: 'kolay' }],
  },
  dagci: {
    ad: 'Dağcı (Mountain Climber)', en: 'mountain climbers form',
    kas: 'Karın, omuz, kalp-damar', tip: 'bilesik', giris: 'tekrar', img: 'Mountain_Climbers',
    teknik: 'Şınav pozisyonunda başla, dizleri sırayla göğsüne doğru hızlıca çek. Kalçan yukarı zıplamasın, omuzlar bileğin üstünde kalsın. Hem karın hem kondisyon çalıştırır.',
    hatalar: ['Kalçayı yukarı kaldırmak.', 'Ayakları yere sertçe vurmak — kontrollü ve ritmik olsun.'],
    alt: [{ id: 'plank', neden: 'zor' }, { id: 'ipAtlama', neden: 'ekipman' }],
  },
  lunge: {
    ad: 'Lunge (Hamle)', en: 'walking lunge proper form',
    kas: 'Quadriceps, kalça, denge', tip: 'bilesik', giris: 'tekrar+ek', perBacak: true,
    img: 'Bodyweight_Walking_Lunge',
    teknik: 'Bir adım öne at, arka dizin yere yaklaşana kadar çök; iki diz de yaklaşık 90° olsun. Gövde dik, ön diz ayak ucunu fazla geçmesin. Ön topuğundan iterek kalk.',
    hatalar: ['Adımı çok kısa atmak — diz öne fırlar ve zorlanır.', 'Gövdeyi öne yatırmak.'],
    alt: [{ id: 'bulgarSplit', neden: 'kolay' }, { id: 'stepUp', neden: 'zor' }],
  },
  kalcaGeri: {
    ad: 'Kalça Geri İtme', en: 'glute kickback form',
    kas: 'Kalça (gluteus)', tip: 'izolasyon', giris: 'tekrar', perBacak: true, img: 'Glute_Kickback',
    teknik: 'Dört ayak üstünde, bir bacağı diz bükük şekilde tavana doğru it. Tepede kalçanı 1 saniye sık, beli çukurlaştırma. Ekipman gerekmez, kalçayı izole eder.',
    hatalar: ['Beli aşırı gerip hareketi belden yapmak.', 'Bacağı savurup momentum kullanmak.'],
    alt: [{ id: 'gluteBridge', neden: 'kolay' }, { id: 'superman', neden: 'ekipman' }],
  },
  superman: {
    ad: 'Superman', en: 'superman exercise lower back',
    kas: 'Bel, kalça, üst sırt', tip: 'izolasyon', giris: 'tekrar', img: 'Superman',
    teknik: 'Yüzüstü yat, kolları öne uzat. Kol ve bacakları aynı anda yerden kaldır, 2 saniye tut, kontrollü indir. Bel kaslarını ekipmansız güçlendirmenin en basit yolu.',
    hatalar: ['Boynu geriye atmak — bakışın yere dönük kalsın.', 'Zıplayarak hızlı tekrar yapmak.'],
    alt: [{ id: 'tersHiper', neden: 'kolay' }, { id: 'plank', neden: 'ekipman' }],
  },

  /* ---------- KARDİYO ---------- */
  kosu: {
    ad: 'Koşu (dışarıda)', en: 'running form for beginners',
    kas: 'Kalp-damar sistemi, bacaklar', tip: 'kardiyo', giris: 'kardiyo', img: 'Trail_Running_Walking',
    teknik: 'Adımlarını kısa ve sık tut; ayağın vücudunun altına bassın, önüne değil. Omuzlar gevşek, bakış ileride. Yeni başlıyorsan 2 dakika koş / 2 dakika yürü şeklinde bölerek başla.',
    hatalar: ['Uzun adımla topuğa sert basmak — dize biner.', 'Her seferinde son hıza gitmek; koşuların çoğu konuşabileceğin tempoda olmalı.'],
    alt: [{ id: 'tempoluYuruyus', neden: 'zor' }, { id: 'bisiklet', neden: 'ekipman' }],
  },
  kosuBandi: {
    ad: 'Koşu Bandı', en: 'treadmill running form',
    kas: 'Kalp-damar sistemi, bacaklar', tip: 'kardiyo', giris: 'kardiyo', img: 'Running_Treadmill',
    teknik: 'Bandı %1 eğimle kullan — dışarıda koşmaya en yakın yük budur. Tutamaklara asılma, kollarını normal salla. Hızı konuşabildiğin ama şarkı söyleyemediğin seviyede tut.',
    hatalar: ['Tutamaklara yaslanıp yükü azaltmak.', 'Bandın en önünde koşmak; ortada kal.'],
    alt: [{ id: 'kosu', neden: 'ekipman' }, { id: 'tempoluYuruyus', neden: 'zor' }],
  },
  tempoluYuruyus: {
    ad: 'Tempolu Yürüyüş', en: 'brisk walking for fat loss',
    kas: 'Kalp-damar sistemi, bacaklar', tip: 'kardiyo', giris: 'kardiyo', img: 'Walking_Treadmill',
    teknik: 'Nefesin hızlansın ama cümle kurabil. Eklemleri yormadığı için her gün yapılabilir ve yağ yakımında koşu kadar etkilidir. Yokuş veya eğim eklersen yükü artırırsın.',
    hatalar: ['Telefonla oyalanıp tempoyu düşürmek.', 'Çok kısa tutmak — 30-45 dakika hedefle.'],
    alt: [{ id: 'kosu', neden: 'kolay' }, { id: 'bisiklet', neden: 'ekipman' }],
  },
  bisiklet: {
    ad: 'Bisiklet', en: 'stationary bike workout form',
    kas: 'Kalp-damar sistemi, quadriceps, kalça', tip: 'kardiyo', giris: 'kardiyo', img: 'Bicycling_Stationary',
    teknik: 'Sele yüksekliği: pedal en alttayken dizin hafif bükük kalmalı. Dakikada 80-90 devir hedefle, direnci buna göre ayarla. Dizlere binmediği için sakatlık dönemlerinde de kullanılır.',
    hatalar: ['Seleyi çok alçak bırakıp dizi zorlamak.', 'Direnci çok artırıp devri düşürmek.'],
    alt: [{ id: 'tempoluYuruyus', neden: 'ekipman' }, { id: 'kosu', neden: 'kolay' }],
  },
  ipAtlama: {
    ad: 'İp Atlama', en: 'jump rope technique beginner',
    kas: 'Kalp-damar sistemi, baldır, omuz', tip: 'kardiyo', giris: 'kardiyo', img: 'Rope_Jumping',
    teknik: 'İpi bilekten çevir, kolları gövdene yakın tut. Sadece birkaç santim zıpla, ayak ucuna in. Çok yorucudur — 30 saniye atla, 30 saniye dinlen şeklinde bölerek başla.',
    hatalar: ['Kolları omuzdan savurmak.', 'Yüksek zıplamak — diz ve baldırı gereksiz yorar.'],
    alt: [{ id: 'dagci', neden: 'ekipman' }, { id: 'tempoluYuruyus', neden: 'zor' }],
  },
  kurek: {
    ad: 'Kürek Makinesi', en: 'rowing machine proper technique',
    kas: 'Tüm vücut, kalp-damar sistemi', tip: 'kardiyo', giris: 'kardiyo', img: 'Rowing_Stationary',
    teknik: 'Sıralama: önce bacaklar iter, sonra gövde geriye açılır, en son kollar çeker. Dönüşte tersi. Gücün %60’ı bacaklardan gelir, kollardan değil.',
    hatalar: ['Sadece kolla çekmek.', 'Sırtı yuvarlayarak öne uzanmak.'],
    alt: [{ id: 'bisiklet', neden: 'ekipman' }, { id: 'tempoluYuruyus', neden: 'ekipman' }],
  },
  merdiven: {
    ad: 'Merdiven / Step', en: 'stair climber workout',
    kas: 'Kalça, quadriceps, kalp-damar sistemi', tip: 'kardiyo', giris: 'kardiyo', img: 'Stairmaster',
    teknik: 'Tüm ayağını basamağa koy, parmak ucunda kalma. Tutamaklara asılma; dik dur. Kalça ve bacak kaslarını yağ yakarken de çalıştırdığı için kilo verme dönemlerinde çok işe yarar.',
    hatalar: ['Korkuluğa yaslanıp yükü azaltmak.', 'Basamakları yarım basmak.'],
    alt: [{ id: 'tempoluYuruyus', neden: 'zor' }, { id: 'stepUp', neden: 'ekipman' }],
  },
  eliptik: {
    ad: 'Eliptik', en: 'elliptical trainer proper form',
    kas: 'Kalp-damar sistemi, bacaklar, kollar', tip: 'kardiyo', giris: 'kardiyo', img: 'Elliptical_Trainer',
    teknik: 'Dik dur, kolları da kullan. Eklemlere en az yük binen kardiyo türlerinden biridir. Direnci, 30 dakika boyunca sabit tempoda kalabileceğin seviyede tut.',
    hatalar: ['Öne yaslanıp ekrana asılmak.', 'Direnci sıfıra çekip sadece hızlı hareket etmek.'],
    alt: [{ id: 'bisiklet', neden: 'ekipman' }, { id: 'tempoluYuruyus', neden: 'ekipman' }],
  },
}

/* ═══ 3) VARSAYILAN PROGRAM VE DURUM ═══════════════════════════════════════ */

/* ═══ PROGRAM ŞABLONLARI ═══════════════════════════════════════════════════
   Kurulumda kullanıcı bir şablon seçer; şablon db.program ve db.ayarlar.plan'a
   kopyalanır ve oradan serbestçe düzenlenebilir.

   Antrenman alanları: ad, kisa (dar yerlerde), renk, hareketler[]
   Hareket alanları  : exId, set, hedefMin, hedefMax
                       (kardiyo hareketlerinde hedefMin/Max = DAKİKA)
                       maks: true → "maksimum tekrar", üst sınır uygulanmaz
   ═══════════════════════════════════════════════════════════════════════════ */

const DINLENME_GUNU = { ad: 'Dinlenme', kisa: 'Dinlenme', renk: 'dim', hareketler: [] }

const SABLONLAR = {
  ustAlt4: {
    ad: '4 Gün Üst / Alt',
    aciklama: 'Kas kütlesi kazanmak için en verimli bölünme. Her kas haftada iki kez çalışır.',
    etiket: ['4 gün', 'ağırlık', 'kas kütlesi'],
    plan: ['ustA', 'altA', 'dinlenme', 'ustB', 'altB', 'dinlenme', 'dinlenme'],
    antrenmanlar: {
      ustA: {
        ad: 'Üst Vücut · Güç', kisa: 'Üst Güç', renk: 'flame',
        hareketler: [
          { exId: 'chestPress', set: 4, hedefMin: 6, hedefMax: 10 },
          { exId: 'latPulldownGenis', set: 4, hedefMin: 8, hedefMax: 12 },
          { exId: 'kelebek', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'seatedRow', set: 3, hedefMin: 10, hedefMax: 12 },
          { exId: 'yanKaldirma', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'tricepsPushdown', set: 3, hedefMin: 10, hedefMax: 15 },
          { exId: 'bicepsCurl', set: 3, hedefMin: 10, hedefMax: 15 },
        ],
      },
      altA: {
        ad: 'Alt Vücut · Güç', kisa: 'Alt Güç', renk: 'steel',
        hareketler: [
          { exId: 'bulgarSplit', set: 4, hedefMin: 8, hedefMax: 12 },
          { exId: 'legExtension', set: 4, hedefMin: 12, hedefMax: 15 },
          { exId: 'tekBacakRDL', set: 3, hedefMin: 10, hedefMax: 10 },
          { exId: 'ayaktaKalf', set: 4, hedefMin: 15, hedefMax: 20 },
          { exId: 'mekik', set: 3, hedefMin: 15, hedefMax: 20 },
        ],
      },
      ustB: {
        ad: 'Üst Vücut · Hacim', kisa: 'Üst Hacim', renk: 'flame',
        hareketler: [
          { exId: 'barfiks', set: 4, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'sinav', set: 4, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'latPulldownTers', set: 3, hedefMin: 10, hedefMax: 12 },
          { exId: 'kelebek', set: 3, hedefMin: 15, hedefMax: 20 },
          { exId: 'yanKaldirma', set: 3, hedefMin: 15, hedefMax: 20 },
          { exId: 'cekicCurl', set: 3, hedefMin: 10, hedefMax: 12 },
          { exId: 'bilekCurl', set: 3, hedefMin: 15, hedefMax: 20 },
        ],
      },
      altB: {
        ad: 'Alt Vücut · Hacim', kisa: 'Alt Hacim', renk: 'steel',
        hareketler: [
          { exId: 'legExtension', set: 4, hedefMin: 10, hedefMax: 12 },
          { exId: 'nordicCurl', set: 4, hedefMin: 6, hedefMax: 10 },
          { exId: 'tekBacakHipThrust', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'stepUp', set: 3, hedefMin: 12, hedefMax: 12 },
          { exId: 'ayaktaKalf', set: 4, hedefMin: 15, hedefMax: 20 },
          { exId: 'bacakKaldirma', set: 3, hedefMin: 12, hedefMax: 15 },
        ],
      },
    },
  },

  tamVucut3: {
    ad: '3 Gün Tüm Vücut',
    aciklama: 'Yeni başlayanlar için en iyi başlangıç. Her antrenmanda tüm vücut çalışır, haftada 3 gün yeter.',
    etiket: ['3 gün', 'ağırlık', 'yeni başlayan'],
    plan: ['tamA', 'dinlenme', 'tamB', 'dinlenme', 'tamC', 'dinlenme', 'dinlenme'],
    antrenmanlar: {
      tamA: {
        ad: 'Tüm Vücut A', kisa: 'Tüm A', renk: 'gold',
        hareketler: [
          { exId: 'chestPress', set: 3, hedefMin: 8, hedefMax: 12 },
          { exId: 'latPulldownGenis', set: 3, hedefMin: 8, hedefMax: 12 },
          { exId: 'bulgarSplit', set: 3, hedefMin: 8, hedefMax: 12 },
          { exId: 'legExtension', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'yanKaldirma', set: 2, hedefMin: 12, hedefMax: 15 },
          { exId: 'plank', set: 3, hedefMin: 30, hedefMax: 60 },
        ],
      },
      tamB: {
        ad: 'Tüm Vücut B', kisa: 'Tüm B', renk: 'gold',
        hareketler: [
          { exId: 'sinav', set: 3, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'seatedRow', set: 3, hedefMin: 10, hedefMax: 12 },
          { exId: 'tekBacakRDL', set: 3, hedefMin: 10, hedefMax: 10 },
          { exId: 'ayaktaKalf', set: 3, hedefMin: 15, hedefMax: 20 },
          { exId: 'bicepsCurl', set: 2, hedefMin: 10, hedefMax: 15 },
          { exId: 'mekik', set: 3, hedefMin: 15, hedefMax: 20 },
        ],
      },
      tamC: {
        ad: 'Tüm Vücut C', kisa: 'Tüm C', renk: 'gold',
        hareketler: [
          { exId: 'kelebek', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'darTutusPulldown', set: 3, hedefMin: 10, hedefMax: 12 },
          { exId: 'stepUp', set: 3, hedefMin: 12, hedefMax: 12 },
          { exId: 'nordicCurl', set: 3, hedefMin: 6, hedefMax: 10 },
          { exId: 'tricepsPushdown', set: 2, hedefMin: 10, hedefMax: 15 },
          { exId: 'bacakKaldirma', set: 3, hedefMin: 12, hedefMax: 15 },
        ],
      },
    },
  },

  guc3Kardiyo2: {
    ad: '3 Gün Güç + 2 Gün Kardiyo',
    aciklama: 'Kilo verirken kası korumak için ideal. Ağırlık kası tutar, kardiyo yağ yakımını hızlandırır.',
    etiket: ['5 gün', 'ağırlık + kardiyo', 'kilo verme'],
    plan: ['gucA', 'kardiyoA', 'gucB', 'kardiyoB', 'gucC', 'dinlenme', 'dinlenme'],
    antrenmanlar: {
      gucA: {
        ad: 'Güç · Üst Vücut', kisa: 'Güç Üst', renk: 'flame',
        hareketler: [
          { exId: 'chestPress', set: 3, hedefMin: 8, hedefMax: 12 },
          { exId: 'latPulldownGenis', set: 3, hedefMin: 8, hedefMax: 12 },
          { exId: 'kelebek', set: 2, hedefMin: 12, hedefMax: 15 },
          { exId: 'seatedRow', set: 2, hedefMin: 10, hedefMax: 12 },
          { exId: 'tricepsPushdown', set: 2, hedefMin: 10, hedefMax: 15 },
          { exId: 'bicepsCurl', set: 2, hedefMin: 10, hedefMax: 15 },
        ],
      },
      kardiyoA: {
        ad: 'Kardiyo · Tempolu', kisa: 'Kardiyo', renk: 'jade',
        hareketler: [
          { exId: 'tempoluYuruyus', set: 1, hedefMin: 35, hedefMax: 45 },
        ],
      },
      gucB: {
        ad: 'Güç · Alt Vücut', kisa: 'Güç Alt', renk: 'steel',
        hareketler: [
          { exId: 'bulgarSplit', set: 3, hedefMin: 8, hedefMax: 12 },
          { exId: 'legExtension', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'tekBacakRDL', set: 3, hedefMin: 10, hedefMax: 10 },
          { exId: 'ayaktaKalf', set: 3, hedefMin: 15, hedefMax: 20 },
          { exId: 'mekik', set: 3, hedefMin: 15, hedefMax: 20 },
        ],
      },
      kardiyoB: {
        ad: 'Kardiyo · Aralıklı', kisa: 'Kardiyo', renk: 'jade',
        hareketler: [
          { exId: 'ipAtlama', set: 1, hedefMin: 10, hedefMax: 15 },
          { exId: 'bisiklet', set: 1, hedefMin: 20, hedefMax: 30 },
        ],
      },
      gucC: {
        ad: 'Güç · Tüm Vücut', kisa: 'Güç Tüm', renk: 'gold',
        hareketler: [
          { exId: 'sinav', set: 3, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'darTutusPulldown', set: 3, hedefMin: 10, hedefMax: 12 },
          { exId: 'stepUp', set: 3, hedefMin: 12, hedefMax: 12 },
          { exId: 'nordicCurl', set: 3, hedefMin: 6, hedefMax: 10 },
          { exId: 'yanKaldirma', set: 2, hedefMin: 12, hedefMax: 15 },
          { exId: 'plank', set: 3, hedefMin: 30, hedefMax: 60 },
        ],
      },
    },
  },

  evVucut3: {
    ad: '3 Gün Evde (ekipmansız)',
    aciklama: 'Hiçbir alet gerekmez, bir sandalye yeterli. Çekiş hareketi için lastik bant veya barfiks barı eklersen program tamamlanır.',
    etiket: ['3 gün', 'ekipmansız', 'evde'],
    plan: ['evA', 'dinlenme', 'evB', 'dinlenme', 'evC', 'dinlenme', 'dinlenme'],
    antrenmanlar: {
      evA: {
        ad: 'Evde A · İtiş', kisa: 'Ev A', renk: 'flame',
        hareketler: [
          { exId: 'sinav', set: 4, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'sandalyeDips', set: 3, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'darTutusSinav', set: 3, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'tekBacakGluteBridge', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'plank', set: 3, hedefMin: 30, hedefMax: 60 },
        ],
      },
      evB: {
        ad: 'Evde B · Bacak', kisa: 'Ev B', renk: 'steel',
        hareketler: [
          { exId: 'bulgarSplit', set: 4, hedefMin: 8, hedefMax: 12 },
          { exId: 'lunge', set: 3, hedefMin: 10, hedefMax: 15 },
          { exId: 'tekBacakSquat', set: 3, hedefMin: 5, hedefMax: 10 },
          { exId: 'ayaktaKalf', set: 4, hedefMin: 15, hedefMax: 20 },
          { exId: 'superman', set: 3, hedefMin: 12, hedefMax: 15 },
        ],
      },
      evC: {
        ad: 'Evde C · Tüm Vücut', kisa: 'Ev C', renk: 'gold',
        hareketler: [
          { exId: 'sinavAyakYuksek', set: 4, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'nordicCurl', set: 3, hedefMin: 6, hedefMax: 10 },
          { exId: 'kalcaGeri', set: 3, hedefMin: 12, hedefMax: 20 },
          { exId: 'dagci', set: 3, hedefMin: 20, hedefMax: 30 },
          { exId: 'mekik', set: 3, hedefMin: 15, hedefMax: 20 },
          { exId: 'bacakKaldirma', set: 3, hedefMin: 12, hedefMax: 15 },
        ],
      },
    },
  },

  kardiyo4: {
    ad: '4 Gün Kardiyo + Gövde',
    aciklama: 'Kondisyon ve dayanıklılık odaklı. Ağırlık antrenmanı istemeyenler veya koşuya hazırlananlar için.',
    etiket: ['4 gün', 'kardiyo', 'kondisyon'],
    plan: ['kardUzun', 'govde', 'dinlenme', 'kardAralik', 'kardUzun2', 'dinlenme', 'dinlenme'],
    antrenmanlar: {
      kardUzun: {
        ad: 'Uzun Tempo', kisa: 'Uzun', renk: 'jade',
        hareketler: [{ exId: 'kosu', set: 1, hedefMin: 30, hedefMax: 45 }],
      },
      govde: {
        ad: 'Gövde & Kuvvet', kisa: 'Gövde', renk: 'gold',
        hareketler: [
          { exId: 'sinav', set: 3, hedefMin: 1, hedefMax: 99, maks: true },
          { exId: 'bulgarSplit', set: 3, hedefMin: 10, hedefMax: 15 },
          { exId: 'plank', set: 3, hedefMin: 45, hedefMax: 90 },
          { exId: 'superman', set: 3, hedefMin: 12, hedefMax: 15 },
          { exId: 'mekik', set: 3, hedefMin: 20, hedefMax: 25 },
        ],
      },
      kardAralik: {
        ad: 'Aralıklı (HIIT)', kisa: 'Aralık', renk: 'jade',
        hareketler: [
          { exId: 'ipAtlama', set: 1, hedefMin: 10, hedefMax: 15 },
          { exId: 'dagci', set: 4, hedefMin: 20, hedefMax: 30 },
          { exId: 'bisiklet', set: 1, hedefMin: 15, hedefMax: 20 },
        ],
      },
      kardUzun2: {
        ad: 'Yürüyüş / Toparlanma', kisa: 'Yürüyüş', renk: 'jade',
        hareketler: [{ exId: 'tempoluYuruyus', set: 1, hedefMin: 40, hedefMax: 60 }],
      },
    },
  },
}

/** Şablondan çalışma programı üretir */
const sablondanProgram = (anahtar) => {
  const s = SABLONLAR[anahtar] || SABLONLAR.tamVucut3
  return JSON.parse(JSON.stringify({ ...s.antrenmanlar, dinlenme: DINLENME_GUNU }))
}
const sablondanPlan = (anahtar) => [...(SABLONLAR[anahtar] || SABLONLAR.tamVucut3).plan]

/** Hedef tipleri — kilo grafiğindeki ideal bandı ve uyarıları belirler */
const HEDEF_TIPLERI = {
  al: {
    ad: 'Kilo almak', alt: 'Kas kütlesi kazanmak', ikon: '▲',
    hizAlt: 0.25, hizUst: 0.45,
    sablon: 'ustAlt4',
  },
  ver: {
    ad: 'Kilo vermek', alt: 'Yağ yakmak, kası korumak', ikon: '▼',
    hizAlt: -0.70, hizUst: -0.35,
    sablon: 'guc3Kardiyo2',
  },
  koru: {
    ad: 'Kiloyu korumak', alt: 'Formu korumak, güçlenmek', ikon: '=',
    hizAlt: -0.15, hizUst: 0.15,
    sablon: 'tamVucut3',
  },
  yok: {
    ad: 'Kilo hedefim yok', alt: 'Sadece antrenman takibi', ikon: '—',
    hizAlt: -0.15, hizUst: 0.15,
    sablon: 'tamVucut3',
  },
}

/* Beslenme kontrol listesi — basit tik, kalori sayacı yok.
   Aşağıdakiler yalnızca başlangıç listesidir; kullanıcı Ayarlar'dan
   madde ekleyip çıkarabilir, kendi öğünlerini yazabilir. */
const BESLENME_VARSAYILAN = {
  al: [
    { id: 'b1', ad: 'Kahvaltı: protein + karbonhidrat', ikon: '🍳' },
    { id: 'b2', ad: 'Öğle: et/tavuk/balık + pilav veya makarna', ikon: '🍗' },
    { id: 'b3', ad: 'Ara öğün: shake veya kuruyemiş', ikon: '🥤' },
    { id: 'b4', ad: 'Akşam: protein + sebze', ikon: '🥗' },
    { id: 'b5', ad: 'Su (2-3 litre)', ikon: '💧' },
    { id: 'b6', ad: '7-8 saat uyku', ikon: '😴' },
  ],
  ver: [
    { id: 'b1', ad: 'Her öğünde protein (tok tutar)', ikon: '🍗' },
    { id: 'b2', ad: 'Sebze / salata', ikon: '🥗' },
    { id: 'b3', ad: 'Şekerli içecek yok', ikon: '🚫' },
    { id: 'b4', ad: 'Su (2-3 litre)', ikon: '💧' },
    { id: 'b5', ad: '8.000+ adım', ikon: '👟' },
    { id: 'b6', ad: '7-8 saat uyku', ikon: '😴' },
  ],
  koru: [
    { id: 'b1', ad: 'Her öğünde protein', ikon: '🍗' },
    { id: 'b2', ad: 'Sebze / meyve', ikon: '🥗' },
    { id: 'b3', ad: 'Su (2-3 litre)', ikon: '💧' },
    { id: 'b4', ad: '7-8 saat uyku', ikon: '😴' },
  ],
}
BESLENME_VARSAYILAN.yok = BESLENME_VARSAYILAN.koru

/** Beslenme maddesi için seçilebilecek simgeler */
const BESLENME_IKONLAR = ['🍗', '🥗', '🍳', '🥤', '💧', '😴', '💊', '🍎', '🥜', '🐟',
  '🍚', '🥛', '👟', '🚫', '☕', '🍯']

/** Çevre ölçümü alanları */
const OLCUM = [
  { id: 'kol', ad: 'Kol' }, { id: 'gogus', ad: 'Göğüs' }, { id: 'bel', ad: 'Bel' },
  { id: 'kalca', ad: 'Kalça' }, { id: 'uyluk', ad: 'Uyluk' },
]

const VARSAYILAN = () => ({
  surum: 2,
  profil: {
    ad: '',
    yas: 25, boy: 175,
    hedefTip: 'koru',              // 'al' | 'ver' | 'koru' | 'yok'
    baslangicKilo: 75, baslangicTarih: bugun(),
    hedefKilo: 75, hedefTarih: ekleGun(bugun(), 120),
    kurulumTamam: false,           // ilk açılış sihirbazı bitti mi
  },
  ayarlar: {
    sablon: 'tamVucut3',
    // 0 = Pazartesi ... 6 = Pazar
    plan: sablondanPlan('tamVucut3'),
    dinlenmeBilesik: 150,          // saniye
    dinlenmeIzolasyon: 90,
    ses: true, titresim: true,
    deloadHatirlat: true,
    haftalikHedef: 3,              // haftada kaç antrenman
    barfiksBari: false,            // çekme barı yoksa barfiks otomatik değişir
    kiloTakibi: true,              // 'yok' hedefinde kapatılabilir
    hizAlt: -0.15, hizUst: 0.15,   // haftalık ideal kilo değişim bandı (kg)
  },
  program: sablondanProgram('tamVucut3'), // kullanıcı düzenleyebilir
  beslenmeListesi: JSON.parse(JSON.stringify(BESLENME_VARSAYILAN.koru)),
  degisim: {},        // { asilExId: secilenAlternatifExId }
  antrenmanlar: [],   // tamamlanmış seanslar
  aktif: null,        // devam eden seans (sayfa yenilense de kaybolmaz)
  kilolar: [],        // [{ tarih, kg }]
  olcumler: [],       // [{ tarih, kol, gogus, bel, kalca, uyluk }]
  nabizlar: [],       // [{ tarih, bpm }]
  beslenme: {},       // { '2026-08-05': { b1:true, ... } }
  rekorlar: {},       // { exId: { agirlik, tekrar, tarih } }
})

/* ═══ 4) KALICI DEPOLAMA ═══════════════════════════════════════════════════ */

const ANAHTAR = 'demir.v1'

/** Dışarıdan gelen veriyi (localStorage ya da yedek dosyası) uygulamanın beklediği
    şekle tamamlar. Eksik alanları varsayılandan doldurur, bozuk program/planı onarır.
    Hem açılışta hem içe aktarmada kullanılır — böylece eski yedekler de sorunsuz açılır. */
function duzelt(ham) {
  const t = VARSAYILAN()
  const d = ham && typeof ham === 'object' ? ham : {}
  const yeni = { ...t, ...d,
    ayarlar: { ...t.ayarlar, ...(d.ayarlar || {}) },
    profil: { ...t.profil, ...(d.profil || {}) } }

  for (const alan of ['antrenmanlar', 'kilolar', 'olcumler', 'nabizlar']) {
    if (!Array.isArray(yeni[alan])) yeni[alan] = []
  }
  for (const alan of ['degisim', 'beslenme', 'rekorlar']) {
    if (!yeni[alan] || typeof yeni[alan] !== 'object') yeni[alan] = {}
  }
  // Program bozuk/eksikse şablondan tamamla; dinlenme günü her zaman bulunmalı
  if (!yeni.program || typeof yeni.program !== 'object' || !Object.keys(yeni.program).length) {
    yeni.program = sablondanProgram(yeni.ayarlar.sablon)
  }
  if (!yeni.program.dinlenme) yeni.program.dinlenme = { ...DINLENME_GUNU }
  if (!Array.isArray(yeni.beslenmeListesi)) {
    yeni.beslenmeListesi = JSON.parse(JSON.stringify(
      BESLENME_VARSAYILAN[yeni.profil.hedefTip] || BESLENME_VARSAYILAN.koru))
  }
  // Plan uzunluğu 7 olmalı ve var olmayan bir antrenmana işaret etmemeli
  if (!Array.isArray(yeni.ayarlar.plan) || yeni.ayarlar.plan.length !== 7) {
    yeni.ayarlar.plan = sablondanPlan(yeni.ayarlar.sablon)
  }
  yeni.ayarlar.plan = yeni.ayarlar.plan.map((k) => (yeni.program[k] ? k : 'dinlenme'))
  return yeni
}

/** Bir yedek dosyasının içeriği gerçekten bu uygulamaya ait mi? */
const yedekGecerliMi = (d) =>
  !!d && typeof d === 'object' && (Array.isArray(d.antrenmanlar) || !!d.program || !!d.profil)

const yukle = () => {
  try {
    const ham = localStorage.getItem(ANAHTAR)
    if (!ham) return VARSAYILAN()
    return duzelt(JSON.parse(ham))
  } catch {
    return VARSAYILAN()
  }
}

/** Tüm uygulama durumunu tutan hook. Her değişiklikte localStorage'a yazar. */
function useStore() {
  const [db, setDb] = useState(yukle)
  const ilk = useRef(true)

  useEffect(() => {
    if (ilk.current) { ilk.current = false; return }
    try { localStorage.setItem(ANAHTAR, JSON.stringify(db)) } catch {}
  }, [db])

  /** guncelle(d => { d.kilolar.push(...) }) — taslak üstünde değiştir, otomatik kaydedilir */
  const guncelle = useCallback((fn) => {
    setDb((eski) => {
      const taslak = JSON.parse(JSON.stringify(eski))
      fn(taslak)
      return taslak
    })
  }, [])

  return [db, guncelle, setDb]
}

/* ═══ 5) TÜRETİLMİŞ VERİLER VE KURALLAR ═══════════════════════════════════ */

/** Vücut ağırlığı hareketlerinde "artık çok kolay" sayılan tekrar eşiği */
const ZORLASTIR_ESIK = {
  sinav: 15, sinavAyakYuksek: 20, darTutusSinav: 15, sinavAgirlikli: 12,
  barfiks: 12, negatifBarfiks: 8, sandalyeDips: 20, dips: 15,
  mekik: 25, bacakKaldirma: 20, tersMekik: 20,
  nordicCurl: 10, tekBacakSquat: 12, kavramaAsilma: 60,
}

/* Çekme (barfiks) barı gerektiren hareketler ve barsız karşılıkları.
   Ayarlar'daki "Barfiks barım var" kapalıyken bunlar otomatik değiştirilir. */
const BAR_GEREKTIREN = { barfiks: 'darTutusPulldown', negatifBarfiks: 'darTutusPulldown', kavramaAsilma: 'bilekCurl' }

/** Programdaki antrenman anahtarları (dinlenme hariç), haftalık plan sırasına göre.
    Program artık sabit değil — kullanıcının seçtiği şablona göre değişir. */
const antrenmanAnahtarlari = (db) => {
  const liste = []
  for (const k of db.ayarlar.plan) {
    if (k !== 'dinlenme' && db.program[k] && !liste.includes(k)) liste.push(k)
  }
  for (const k of Object.keys(db.program)) {
    if (k !== 'dinlenme' && !liste.includes(k)) liste.push(k)
  }
  return liste
}

/** Bir program hareketinin ekranda gösterilecek gerçek hâli.
    Sıra: 1) kullanıcının seçtiği alternatif  2) ekipman kısıtı  */
const cozExId = (db, exId) => {
  const id = db.degisim?.[exId] || exId
  if (!db.ayarlar?.barfiksBari && BAR_GEREKTIREN[id]) return BAR_GEREKTIREN[id]
  return id
}

/** Bir hareketin en son yapıldığı seanstaki kaydı bulur */
function sonKayit(db, exId) {
  for (let i = db.antrenmanlar.length - 1; i >= 0; i--) {
    const s = db.antrenmanlar[i]
    const k = s.kayitlar.find((k) => k.exId === exId && k.setler.some((x) => x.bitti))
    if (k) return { tarih: s.tarih, ...k }
  }
  return null
}

/** Bir setin tek satırlık özeti — geçmiş, özet ve "geçen sefer" satırlarında kullanılır */
function setMetni(ex, s) {
  const g = ex?.giris
  if (g === 'kardiyo') return `${nf(s.dk, 0)} dk${Number(s.km) > 0 ? ` · ${nf(s.km, 1)} km` : ''}`
  if (g === 'sure') return `${nf(s.sn, 0)} sn`
  if (g === 'tekrar') return `${s.tekrar}`
  if (g === 'tekrar+ek') return Number(s.kg) > 0 ? `+${nf(s.kg, 0)}×${s.tekrar}` : `${s.tekrar}`
  return `${nf(s.kg, 0)}×${s.tekrar}`
}

/** Yeni bir set için başlangıç değerleri: varsa geçen seferki, yoksa plandaki hedef */
function setVarsayilani(ex, plan, gecenSet) {
  const g = ex?.giris
  if (g === 'kardiyo') {
    return { dk: gecenSet?.dk ?? plan?.hedefMin ?? 30, km: gecenSet?.km ?? 0, bitti: false }
  }
  if (g === 'sure') return { sn: gecenSet?.sn ?? plan?.hedefMin ?? 30, bitti: false }
  return {
    kg: gecenSet?.kg ?? 0,
    tekrar: gecenSet?.tekrar ?? (plan?.maks ? 8 : plan?.hedefMin ?? 8),
    bitti: false,
  }
}

/** Bir hareketin hedefinin okunabilir hâli: "4 × 6-10", "1 × 30-45 dk", "3 × maks" */
function hedefMetni(ex, plan) {
  if (!plan) return ''
  const birim = ex?.giris === 'kardiyo' ? ' dk' : ex?.giris === 'sure' ? ' sn' : ''
  const aralik = plan.maks ? 'maks'
    : plan.hedefMin === plan.hedefMax ? `${plan.hedefMin}${birim}`
    : `${plan.hedefMin}-${plan.hedefMax}${birim}`
  return `${plan.set} × ${aralik}`
}

/** Bir seansın toplam hacmi: Σ (ağırlık × tekrar).
    Kardiyo ve süre bazlı hareketler hacme katılmaz; onlar dakika olarak sayılır. */
function seansHacmi(seans) {
  let toplam = 0
  for (const k of seans.kayitlar) {
    const g = EX[k.exId]?.giris
    if (g === 'kardiyo' || g === 'sure') continue
    for (const s of k.setler) {
      if (!s.bitti) continue
      toplam += (Number(s.kg) || 0) * (Number(s.tekrar) || 0)
    }
  }
  return Math.round(toplam)
}

/** Seansta kardiyo/süre bazlı çalışmanın toplam dakikası */
function seansDakika(seans) {
  let dk = 0
  for (const k of seans.kayitlar) {
    const g = EX[k.exId]?.giris
    for (const s of k.setler) {
      if (!s.bitti) continue
      if (g === 'kardiyo') dk += Number(s.dk) || 0
      else if (g === 'sure') dk += (Number(s.sn) || 0) / 60
    }
  }
  return Math.round(dk)
}
/** Tamamlanan set sayısı */
const setSayisi = (seans) =>
  seans.kayitlar.reduce((t, k) => t + k.setler.filter((s) => s.bitti).length, 0)

/** Bir seansın tek satırlık iş özeti — ağırlık ve/veya kardiyo */
const seansOzetMetni = (seans) => {
  const h = seansHacmi(seans)
  const dk = seansDakika(seans)
  if (h > 0 && dk > 0) return `${h.toLocaleString('tr-TR')} kg · ${dk} dk`
  if (h > 0) return `${h.toLocaleString('tr-TR')} kg`
  if (dk > 0) return `${dk} dk kardiyo`
  return '—'
}

/** Tüm geçmişten kişisel rekorları çıkarır.
    { exId: { agirlik, tekrar, dk, km, sn, tarih } } — hareket tipine göre dolar. */
function rekorlariHesapla(antrenmanlar) {
  const r = {}
  for (const s of antrenmanlar) {
    for (const k of s.kayitlar) {
      const g = EX[k.exId]?.giris
      for (const st of k.setler) {
        if (!st.bitti) continue
        const m = (r[k.exId] ||= { agirlik: 0, tekrar: 0, dk: 0, km: 0, sn: 0, tarih: s.tarih })
        if (g === 'kardiyo') {
          const dk = Number(st.dk) || 0, km = Number(st.km) || 0
          if (dk > m.dk) { m.dk = dk; m.tarih = s.tarih }
          if (km > m.km) { m.km = km; m.tarih = s.tarih }
        } else if (g === 'sure') {
          const sn = Number(st.sn) || 0
          if (sn > m.sn) { m.sn = sn; m.tarih = s.tarih }
        } else {
          const kg = Number(st.kg) || 0, tk = Number(st.tekrar) || 0
          if (!tk) continue
          if (kg > m.agirlik) { m.agirlik = kg; m.tarih = s.tarih }
          if (tk > m.tekrar) { m.tekrar = tk; m.tarih = s.tarih }
        }
      }
    }
  }
  return r
}

/** Haftalık antrenman sayıları: { '2026-08-03': 4, ... } (anahtar = pazartesi) */
function haftalikSayim(antrenmanlar) {
  const m = {}
  for (const s of antrenmanlar) m[haftaBasi(s.tarih)] = (m[haftaBasi(s.tarih)] || 0) + 1
  return m
}

/** Seri: art arda "yeterli" antrenman yapılan hafta sayısı.
    Bir hafta en az 3 antrenmanla sayılır. İçinde bulunduğun hafta henüz
    dolmadıysa seriyi bozmaz — sadece dolduysa seriye eklenir. */
function seriHesapla(antrenmanlar) {
  const sayim = haftalikSayim(antrenmanlar)
  const EŞIK = 3
  let h = haftaBasi(bugun())
  let seri = 0
  // Bu hafta eşiği tuttuysa say, tutmadıysa bir önceki haftadan başla
  if ((sayim[h] || 0) >= EŞIK) { seri++; h = ekleGun(h, -7) }
  else h = ekleGun(h, -7)
  // Geriye doğru say
  while ((sayim[h] || 0) >= EŞIK) { seri++; h = ekleGun(h, -7) }
  return seri
}

/** Kilo kayıtlarını haftalık ortalamalara indirger — tek günlük gürültüyü siler */
function haftalikKilo(kilolar) {
  const grup = {}
  for (const k of kilolar) (grup[haftaBasi(k.tarih)] ||= []).push(Number(k.kg))
  return Object.entries(grup)
    .map(([hafta, arr]) => ({ hafta, ort: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length }))
    .sort((a, b) => (a.hafta < b.hafta ? -1 : 1))
}

/** Kilo durumu + otomatik uyarı üretimi.
    Uyarılar hedef tipine göre değişir: kilo alan biriyle veren birinin
    "iyi gidiyor" tanımı aynı değildir. */
function kiloAnaliz(db) {
  const kilolar = [...db.kilolar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1))
  const guncel = son(kilolar)
  const haftalar = haftalikKilo(kilolar)
  const buHafta = son(haftalar)
  const gecenHafta = haftalar.length >= 2 ? haftalar[haftalar.length - 2] : null
  const tip = db.profil.hedefTip || 'koru'
  const { hizAlt, hizUst } = db.ayarlar

  // Bu haftanın değişimi: bu hafta ortalaması − geçen hafta ortalaması
  const haftalikDegisim = buHafta && gecenHafta ? buHafta.ort - gecenHafta.ort : null

  const uyarilar = []
  const takipVar = db.ayarlar.kiloTakibi && tip !== 'yok'

  if (takipVar && haftalar.length >= 3) {
    const [a, b, c] = haftalar.slice(-3)
    // İki hafta üst üste neredeyse sabit (±150 g)
    if (Math.abs(b.ort - a.ort) < 0.15 && Math.abs(c.ort - b.ort) < 0.15) {
      if (tip === 'al') {
        uyarilar.push({
          tip: 'dur', baslik: 'Kilo iki haftadır sabit',
          metin: 'Kalori alımını günde ~250 kcal artır. Pratikte: bir shake daha ya da öğünlere 100 g pilav/makarna ekle.',
        })
      } else if (tip === 'ver') {
        uyarilar.push({
          tip: 'dur', baslik: 'Kilo iki haftadır sabit',
          metin: 'Günlük kaloriyi ~250 kcal azalt ya da haftaya bir kardiyo günü ekle. Adım sayını artırmak da işe yarar.',
        })
      }
    }
  }

  if (takipVar && haftalikDegisim !== null) {
    const d = haftalikDegisim
    if (tip === 'al') {
      if (d > hizUst + 0.25) uyarilar.push({
        tip: 'hizli', baslik: 'Fazla hızlı alıyorsun',
        metin: `Bu hafta ${nfSigned(d)} kg. Haftada ${nf(hizUst, 2)} kg üstü artışın büyük kısmı yağ olur — günlük kaloriyi biraz geri çek.`,
      })
      if (d < -0.2) uyarilar.push({
        tip: 'dus', baslik: 'Kilo düşüyor',
        metin: 'Kas kütlesi hedefindeyken kilo kaybı istemediğin yön. Günlük 300-400 kcal fazla yediğinden emin ol.',
      })
    } else if (tip === 'ver') {
      if (d < hizAlt - 0.3) uyarilar.push({
        tip: 'hizli', baslik: 'Fazla hızlı veriyorsun',
        metin: `Bu hafta ${nfSigned(d)} kg. Bu hızda kaybın önemli kısmı kas olur; kaloriyi biraz gevşet ve proteini artır.`,
      })
      if (d > 0.25) uyarilar.push({
        tip: 'dus', baslik: 'Kilo artıyor',
        metin: 'Hedefin kilo vermek ama artış var. Porsiyonları ve içeceklerdeki kaloriyi gözden geçir.',
      })
    } else if (tip === 'koru') {
      if (Math.abs(d) > 0.5) uyarilar.push({
        tip: 'hizli', baslik: 'Kilon oynuyor',
        metin: `Bu hafta ${nfSigned(d)} kg. Hedefin kiloyu korumak — porsiyonlarını sabitlemeye çalış.`,
      })
    }
  }
  return { guncel, haftalikDegisim, haftalar, uyarilar, kilolar, tip, takipVar }
}

/** Kişisel rekorun okunabilir hâli — hareket tipine göre değişir */
function rekorMetni(ex, r) {
  if (!r || !ex) return null
  const g = ex.giris
  if (g === 'kardiyo') {
    if (!r.dk && !r.km) return null
    return { ana: r.km > 0 ? `${nf(r.km, 1)} km` : `${r.dk} dk`,
      alt: r.km > 0 ? `en uzun ${r.dk} dk` : trTarih(r.tarih) }
  }
  if (g === 'sure') {
    if (!r.sn) return null
    return { ana: `${r.sn} sn`, alt: trTarih(r.tarih) }
  }
  if (!r.agirlik && !r.tekrar) return null
  return {
    ana: r.agirlik > 0 ? `${nf(r.agirlik, 1)} kg` : `${r.tekrar} tekrar`,
    alt: r.agirlik > 0 ? `en çok ${r.tekrar} tekrar` : trTarih(r.tarih),
  }
}

/** Haftalık kilo değişiminin hedefe göre rengi: bantta yeşil, sapmada sarı/kırmızı */
function degisimRengi(db, d) {
  if (d === null || d === undefined) return 'text-bone'
  const { hizAlt, hizUst } = db.ayarlar
  if (d >= hizAlt && d <= hizUst) return 'text-jade'
  if (d > hizUst + 0.25 || d < hizAlt - 0.25) return 'text-blood'
  return 'text-gold'
}

/** Bir harekette ağırlık artırma / zorlaştırma zamanı geldi mi? */
function ilerlemeOnerisi(db, exId, plan) {
  const ex = EX[exId]
  // Kardiyo ve süre bazlı hareketlerde "ağırlığı artır" önerisi anlamsız
  if (!ex || ex.giris === 'kardiyo' || ex.giris === 'sure') return null
  const kayit = sonKayit(db, exId)
  if (!kayit) return null
  const bitenler = kayit.setler.filter((s) => s.bitti && Number(s.tekrar) > 0)
  if (bitenler.length < 2) return null
  const esik = ZORLASTIR_ESIK[exId]

  // Vücut ağırlığı / "maksimum tekrar" hareketleri → zorlaştırma önerisi
  if (esik && (ex.giris === 'tekrar' || plan?.maks)) {
    if (bitenler.every((s) => Number(s.tekrar) >= esik)) {
      const zor = (ex.alt || []).find((a) => a.neden === 'kolay')
      return {
        tip: 'zorlastir',
        metin: `Bu harekette ${esik}+ tekrar yapıyorsun — artık çok kolay geliyor. Zorlaştırma zamanı.`,
        oneri: zor ? `Öneri: ${EX[zor.id].ad}` : 'Tempoyu yavaşlat veya ek ağırlık kullan.',
        altId: zor?.id || null,
      }
    }
    return null
  }

  // Ağırlıklı hareketler → tüm setlerde üst tekrar sınırına ulaşıldıysa
  const max = plan?.hedefMax ?? 12
  if (max < 90 && bitenler.every((s) => Number(s.tekrar) >= max)) {
    return {
      tip: 'agirlikArtir',
      metin: 'Bu harekette ağırlığı artırma zamanı — bir kademe yukarı çık ve alt tekrar sınırına dön.',
      oneri: `Hedef: ${plan?.hedefMin ?? 8} tekrar ile yeniden başla.`,
      altId: null,
    }
  }
  return null
}

/** Deload (hafifletme) haftası zamanı mı? Başlangıçtan itibaren her 6 haftada bir. */
function deloadDurumu(db) {
  if (!db.ayarlar.deloadHatirlat) return null
  const gecen = gunFark(db.profil.baslangicTarih, bugun())
  if (gecen < 0) return null
  const hafta = Math.floor(gecen / 7) + 1
  if (hafta > 1 && hafta % 6 === 0) {
    return { hafta, metin: `${hafta}. haftadasın — bu hafta deload: ağırlıkları %40 düşür, set sayısını yarıya indir. Vücut bu hafta toparlanıp daha güçlü döner.` }
  }
  return null
}

/* ═══ 6) ARAYÜZ PARÇALARI ══════════════════════════════════════════════════ */

/** Titreşim + kısa bip. Ses dosyası yok — WebAudio ile üretilir (çevrimdışı çalışır). */
function useAlarm(ayarlar) {
  const ctxRef = useRef(null)
  return useCallback((güçlü = false) => {
    if (ayarlar.titresim && navigator.vibrate) {
      navigator.vibrate(güçlü ? [220, 90, 220, 90, 320] : 60)
    }
    if (!ayarlar.ses) return
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = (ctxRef.current ||= new AC())
      if (ctx.state === 'suspended') ctx.resume()
      const bip = (t, f) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'sine'; o.frequency.value = f
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t)
        g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22)
        o.connect(g); g.connect(ctx.destination)
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25)
      }
      if (güçlü) { bip(0, 880); bip(0.26, 880); bip(0.52, 1170) } else bip(0, 660)
    } catch {}
  }, [ayarlar.ses, ayarlar.titresim])
}

/** Antrenman sırasında telefon ekranı kapanmasın.
    Android uygulamasında bunu Java tarafı yapar (WebView'de wakeLock yoktur). */
function useEkranAcik(aktifMi) {
  useEffect(() => {
    if (window.Android?.ekranAcikTut) {
      window.Android.ekranAcikTut(!!aktifMi)
      return () => window.Android.ekranAcikTut(false)
    }
    if (!aktifMi || !('wakeLock' in navigator)) return
    let kilit = null
    let iptal = false
    const al = async () => {
      try { kilit = await navigator.wakeLock.request('screen') } catch {}
    }
    al()
    const geri = () => { if (document.visibilityState === 'visible' && !iptal) al() }
    document.addEventListener('visibilitychange', geri)
    return () => {
      iptal = true
      document.removeEventListener('visibilitychange', geri)
      document.removeEventListener('visibilitychange', geri)
      try { kilit?.release() } catch {}
    }
  }, [aktifMi])
}

/* Antrenman renkleri. Program artık serbest tanımlı olduğu için renk,
   antrenmanın kendi "renk" alanından okunur (üst/alt varsayımı yapılmaz).
   Tailwind sınıfları kaynakta birebir geçmeli, bu yüzden tam isimler yazılı. */
const RENK_ZEMIN = { flame: 'bg-flame', steel: 'bg-steel', jade: 'bg-jade', gold: 'bg-gold', dim: 'bg-line2' }
const RENK_METIN = { flame: 'text-flame2', steel: 'text-steel', jade: 'text-jade', gold: 'text-gold', dim: 'text-dim' }
const RENK_NOKTA = { flame: 'bg-flame', steel: 'bg-steel', jade: 'bg-jade', gold: 'bg-gold', dim: 'bg-line2' }
const zeminRengi = (db, k) => RENK_ZEMIN[db.program?.[k]?.renk] || 'bg-flame'
const metinRengi = (db, k) => RENK_METIN[db.program?.[k]?.renk] || 'text-flame2'

const TIP = {
  ana: 'bg-flame text-white active:bg-flame/80 shadow-[0_6px_20px_-6px_rgba(255,74,23,.7)]',
  sade: 'bg-slab2 text-bone active:bg-line border border-line',
  hayalet: 'bg-transparent text-ash active:bg-slab2 border border-line',
  tehlike: 'bg-blood/15 text-blood border border-blood/40 active:bg-blood/25',
  altin: 'bg-gold text-ink active:bg-gold/80',
}

/** Standart buton — her yerde en az 44px yükseklik (parmakla rahat basılır) */
function Btn({ tip = 'sade', className = '', kucuk = false, ...p }) {
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold
        transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100
        ${kucuk ? 'min-h-[38px] px-3 text-sm' : 'min-h-[48px] px-4 text-[15px]'}
        ${TIP[tip]} ${className}`}
    />
  )
}

function Kart({ className = '', ...p }) {
  return <div {...p} className={`rounded-2xl bg-slab border border-line/70 ${className}`} />
}

/** Bölüm başlığı — solunda ince turuncu çizgi */
function Baslik({ children, sag }) {
  return (
    <div className="flex items-end justify-between mb-2.5 mt-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.16em] text-ash flex items-center gap-2">
        <span className="w-3 h-[2px] bg-flame rounded-full" />
        {children}
      </h2>
      {sag}
    </div>
  )
}

function Rozet({ renk = 'ash', children, className = '' }) {
  const r = {
    ash: 'bg-slab2 text-ash border-line',
    flame: 'bg-flame/12 text-flame2 border-flame/30',
    jade: 'bg-jade/12 text-jade border-jade/30',
    gold: 'bg-gold/12 text-gold border-gold/30',
    steel: 'bg-steel/12 text-steel border-steel/30',
    blood: 'bg-blood/12 text-blood border-blood/30',
  }[renk]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${r} ${className}`}>
      {children}
    </span>
  )
}

/* Açık panel sayacı: iç içe paneller kapanırken sayfa kaydırma kilidi erken açılmasın */
let _acikPanel = 0
/* Açık panellerin kapatma fonksiyonları — Android'in geri tuşu en üsttekini kapatır */
const GERI_YIGINI = []

/** Alttan açılan panel — mobilde tek elle kapatılabilir */
function Sheet({ acik, kapat, baslik, children, tam = false }) {
  useEffect(() => {
    if (!acik) return
    const esc = (e) => e.key === 'Escape' && kapat()
    document.addEventListener('keydown', esc)
    _acikPanel++
    GERI_YIGINI.push(kapat)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      _acikPanel = Math.max(0, _acikPanel - 1)
      const i = GERI_YIGINI.lastIndexOf(kapat)
      if (i >= 0) GERI_YIGINI.splice(i, 1)
      if (_acikPanel === 0) document.body.style.overflow = ''
    }
  }, [acik, kapat])
  if (!acik) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[3px]" onClick={kapat} />
      <div
        className={`relative w-full max-w-lg bg-coal border-t border-line rounded-t-3xl
          ${tam ? 'h-[92vh]' : 'max-h-[88vh]'} flex flex-col rise`}
      >
        <div className="shrink-0 pt-2.5 pb-1 flex justify-center" onClick={kapat}>
          <div className="w-11 h-1.5 rounded-full bg-line2" />
        </div>
        {baslik && (
          <div className="shrink-0 px-4 pb-2.5 flex items-center justify-between border-b border-line/60">
            <h3 className="text-lg font-semibold">{baslik}</h3>
            <button onClick={kapat} aria-label="Kapat"
              className="w-9 h-9 rounded-full bg-slab2 text-ash active:bg-line grid place-items-center text-xl leading-none">
              ×
            </button>
          </div>
        )}
        <div className="overflow-y-auto overscroll-contain px-4 py-4 pb-safe">{children}</div>
      </div>
    </div>
  )
}

/** Onay penceresi — geri alınamaz işlemler için */
function Onay({ acik, kapat, baslik, metin, onayla, onayMetin = 'Evet, sil', tehlike = true }) {
  if (!acik) return null
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-5">
      <div className="absolute inset-0 bg-black/75" onClick={kapat} />
      <Kart className="relative w-full max-w-sm p-5 rise">
        <h3 className="text-xl mb-2">{baslik}</h3>
        <p className="text-sm text-ash leading-relaxed mb-5">{metin}</p>
        <div className="flex gap-2.5">
          <Btn tip="hayalet" className="flex-1" onClick={kapat}>Vazgeç</Btn>
          <Btn tip={tehlike ? 'tehlike' : 'ana'} className="flex-1"
            onClick={() => { onayla(); kapat() }}>{onayMetin}</Btn>
        </div>
      </Kart>
    </div>
  )
}

/** Kısa bilgi mesajı — ekranın üstünde belirir, kendiliğinden kaybolur.
    (Tarayıcının alert() kutusu WebView'de çalışmadığı için kendi bildirimimiz) */
function Bildirim({ veri, kapat }) {
  useEffect(() => {
    if (!veri) return
    const t = setTimeout(kapat, 4000)
    return () => clearTimeout(t)
  }, [veri])
  if (!veri) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[70] pt-safe px-3 pointer-events-none">
      <div className={`max-w-lg mx-auto mt-2 rounded-2xl px-4 py-3 flex items-start gap-3 rise
        shadow-[0_10px_30px_-10px_rgba(0,0,0,.8)]
        ${veri.tip === 'hata' ? 'bg-blood text-white' : 'bg-jade text-ink'}`}>
        <span className="text-lg leading-none mt-0.5 shrink-0">{veri.tip === 'hata' ? '⚠' : '✓'}</span>
        <span className="text-[13.5px] font-semibold leading-snug">{veri.metin}</span>
      </div>
    </div>
  )
}

/** Büyük dokunma alanlı sayı girişi: [−] [ 32,5 ] [+]
    kompakt: dar ekranda yan yana birden fazla sayaç sığsın diye küçültülmüş sürüm */
function Sayac({ deger, ayarla, adim = 2.5, min = 0, max = 999, birim, etiket,
  className = 'flex-1', kompakt = false }) {
  const d = Number(deger)
  const degistir = (fark) => ayarla(clamp(Math.round((d + fark) * 100) / 100, min, max))
  const btn = kompakt ? 'w-9 text-xl' : 'w-11 text-2xl'
  return (
    <div className={`min-w-0 ${className}`}>
      {etiket && <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1 font-semibold truncate">{etiket}</div>}
      <div className="flex items-stretch rounded-xl bg-slab2 border border-line overflow-hidden">
        <button onClick={() => degistir(-adim)} aria-label="Azalt"
          className={`${btn} shrink-0 grid place-items-center text-ash active:bg-line leading-none font-light`}>−</button>
        <input
          type="number" inputMode="decimal" value={deger}
          onFocus={(e) => e.target.select()}
          onChange={(e) => ayarla(e.target.value === '' ? '' : Number(e.target.value))}
          onBlur={(e) => ayarla(clamp(Number(e.target.value) || 0, min, max))}
          className={`flex-1 min-w-0 w-full bg-transparent text-center font-display tabular-nums
            outline-none focus:bg-flame/5 ${kompakt ? 'text-lg py-2' : 'text-xl py-2.5'}`}
        />
        {birim && !kompakt && <span className="self-center pr-1 text-xs text-dim font-semibold">{birim}</span>}
        <button onClick={() => degistir(adim)} aria-label="Artır"
          className={`${btn} shrink-0 grid place-items-center text-ash active:bg-line leading-none font-light`}>+</button>
      </div>
    </div>
  )
}

/** Basit metin/sayı alanı */
function Alan({ etiket, birim, className = '', ...p }) {
  return (
    <label className={`block ${className}`}>
      {etiket && <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1 font-semibold">{etiket}</div>}
      <div className="flex items-center rounded-xl bg-slab2 border border-line focus-within:border-flame/60">
        <input {...p}
          className="flex-1 min-w-0 bg-transparent px-3 py-3 outline-none text-[15px] font-display tabular-nums" />
        {birim && <span className="pr-3 text-xs text-dim font-semibold">{birim}</span>}
      </div>
    </label>
  )
}

/** Aç/kapa anahtarı */
function Anahtar({ acik, degistir, etiket, alt }) {
  return (
    <button onClick={() => degistir(!acik)}
      className="w-full flex items-center justify-between gap-3 py-3 text-left active:opacity-70">
      <span className="min-w-0">
        <span className="block text-[15px]">{etiket}</span>
        {alt && <span className="block text-xs text-dim mt-0.5 leading-snug">{alt}</span>}
      </span>
      <span className={`shrink-0 w-[52px] h-[30px] rounded-full p-[3px] transition-colors
        ${acik ? 'bg-flame' : 'bg-line2'}`}>
        <span className={`block w-6 h-6 rounded-full bg-white transition-transform
          ${acik ? 'translate-x-[22px]' : ''}`} />
      </span>
    </button>
  )
}

/** İstatistik kutusu */
function Stat({ ust, deger, alt, renk = 'text-bone', className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim font-semibold truncate">{ust}</div>
      <div className={`num text-2xl leading-tight mt-0.5 ${renk}`}>{deger}</div>
      {alt && <div className="text-[11px] text-ash mt-0.5 truncate">{alt}</div>}
    </div>
  )
}

/* ─── Grafikler: harici kütüphane yok, hepsi elde çizilmiş SVG ─── */

/** Kilo grafiği: veri çizgisi + ideal artış bandı (haftada +0,3 … +0,4 kg) */
function KiloGrafik({ db, mod, setMod }) {
  const { kilolar } = kiloAnaliz(db)
  const p = db.profil
  const W = 340, H = 205
  const L = 30, R = 10, T = 14, B = 24

  if (kilolar.length === 0) {
    return (
      <div className="h-[180px] grid place-items-center text-center text-sm text-dim px-6">
        Henüz kilo girişi yok.<br />İlk ölçümünü ekleyince grafik burada belirir.
      </div>
    )
  }

  // x ekseni aralığı: "şimdiye kadar" veya tüm 4 aylık plan
  const ilk = p.baslangicTarih
  const sonVeri = son(kilolar).tarih
  const bit = mod === 'plan' ? p.hedefTarih
    : ekleGun(sonVeri > bugun() ? sonVeri : bugun(), 3)
  const gunSayisi = Math.max(7, gunFark(ilk, bit))
  const x = (t) => L + (clamp(gunFark(ilk, t), 0, gunSayisi) / gunSayisi) * (W - L - R)

  // İdeal bant: başlangıç kilosundan haftada hizAlt … hizUst kg
  // (kilo alma hedefinde artı, verme hedefinde eksi değerlerdir)
  const hizA = db.ayarlar.hizAlt, hizU = db.ayarlar.hizUst
  const bant = (hiz, t) => p.baslangicKilo + (hiz * gunFark(ilk, t)) / 7
  const bantSon1 = bant(hizA, bit), bantSon2 = bant(hizU, bit)

  const degerler = kilolar.map((k) => Number(k.kg))
  let lo = Math.min(...degerler, p.baslangicKilo, bantSon1, bantSon2) - 0.7
  let hi = Math.max(...degerler, p.baslangicKilo, bantSon1, bantSon2) + 0.7
  if (mod === 'plan') { lo = Math.min(lo, p.hedefKilo - 0.5); hi = Math.max(hi, p.hedefKilo + 0.5) }
  const y = (kg) => T + (1 - (kg - lo) / (hi - lo)) * (H - T - B)

  const nokta = kilolar.map((k) => `${x(k.tarih)},${y(Number(k.kg))}`)
  const yEtiket = [lo, (lo + hi) / 2, hi]

  return (
    <div>
      <div className="flex gap-1.5 mb-2">
        {[['simdi', 'Şimdiye kadar'], ['plan', 'Tüm plan']].map(([k, ad]) => (
          <button key={k} onClick={() => setMod(k)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors
              ${mod === k ? 'bg-flame/15 text-flame2 border-flame/40' : 'bg-slab2 text-dim border-line'}`}>
            {ad}
          </button>
        ))}
      </div>
      {/* SVG içindeki yazılar da uygulama fontunu kullansın (varsayılan serif'e düşmesin) */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Kilo değişim grafiği"
        style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}>
        {/* yatay ızgara + y ekseni etiketleri */}
        {yEtiket.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#292d33" strokeWidth="1" />
            <text x={L - 5} y={y(v) + 3.5} textAnchor="end" fill="#656b74" fontSize="9">
              {nf(v, 1)}
            </text>
          </g>
        ))}

        {/* ideal değişim bandı */}
        <polygon
          points={`${x(ilk)},${y(p.baslangicKilo)} ${x(bit)},${y(bantSon1)} ${x(bit)},${y(bantSon2)} ${x(ilk)},${y(p.baslangicKilo)}`}
          fill="#45d483" opacity="0.13"
        />
        <line x1={x(ilk)} y1={y(p.baslangicKilo)} x2={x(bit)} y2={y(bantSon1)}
          stroke="#45d483" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        <line x1={x(ilk)} y1={y(p.baslangicKilo)} x2={x(bit)} y2={y(bantSon2)}
          stroke="#45d483" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />

        {/* hedef kilo çizgisi */}
        {mod === 'plan' && p.hedefKilo <= hi && (
          <>
            <line x1={L} x2={W - R} y1={y(p.hedefKilo)} y2={y(p.hedefKilo)}
              stroke="#f5c518" strokeWidth="1.2" strokeDasharray="5 4" opacity="0.75" />
            <text x={W - R} y={y(p.hedefKilo) - 4} textAnchor="end" fill="#f5c518" fontSize="9" fontWeight="700">
              hedef {nf(p.hedefKilo, 1)}
            </text>
          </>
        )}

        {/* veri çizgisi + noktalar */}
        {nokta.length > 1 && (
          <polyline points={nokta.join(' ')} fill="none" stroke="#ff4a17"
            strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {kilolar.map((k, i) => (
          <circle key={i} cx={x(k.tarih)} cy={y(Number(k.kg))} r={i === kilolar.length - 1 ? 3.6 : 1.9}
            fill={i === kilolar.length - 1 ? '#ff4a17' : '#ff7a45'}
            stroke={i === kilolar.length - 1 ? '#0e0f11' : 'none'} strokeWidth="1.5" />
        ))}

        {/* x ekseni: başlangıç ve bitiş tarihi */}
        <text x={L} y={H - 6} fill="#656b74" fontSize="9">{trTarih(ilk)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" fill="#656b74" fontSize="9">{trTarih(bit)}</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim mt-1 px-1">
        <span className="flex items-center gap-1.5"><i className="block w-3.5 h-[2px] bg-flame rounded-full shrink-0" />Kilon</span>
        <span className="flex items-center gap-1.5"><i className="block w-3.5 h-2.5 bg-jade/25 border border-jade/60 rounded-[2px] shrink-0" />
          İdeal bant ({nfSigned(hizA, 2)}…{nfSigned(hizU, 2)} kg/hafta)</span>
      </div>
    </div>
  )
}

/** Bir hareketin zaman içindeki gelişimi.
    Hareket tipine göre iki seri çizilir:
      ağırlık hareketi → kg (turuncu) + tekrar (mavi)
      kardiyo          → dakika (turuncu) + mesafe (mavi)
      süre bazlı       → saniye (turuncu) */
function HareketGrafik({ db, exId }) {
  const ex = EX[exId]
  const g = ex.giris
  const veri = []
  for (const s of db.antrenmanlar) {
    const k = s.kayitlar.find((k) => k.exId === exId)
    if (!k) continue
    const bit = k.setler.filter((x) => x.bitti)
    if (!bit.length) continue
    if (g === 'kardiyo') {
      const e = bit.reduce((a, b) => ((Number(b.dk) || 0) > (Number(a.dk) || 0) ? b : a))
      veri.push({ tarih: s.tarih, a: Number(e.dk) || 0, b: Number(e.km) || 0 })
    } else if (g === 'sure') {
      const e = bit.reduce((a, b) => ((Number(b.sn) || 0) > (Number(a.sn) || 0) ? b : a))
      veri.push({ tarih: s.tarih, a: Number(e.sn) || 0, b: null })
    } else {
      const dolu = bit.filter((x) => Number(x.tekrar) > 0)
      if (!dolu.length) continue
      const e = dolu.reduce((a, b) =>
        ((Number(b.kg) || 0) * Number(b.tekrar) > (Number(a.kg) || 0) * Number(a.tekrar) ? b : a))
      veri.push({
        tarih: s.tarih,
        a: g === 'tekrar' ? null : Number(e.kg) || 0,
        b: Number(e.tekrar) || 0,
      })
    }
  }
  if (veri.length < 2) {
    return <div className="h-[130px] grid place-items-center text-sm text-dim text-center px-6">
      Grafik için en az iki antrenman kaydı gerekiyor.
    </div>
  }

  const etiketA = g === 'kardiyo' ? 'Süre (dk)' : g === 'sure' ? 'Süre (sn)' : 'Ağırlık (kg)'
  const etiketB = g === 'kardiyo' ? 'Mesafe (km)' : 'Tekrar'
  const varA = veri.some((v) => v.a !== null)
  const varB = veri.some((v) => v.b !== null && v.b > 0)

  const W = 340, H = 155, L = 28, R = 28, T = 12, B = 20
  const xs = (i) => L + (i / (veri.length - 1)) * (W - L - R)
  const eksen = (dizi) => {
    const lo = Math.min(...dizi) * 0.9, hi = (Math.max(...dizi) * 1.06) || 1
    return (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B)
  }
  const asA = veri.filter((v) => v.a !== null).map((v) => v.a)
  const asB = veri.filter((v) => v.b !== null).map((v) => v.b)
  const yA = varA ? eksen(asA) : null
  const yB = varB ? eksen(asB) : null

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full"
        style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#292d33" />
        {varA && (
          <>
            <polyline points={veri.map((v, i) => `${xs(i)},${yA(v.a)}`).join(' ')}
              fill="none" stroke="#ff4a17" strokeWidth="2.2" strokeLinejoin="round" />
            {veri.map((v, i) => <circle key={i} cx={xs(i)} cy={yA(v.a)} r="2.6" fill="#ff4a17" />)}
            <text x={L - 4} y={yA(Math.max(...asA)) + 3} textAnchor="end" fill="#ff7a45" fontSize="9">{nf(Math.max(...asA), 0)}</text>
            <text x={L - 4} y={yA(Math.min(...asA)) + 3} textAnchor="end" fill="#ff7a45" fontSize="9">{nf(Math.min(...asA), 0)}</text>
          </>
        )}
        {varB && (
          <>
            <polyline points={veri.map((v, i) => `${xs(i)},${yB(v.b)}`).join(' ')}
              fill="none" stroke="#5aa9e6" strokeWidth="1.8" strokeDasharray={varA ? '4 3' : ''} />
            {veri.map((v, i) => <circle key={i} cx={xs(i)} cy={yB(v.b)} r="2.2" fill="#5aa9e6" />)}
            <text x={W - R + 4} y={yB(Math.max(...asB)) + 3} fill="#5aa9e6" fontSize="9">{nf(Math.max(...asB), 0)}</text>
            <text x={W - R + 4} y={yB(Math.min(...asB)) + 3} fill="#5aa9e6" fontSize="9">{nf(Math.min(...asB), 0)}</text>
          </>
        )}
        <text x={L} y={H - 6} fill="#656b74" fontSize="9">{trTarih(veri[0].tarih)}</text>
        <text x={W - R} y={H - 6} textAnchor="end" fill="#656b74" fontSize="9">{trTarih(son(veri).tarih)}</text>
      </svg>
      <div className="flex gap-4 text-[11px] text-dim px-1">
        {varA && <span className="flex items-center gap-1.5"><i className="block w-3 h-[2px] bg-flame rounded shrink-0" />{etiketA}</span>}
        {varB && <span className="flex items-center gap-1.5"><i className="block w-3 h-[2px] bg-steel rounded shrink-0" />{etiketB}</span>}
      </div>
    </div>
  )
}

/* ─── Hareket görseli ─── */

/** free-exercise-db karelerini (başlangıç/bitiş) dönüşümlü göstererek hareketi canlandırır.
    Görsel yüklenemezse basit bir SVG çizime düşer. */
function HareketGorseli({ ex, className = '', oynat = true }) {
  const [kare, setKare] = useState(0)
  const [hata, setHata] = useState(false)
  useEffect(() => {
    if (!oynat || hata || !ex.img) return
    const t = setInterval(() => setKare((k) => 1 - k), 900)
    return () => clearInterval(t)
  }, [oynat, hata, ex.img])

  if (!ex.img || hata) {
    return (
      <div className={`grid place-items-center bg-slab2 hatch ${className}`}>
        <div className="text-center px-4 py-6">
          {/* Görsel yoksa: halter simgesi + kas grubu */}
          <svg viewBox="0 0 64 34" className="w-20 mx-auto mb-2 opacity-70">
            <rect x="6" y="14" width="52" height="6" rx="3" fill="#ff4a17" />
            <rect x="12" y="6" width="9" height="22" rx="3.5" fill="#ff4a17" />
            <rect x="43" y="6" width="9" height="22" rx="3.5" fill="#ff4a17" />
            <rect x="2" y="11" width="6" height="12" rx="3" fill="#ff4a17" opacity=".7" />
            <rect x="56" y="11" width="6" height="12" rx="3" fill="#ff4a17" opacity=".7" />
          </svg>
          <div className="text-xs text-ash leading-snug">{ex.kas}</div>
          <div className="text-[11px] text-dim mt-1">Görsel yok — aşağıdaki video linkini kullan</div>
        </div>
      </div>
    )
  }

  const yol = (n) => `${import.meta.env.BASE_URL}ex/${ex.img}_${n}.jpg`
  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      {/* İki kare üst üste; opaklık değişerek hareket hissi verir */}
      {[0, 1].map((n) => (
        <img key={n} src={yol(n)} alt={`${ex.ad} — ${n === 0 ? 'başlangıç' : 'bitiş'} pozisyonu`}
          onError={() => setHata(true)} loading="lazy" draggable="false"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300
            ${kare === n ? 'opacity-100' : 'opacity-0'}`} />
      ))}
      {/* alt karartma + faz etiketi */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="absolute bottom-1.5 right-2 text-[10px] font-semibold text-white/85 tracking-wide">
        {kare === 0 ? 'BAŞLANGIÇ' : 'BİTİŞ'}
      </span>
    </div>
  )
}

const ytLink = (ex) => `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.en)}`

/** Hareket detay kartı — görsel, teknik, hatalar, arama terimi, alternatif butonu */
function HareketKarti({ exId, asilId, plan, db, guncelle, kapat }) {
  const ex = EX[exId]
  const [altAcik, setAltAcik] = useState(false)
  const rekor = db.rekorlar?.[exId]
  const gecen = sonKayit(db, exId)
  const degistirilmis = asilId && asilId !== exId

  return (
    <div className="space-y-4">
      <HareketGorseli ex={ex} className="w-full aspect-[4/3] rounded-2xl" />

      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-2xl leading-tight">{ex.ad}</h3>
          {plan && (
            <Rozet renk="flame" className="mt-1 shrink-0">{hedefMetni(ex, plan)}</Rozet>
          )}
        </div>
        <p className="text-sm text-ash mt-1">{ex.kas}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Rozet renk={ex.tip === 'bilesik' ? 'flame' : 'steel'}>
            {ex.tip === 'bilesik' ? 'Bileşik hareket' : 'İzolasyon'}
          </Rozet>
          {ex.giris === 'tekrar' && <Rozet renk="jade">Vücut ağırlığı</Rozet>}
          {ex.perBacak && <Rozet renk="ash">Her bacak ayrı</Rozet>}
          {degistirilmis && <Rozet renk="gold">{EX[asilId].ad} yerine</Rozet>}
        </div>
      </div>

      {/* İngilizce arama terimi + video linki */}
      <a href={ytLink(ex)} target="_blank" rel="noreferrer"
        className="flex items-center gap-3 p-3 rounded-xl bg-slab2 border border-line active:bg-line">
        <span className="w-10 h-10 shrink-0 rounded-lg bg-blood/15 text-blood grid place-items-center text-lg">▶</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">Videoda izle</span>
          <span className="block text-[11px] text-dim truncate font-mono">"{ex.en}"</span>
        </span>
        <span className="text-dim text-lg">↗</span>
      </a>

      <div>
        <Baslik>Nasıl yapılır</Baslik>
        <p className="text-[14px] leading-relaxed text-bone/90">{ex.teknik}</p>
      </div>

      <div>
        <Baslik>Sık yapılan hatalar</Baslik>
        <ul className="space-y-2">
          {ex.hatalar.map((h, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ash">
              <span className="text-blood shrink-0 mt-0.5">✕</span>{h}
            </li>
          ))}
        </ul>
      </div>

      {(rekorMetni(ex, rekor) || gecen) && (
        <div className="grid grid-cols-2 gap-2">
          {rekorMetni(ex, rekor) && (
            <Kart className="p-3 border-gold/25 bg-gold/[0.05]">
              <div className="text-[10px] uppercase tracking-[0.14em] text-gold/80 font-semibold">Rekorun</div>
              <div className="num text-lg mt-0.5 text-gold">{rekorMetni(ex, rekor).ana}</div>
              <div className="text-[11px] text-dim">{rekorMetni(ex, rekor).alt}</div>
            </Kart>
          )}
          {gecen && (
            <Kart className="p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-dim font-semibold">Geçen sefer</div>
              <div className="num text-lg mt-0.5">
                {gecen.setler.filter((s) => s.bitti).map((s) => setMetni(ex, s)).join('  ')}
              </div>
              <div className="text-[11px] text-dim">{trTarih(gecen.tarih)}</div>
            </Kart>
          )}
        </div>
      )}

      <Btn tip="sade" className="w-full" onClick={() => setAltAcik(true)}>
        ⇄ Alternatif Göster
      </Btn>

      <AlternatifSecici
        acik={altAcik} kapat={() => setAltAcik(false)}
        exId={exId} asilId={asilId || exId} db={db} guncelle={guncelle}
        secildi={() => { setAltAcik(false); kapat?.() }}
      />
    </div>
  )
}

/** Alternatif hareket seçici — sebebe göre gruplu, seçim hatırlanır */
function AlternatifSecici({ acik, kapat, exId, asilId, db, guncelle, secildi }) {
  const asil = EX[asilId]
  // Asıl hareketin alternatifleri + şu an gösterilen hareketin alternatifleri (birleşik)
  const liste = useMemo(() => {
    const g = new Map()
    for (const a of asil.alt || []) if (a.id !== exId) g.set(a.id, a)
    for (const a of EX[exId].alt || []) if (a.id !== exId && a.id !== asilId) if (!g.has(a.id)) g.set(a.id, a)
    return [...g.values()]
  }, [exId, asilId])

  const NEDEN = {
    ekipman: { ad: 'Ekipman yok / farklı kurulum', renk: 'ash', ikon: '🔧' },
    zor: { ad: 'Ana hareket çok zor geliyor', renk: 'jade', ikon: '↓' },
    kolay: { ad: 'Ana hareket çok kolay geliyor', renk: 'flame', ikon: '↑' },
  }
  const gruplar = ['zor', 'kolay', 'ekipman'].map((n) => [n, liste.filter((a) => a.neden === n)])
    .filter(([, arr]) => arr.length)

  const sec = (yeniId) => {
    guncelle((d) => {
      if (yeniId === asilId) delete d.degisim[asilId]
      else d.degisim[asilId] = yeniId
    })
    secildi?.()
  }

  return (
    <Sheet acik={acik} kapat={kapat} baslik="Alternatif hareket">
      <p className="text-[13px] text-ash leading-relaxed mb-4">
        Seçtiğin hareket kaydedilir ve bundan sonraki antrenmanlarda <b className="text-bone">{asil.ad}</b> yerine o gösterilir.
        İstediğin zaman asıla dönebilirsin.
      </p>

      {exId !== asilId && (
        <Kart className="p-3 mb-4 border-flame/30 bg-flame/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-flame2 font-semibold uppercase tracking-wider">Şu an kullanılan</div>
              <div className="font-semibold truncate">{EX[exId].ad}</div>
            </div>
            <Btn kucuk tip="hayalet" onClick={() => sec(asilId)}>Asıla dön</Btn>
          </div>
        </Kart>
      )}

      {gruplar.map(([neden, arr]) => (
        <div key={neden} className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">{NEDEN[neden].ikon}</span>
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ash">{NEDEN[neden].ad}</span>
          </div>
          <div className="space-y-2">
            {arr.map((a) => {
              const e = EX[a.id]
              const aktif = a.id === exId
              return (
                <button key={a.id} onClick={() => sec(a.id)} disabled={aktif}
                  className={`w-full flex items-start gap-3 p-2.5 rounded-xl border text-left transition-colors
                    ${aktif ? 'bg-flame/10 border-flame/40' : 'bg-slab2 border-line active:bg-line'}`}>
                  <HareketGorseli ex={e} oynat={false} className="w-16 h-16 rounded-lg shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[14px] leading-tight">{e.ad}</span>
                    <span className="text-[11.5px] text-dim mt-1 leading-snug line-clamp-3">{e.teknik}</span>
                  </span>
                  <span className={`shrink-0 text-lg mt-4 ${aktif ? 'text-flame' : 'text-dim'}`}>{aktif ? '✓' : '›'}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {!gruplar.length && <p className="text-sm text-dim">Bu hareket için tanımlı alternatif yok.</p>}
    </Sheet>
  )
}

/* ═══ 7) ANTRENMAN EKRANI ══════════════════════════════════════════════════ */

/** Set arası dinlenme sayacı. Ekranın altına sabitlenir, bitince uyarı verir. */
function DinlenmeSayaci({ bitis, toplam, iptal, uzat, alarm }) {
  const [kalan, setKalan] = useState(() => Math.max(0, Math.round((bitis - Date.now()) / 1000)))
  const caldi = useRef(false)

  useEffect(() => {
    caldi.current = false
    const t = setInterval(() => {
      const k = Math.max(0, Math.round((bitis - Date.now()) / 1000))
      setKalan(k)
      if (k === 0 && !caldi.current) { caldi.current = true; alarm(true) }
    }, 250)
    return () => clearInterval(t)
  }, [bitis, alarm])

  const oran = clamp(kalan / toplam, 0, 1)
  const C = 2 * Math.PI * 26
  const bitti = kalan === 0

  return (
    <div className={`fixed inset-x-0 bottom-0 z-40 pb-safe px-3 pt-3
      bg-coal/95 backdrop-blur-md border-t ${bitti ? 'border-flame alarm' : 'border-line'}`}>
      <div className="max-w-lg mx-auto flex items-center gap-3">
        <div className="relative w-[62px] h-[62px] shrink-0">
          <svg viewBox="0 0 62 62" className="w-full h-full -rotate-90">
            <circle cx="31" cy="31" r="26" fill="none" stroke="#292d33" strokeWidth="5" />
            <circle cx="31" cy="31" r="26" fill="none" strokeWidth="5" strokeLinecap="round"
              stroke={bitti ? '#45d483' : '#ff4a17'}
              strokeDasharray={C} strokeDashoffset={C * (1 - oran)}
              style={{ transition: 'stroke-dashoffset .25s linear' }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center num text-[15px]">
            {bitti ? '✓' : sure(kalan)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-dim font-semibold">
            {bitti ? 'Dinlenme bitti' : 'Dinleniyorsun'}
          </div>
          <div className="text-[13px] text-ash leading-snug">
            {bitti ? 'Hadi, sıradaki sete geç.' : 'Nefesini topla, sonraki sete hazırlan.'}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {!bitti && <Btn kucuk tip="hayalet" onClick={() => uzat(30)}>+30 sn</Btn>}
          <Btn kucuk tip={bitti ? 'ana' : 'sade'} onClick={iptal}>{bitti ? 'Tamam' : 'Atla'}</Btn>
        </div>
      </div>
    </div>
  )
}

/** Set listesinin sütun başlıkları — satırlardaki genişliklerle hizalı */
function SetBasliklari({ ex }) {
  const g = ex.giris
  const sinif = 'flex items-center gap-1.5 px-1.5 pb-1.5 text-[9.5px] uppercase tracking-[0.14em] text-dim font-semibold'
  if (g === 'kardiyo') return (
    <div className={sinif}>
      <span className="w-6 shrink-0 text-center">#</span>
      <span className="flex-[1.3] min-w-0 text-center">Süre (dk)</span>
      <span className="flex-1 min-w-0 text-center">Mesafe (km)</span>
      <span className="w-11 shrink-0" />
    </div>
  )
  if (g === 'sure') return (
    <div className={sinif}>
      <span className="w-6 shrink-0 text-center">#</span>
      <span className="flex-1 min-w-0 text-center">Süre (saniye)</span>
      <span className="w-11 shrink-0" />
    </div>
  )
  return (
    <div className={sinif}>
      <span className="w-6 shrink-0 text-center">#</span>
      {g !== 'tekrar' && (
        <span className="flex-[1.3] min-w-0 text-center">{g === 'tekrar+ek' ? 'Ek ağırlık (kg)' : 'Ağırlık (kg)'}</span>
      )}
      <span className="flex-1 min-w-0 text-center">{ex.perBacak ? 'Tekrar / bacak' : 'Tekrar'}</span>
      <span className="w-11 shrink-0" />
    </div>
  )
}

/** Bir set girilebilir durumda mı (tamamlanabilir mi)? */
const setGecerli = (ex, s) => {
  if (ex?.giris === 'kardiyo') return (Number(s.dk) || 0) > 0
  if (ex?.giris === 'sure') return (Number(s.sn) || 0) > 0
  return (Number(s.tekrar) || 0) > 0
}

/** Tek bir setin giriş satırı — 320 px genişlikte bile taşmaz.
    Hareket tipine göre alanlar değişir: ağırlık+tekrar / tekrar / süre / süre+mesafe */
function SetSatiri({ no, set, ex, guncelleSet, tamamla, geriAl }) {
  const g = ex.giris
  const bitti = set.bitti

  return (
    <div className={`flex items-center gap-1.5 p-1.5 rounded-xl border transition-colors
      ${bitti ? 'bg-jade/[0.07] border-jade/30' : 'bg-slab border-line'}`}>
      <div className={`w-6 shrink-0 text-center num text-base ${bitti ? 'text-jade' : 'text-dim'}`}>{no}</div>

      {g === 'kardiyo' ? (
        <>
          <Sayac kompakt className="flex-[1.3]" deger={set.dk ?? 0}
            ayarla={(v) => guncelleSet({ dk: v })} adim={5} max={600} />
          <Sayac kompakt className="flex-1" deger={set.km ?? 0}
            ayarla={(v) => guncelleSet({ km: v })} adim={0.5} max={300} />
        </>
      ) : g === 'sure' ? (
        <Sayac kompakt className="flex-1" deger={set.sn ?? 0}
          ayarla={(v) => guncelleSet({ sn: v })} adim={5} max={3600} />
      ) : (
        <>
          {g !== 'tekrar' && (
            <Sayac kompakt className="flex-[1.3]" deger={set.kg ?? 0}
              ayarla={(v) => guncelleSet({ kg: v })} adim={2.5} max={500} />
          )}
          <Sayac kompakt className="flex-1" deger={set.tekrar ?? 0}
            ayarla={(v) => guncelleSet({ tekrar: v })} adim={1} max={200} />
        </>
      )}

      <button
        onClick={() => (bitti ? geriAl() : tamamla())}
        aria-label={bitti ? 'Seti geri al' : 'Seti tamamla'}
        className={`w-11 h-11 shrink-0 rounded-xl grid place-items-center text-xl font-bold
          transition-transform active:scale-90 border
          ${bitti ? 'bg-jade text-ink border-jade pop' : 'bg-slab2 text-dim border-line active:bg-line'}`}>
        ✓
      </button>
    </div>
  )
}

/** Aktif antrenman ekranı */
function AntrenmanEkrani({ db, guncelle, bitir, vazgec }) {
  const seans = db.aktif
  const alarm = useAlarm(db.ayarlar)
  useEkranAcik(true)

  // Sıra dışına taşmayı engelle (program değişmiş olabilir)
  const sonIndex = Math.max(0, (seans?.kayitlar?.length || 1) - 1)
  const [ham, setI] = useState(() => clamp(seans?.aktifIndex || 0, 0, sonIndex))
  const i = clamp(ham, 0, sonIndex)
  const [detay, setDetay] = useState(false)
  const [notAcik, setNotAcik] = useState(false)
  const [kutlama, setKutlama] = useState(null)
  const [vazgecOnay, setVazgecOnay] = useState(false)
  const [gecenSn, setGecenSn] = useState(0)
  const kaydir = useRef(null)

  // Geçen süre sayacı
  useEffect(() => {
    const t = setInterval(() => setGecenSn(Math.round((Date.now() - seans.basladi) / 1000)), 1000)
    setGecenSn(Math.round((Date.now() - seans.basladi) / 1000))
    return () => clearInterval(t)
  }, [seans.basladi])

  // Hareket değişince yukarı kaydır + seansta sakla
  useEffect(() => {
    kaydir.current?.scrollTo({ top: 0, behavior: 'smooth' })
    guncelle((d) => { if (d.aktif) d.aktif.aktifIndex = i })
  }, [i])

  // Hook'lar koşulsuz çağrılmalı: kayıt yoksa da güvenli varsayılanlarla devam et
  const kayit = seans.kayitlar[i]
  const ex = kayit ? EX[kayit.exId] : null
  const plan = kayit?.plan
  const gecen = useMemo(
    () => (kayit ? sonKayit(db, kayit.exId) : null),
    [db.antrenmanlar, kayit?.exId],
  )
  const oneri = useMemo(
    () => (kayit ? ilerlemeOnerisi(db, kayit.exId, plan) : null),
    [db.antrenmanlar, kayit?.exId],
  )
  const bitenSet = seans.kayitlar.reduce((t, k) => t + k.setler.filter((s) => s.bitti).length, 0)

  if (!kayit || !ex) return null

  const setGuncelle = (si, degisiklik) =>
    guncelle((d) => { Object.assign(d.aktif.kayitlar[i].setler[si], degisiklik) })

  /** Set tamamlandı: kaydet, rekor kontrolü yap, dinlenmeyi başlat */
  const setTamamla = (si) => {
    const set = kayit.setler[si]
    if (!setGecerli(ex, set)) return

    const g = ex.giris
    const eski = db.rekorlar?.[kayit.exId] || { agirlik: 0, tekrar: 0, dk: 0, km: 0, sn: 0 }
    // Rekor kutlaması sadece geçmişi olan hareketlerde anlamlı — ilk kez yapılan
    // harekette her set "rekor" olurdu, bu da kutlamayı değersizleştirirdi.
    const gecmisiVar = !!gecen

    const kg = Number(set.kg) || 0
    const tk = Number(set.tekrar) || 0
    const dk = Number(set.dk) || 0
    const km = Number(set.km) || 0
    const sn = Number(set.sn) || 0

    let kutlama = null
    if (gecmisiVar) {
      if (g === 'kardiyo') {
        if (km > 0 && km > (eski.km || 0)) kutlama = `${nf(km, 1)} km — en uzun mesafen!`
        else if (dk > (eski.dk || 0)) kutlama = `${dk} dakika — en uzun süren!`
      } else if (g === 'sure') {
        if (sn > (eski.sn || 0)) kutlama = `${sn} saniye — en uzun süren!`
      } else if (kg > 0 && kg > (eski.agirlik || 0)) {
        kutlama = `${nf(kg, 1)} kg — en ağır kaldırdığın yük!`
      } else if (tk > (eski.tekrar || 0) && (kg === 0 || kg >= (eski.agirlik || 0))) {
        kutlama = `${tk} tekrar — en yüksek tekrarın!`
      }
    }

    // Kardiyoda set arası dinlenme sayacı anlamsız — sadece ağırlık çalışmasında başlar
    const kardiyoMu = ex.tip === 'kardiyo' || g === 'kardiyo'
    const bekle = ex.tip === 'bilesik' ? db.ayarlar.dinlenmeBilesik : db.ayarlar.dinlenmeIzolasyon

    guncelle((d) => {
      Object.assign(d.aktif.kayitlar[i].setler[si], { bitti: true, zaman: Date.now() })
      if (!kardiyoMu) {
        d.aktif.dinlenmeBitis = Date.now() + bekle * 1000
        d.aktif.dinlenmeToplam = bekle
      }
      const r = (d.rekorlar[kayit.exId] ||= { agirlik: 0, tekrar: 0, dk: 0, km: 0, sn: 0, tarih: bugun() })
      if (kg > (r.agirlik || 0)) { r.agirlik = kg; r.tarih = bugun() }
      if (tk > (r.tekrar || 0)) { r.tekrar = tk; r.tarih = bugun() }
      if (dk > (r.dk || 0)) { r.dk = dk; r.tarih = bugun() }
      if (km > (r.km || 0)) { r.km = km; r.tarih = bugun() }
      if (sn > (r.sn || 0)) { r.sn = sn; r.tarih = bugun() }
    })
    alarm(false)

    if (kutlama) {
      setKutlama({ metin: kutlama })
      if (db.ayarlar.titresim && navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 120])
      setTimeout(() => setKutlama(null), 3400)
    }
  }

  const setGeriAl = (si) => guncelle((d) => { d.aktif.kayitlar[i].setler[si].bitti = false })

  const setEkle = () => guncelle((d) => {
    const s = d.aktif.kayitlar[i].setler
    const oncekiSet = s[s.length - 1]
    s.push({ ...(oncekiSet || {}), bitti: false, zaman: undefined })
  })
  const setSil = () => guncelle((d) => {
    const s = d.aktif.kayitlar[i].setler
    if (s.length > 1) s.pop()
  })

  const dinlenmeVar = seans.dinlenmeBitis && seans.dinlenmeBitis > Date.now() - 8000

  return (
    <div className="fixed inset-0 z-30 bg-coal flex flex-col">
      {/* ---- Üst şerit: ilerleme, süre, çıkış ---- */}
      <div className="shrink-0 pt-safe px-3 pb-2 border-b border-line/70 bg-slab/60 backdrop-blur">
        <div className="flex items-center gap-3 pt-1.5">
          <button onClick={() => setVazgecOnay(true)}
            className="w-10 h-10 shrink-0 rounded-xl bg-slab2 border border-line grid place-items-center text-ash active:bg-line">
            ✕
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="num text-lg leading-none">{db.program[seans.planKey]?.ad}</span>
              <span className="text-xs text-dim tabular-nums">{sure(gecenSn)}</span>
            </div>
            {/* hareket ilerleme çubukları */}
            <div className="flex gap-1 mt-1.5">
              {seans.kayitlar.map((k, n) => {
                const tam = k.setler.every((s) => s.bitti)
                const kismi = k.setler.some((s) => s.bitti)
                return (
                  <button key={n} onClick={() => setI(n)} aria-label={`${EX[k.exId].ad}`}
                    className={`h-1.5 flex-1 rounded-full transition-colors
                      ${n === i ? 'bg-flame' : tam ? 'bg-jade' : kismi ? 'bg-flame/40' : 'bg-line2'}`} />
                )
              })}
            </div>
          </div>
          <Btn kucuk tip="ana" onClick={bitir} className="shrink-0">Bitir</Btn>
        </div>
      </div>

      {/* ---- Ana içerik: o anki hareket ---- */}
      <div ref={kaydir} className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: dinlenmeVar ? '120px' : '24px' }}>
        <div className="max-w-lg mx-auto px-3 pt-3">

          {/* Hareket başlığı + görsel */}
          <button onClick={() => setDetay(true)} className="w-full text-left rise">
            <div className="flex gap-3">
              <HareketGorseli ex={ex} className="w-[104px] h-[104px] rounded-2xl shrink-0" />
              <div className="min-w-0 flex-1 py-0.5">
                <div className="text-[11px] uppercase tracking-[0.14em] text-dim font-semibold">
                  Hareket {i + 1}/{seans.kayitlar.length}
                </div>
                <h2 className="text-[22px] leading-tight mt-0.5">{ex.ad}</h2>
                <p className="text-[12px] text-ash mt-1 line-clamp-1">{ex.kas}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <Rozet renk="flame">{hedefMetni(ex, plan)}</Rozet>
                  {ex.perBacak && <Rozet renk="ash">her bacak</Rozet>}
                  <span className="text-[11px] text-flame2 font-semibold ml-auto">Detay ›</span>
                </div>
              </div>
            </div>
          </button>

          {/* Geçen antrenman özeti */}
          {gecen && (
            <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ash bg-slab2/60 rounded-xl px-3 py-2 border border-line/60">
              <span className="text-dim shrink-0">Geçen sefer:</span>
              <span className="num text-bone truncate">
                {gecen.setler.filter((s) => s.bitti).map((s) => setMetni(ex, s)).join('  ·  ')}
              </span>
              <span className="text-dim ml-auto shrink-0 text-[11px]">{trTarih(gecen.tarih)}</span>
            </div>
          )}

          {/* İlerleme önerisi */}
          {oneri && (
            <Kart className="mt-3 p-3 border-gold/35 bg-gold/[0.07] rise">
              <div className="flex gap-2.5">
                <span className="text-lg shrink-0">⬆</span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-gold leading-snug">{oneri.metin}</div>
                  <div className="text-[12px] text-ash mt-1">{oneri.oneri}</div>
                  {oneri.altId && (
                    <Btn kucuk tip="sade" className="mt-2"
                      onClick={() => guncelle((d) => {
                        d.degisim[kayit.asilId] = oneri.altId
                        d.aktif.kayitlar[i].exId = oneri.altId
                      })}>
                      {EX[oneri.altId].ad}'a geç
                    </Btn>
                  )}
                </div>
              </div>
            </Kart>
          )}

          {/* Setler */}
          <div className="mt-4">
            <Baslik sag={
              <div className="flex gap-1.5">
                <button onClick={setSil} className="w-8 h-8 rounded-lg bg-slab2 border border-line text-ash active:bg-line text-lg leading-none">−</button>
                <button onClick={setEkle} className="w-8 h-8 rounded-lg bg-slab2 border border-line text-ash active:bg-line text-lg leading-none">+</button>
              </div>
            }>
              Setler {bitenSet > 0 && <span className="text-jade ml-1">{kayit.setler.filter((s) => s.bitti).length}/{kayit.setler.length}</span>}
            </Baslik>
            <SetBasliklari ex={ex} />
            <div className="space-y-2">
              {kayit.setler.map((s, si) => (
                <SetSatiri key={si} no={si + 1} set={s} ex={ex}
                  guncelleSet={(d) => setGuncelle(si, d)}
                  tamamla={() => setTamamla(si)} geriAl={() => setGeriAl(si)} />
              ))}
            </div>

            {/* İlk kez yapılan ağırlıklı hareket: uygun yükü nasıl bulacağını anlat */}
            {!gecen && ex.giris !== 'tekrar' && (
              <p className="text-[12px] text-dim leading-relaxed mt-2.5 px-1">
                Bu hareketi ilk kez yapıyorsun. Hafif bir yükle 1-2 ısınma seti çek, sonra{' '}
                {plan.hedefMax} tekrarı zorlanarak bitirebileceğin ağırlığı bul —
                rakamın üstüne dokunup doğrudan yazabilirsin.
              </p>
            )}
          </div>

          {/* Not alanı */}
          <div className="mt-4">
            {!notAcik && !kayit.not ? (
              <button onClick={() => setNotAcik(true)}
                className="w-full py-3 rounded-xl border border-dashed border-line2 text-[13px] text-dim active:bg-slab2">
                ✎ Bu harekete not ekle
              </button>
            ) : (
              <div>
                <Baslik>Not</Baslik>
                <textarea
                  value={kayit.not} autoFocus={notAcik && !kayit.not} rows={2}
                  placeholder="örn. sol dizde hafif ağrı hissettim, ağırlığı düşürdüm"
                  onChange={(e) => guncelle((d) => { d.aktif.kayitlar[i].not = e.target.value })}
                  className="w-full bg-slab2 border border-line rounded-xl p-3 text-[14px]
                    outline-none focus:border-flame/50 resize-none placeholder:text-dim/70" />
              </div>
            )}
          </div>

          {/* Hareketler arası gezinme */}
          <div className="flex gap-2 mt-5">
            <Btn tip="sade" className="flex-1" disabled={i === 0} onClick={() => setI(i - 1)}>‹ Önceki</Btn>
            {i < seans.kayitlar.length - 1
              ? <Btn tip="ana" className="flex-[1.4]" onClick={() => setI(i + 1)}>Sonraki hareket ›</Btn>
              : <Btn tip="ana" className="flex-[1.4]" onClick={bitir}>Antrenmanı bitir ✓</Btn>}
          </div>

          {/* Kalan hareketlerin listesi — arka planda, sade */}
          <div className="mt-6 opacity-55">
            <Baslik>Bugünün akışı</Baslik>
            <div className="space-y-1">
              {seans.kayitlar.map((k, n) => {
                const tam = k.setler.every((s) => s.bitti)
                return (
                  <button key={n} onClick={() => setI(n)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[13px]
                      ${n === i ? 'bg-slab2 text-bone' : 'text-ash active:bg-slab'}`}>
                    <span className={`w-5 h-5 rounded-md grid place-items-center text-[11px] shrink-0
                      ${tam ? 'bg-jade text-ink' : 'bg-line2 text-dim'}`}>{tam ? '✓' : n + 1}</span>
                    <span className="truncate flex-1">{EX[k.exId].ad}</span>
                    <span className="text-[11px] text-dim shrink-0 tabular-nums">
                      {k.setler.filter((s) => s.bitti).length}/{k.setler.length}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Dinlenme sayacı ---- */}
      {dinlenmeVar && (
        <DinlenmeSayaci
          bitis={seans.dinlenmeBitis} toplam={seans.dinlenmeToplam || 120} alarm={alarm}
          iptal={() => guncelle((d) => { d.aktif.dinlenmeBitis = null })}
          uzat={(sn) => guncelle((d) => {
            d.aktif.dinlenmeBitis = Math.max(Date.now(), d.aktif.dinlenmeBitis) + sn * 1000
            d.aktif.dinlenmeToplam = (d.aktif.dinlenmeToplam || 120) + sn
          })} />
      )}

      {/* ---- Rekor kutlaması ---- */}
      {kutlama && (
        <div className="fixed inset-x-0 top-0 z-50 pt-safe px-3 pointer-events-none">
          <div className="max-w-lg mx-auto mt-2 rounded-2xl bg-gold text-ink px-4 py-3 flex items-center gap-3 flare rise">
            <span className="text-2xl">🏆</span>
            <div className="min-w-0">
              <div className="font-bold text-[15px] leading-tight">Yeni kişisel rekor!</div>
              <div className="text-[13px] opacity-85 truncate">{kutlama.metin}</div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Hareket detay paneli ---- */}
      <Sheet acik={detay} kapat={() => setDetay(false)} baslik="Hareket detayı" tam>
        <HareketKarti exId={kayit.exId} asilId={kayit.asilId} plan={plan} db={db}
          guncelle={(fn) => {
            guncelle((d) => {
              fn(d)
              // Alternatif seçildiyse aktif seanstaki hareketi de değiştir
              const yeni = d.degisim[kayit.asilId] || kayit.asilId
              if (yeni === d.aktif.kayitlar[i].exId) return
              d.aktif.kayitlar[i].exId = yeni
              // Yeni harekete ait geçen seferki değerlerle setleri yeniden doldur
              // (tamamlanmış setlere dokunma)
              const gecenSetler = sonKayit(d, yeni)?.setler.filter((s) => s.bitti) || []
              d.aktif.kayitlar[i].setler = d.aktif.kayitlar[i].setler.map((s, si) =>
                s.bitti ? s : setVarsayilani(EX[yeni], plan, gecenSetler[si] || son(gecenSetler)))
            })
          }}
          kapat={() => setDetay(false)} />
      </Sheet>

      <Onay acik={vazgecOnay} kapat={() => setVazgecOnay(false)}
        baslik="Antrenmanı iptal et?"
        metin="Girdiğin setler kaydedilmeden silinecek. Emin misin?"
        onayla={vazgec} onayMetin="Evet, iptal et" />
    </div>
  )
}

/** Antrenman bitiş özeti */
function OzetPaneli({ acik, kapat, seans, db }) {
  if (!acik || !seans) return null
  const hacim = seansHacmi(seans)
  const dakika = seansDakika(seans)
  const setler = setSayisi(seans)
  const sn = Math.round((seans.bitti - seans.basladi) / 1000)

  // Aynı antrenman tipinin bir öncekiyle karşılaştırma.
  // Kardiyo seanslarında hacim yerine dakika karşılaştırılır.
  const oncekiler = db.antrenmanlar.filter((s) => s.planKey === seans.planKey && s.id !== seans.id)
  const onceki = son(oncekiler)
  const kardiyoSeansi = hacim === 0 && dakika > 0
  const birim = kardiyoSeansi ? 'dk' : 'kg'
  const fark = onceki
    ? (kardiyoSeansi ? dakika - seansDakika(onceki) : hacim - seansHacmi(onceki))
    : null

  return (
    <Sheet acik={acik} kapat={kapat} baslik="Antrenman tamam">
      <div className="text-center py-3 rise">
        <div className="text-5xl mb-2">💪</div>
        <div className="num text-3xl">{db.program[seans.planKey]?.ad}</div>
        <div className="text-sm text-ash">{trTarih(seans.tarih, true)}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 my-4">
        <Kart className="p-3 text-center"><Stat ust="Süre" deger={sureUzun(sn)} /></Kart>
        <Kart className="p-3 text-center"><Stat ust="Set" deger={setler} /></Kart>
        <Kart className="p-3 text-center">
          {hacim > 0
            ? <Stat ust="Hacim" deger={hacim.toLocaleString('tr-TR')} alt="kg" />
            : <Stat ust="Kardiyo" deger={dakika} alt="dakika" />}
        </Kart>
      </div>

      {fark !== null && (
        <Kart className={`p-3.5 mb-4 ${fark >= 0 ? 'border-jade/30 bg-jade/[0.06]' : 'border-line'}`}>
          <div className="flex items-center gap-3">
            <span className={`text-2xl ${fark >= 0 ? 'text-jade' : 'text-ash'}`}>{fark >= 0 ? '↑' : '↓'}</span>
            <div>
              <div className="text-[13.5px] font-semibold">
                Geçen {db.program[seans.planKey]?.ad} antrenmanına göre {' '}
                <span className={fark >= 0 ? 'text-jade' : 'text-blood'}>
                  {nfSigned(fark, 0)} {birim}
                </span>
              </div>
              <div className="text-[12px] text-dim mt-0.5">
                {fark >= 0
                  ? (kardiyoSeansi ? 'Daha uzun süre çalıştın.' : 'Toplam kaldırdığın yük arttı — ilerliyorsun.')
                  : (kardiyoSeansi ? 'Bu sefer daha kısa sürdü.' : 'Bu sefer daha az hacim. Uyku ve beslenmeni kontrol et.')}
              </div>
            </div>
          </div>
        </Kart>
      )}

      {/* Hareket dökümü */}
      <Baslik>Döküm</Baslik>
      <div className="space-y-1.5 mb-4">
        {seans.kayitlar.map((k, n) => {
          const b = k.setler.filter((s) => s.bitti)
          if (!b.length) return null
          const e = EX[k.exId]
          return (
            <div key={n} className="flex items-start gap-2.5 py-1.5">
              <span className="w-5 h-5 mt-0.5 rounded-md bg-jade/20 text-jade grid place-items-center text-[11px] shrink-0">✓</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] leading-tight">{e.ad}</div>
                <div className="num text-[12.5px] text-ash mt-0.5">
                  {b.map((s) => setMetni(e, s)).join('  ·  ')}
                </div>
                {k.not && <div className="text-[12px] text-gold/80 mt-1 italic">✎ {k.not}</div>}
              </div>
            </div>
          )
        })}
      </div>

      <Btn tip="ana" className="w-full" onClick={kapat}>Kapat</Btn>
    </Sheet>
  )
}

/* ═══ BUGÜN EKRANI ═════════════════════════════════════════════════════════ */

/** Haftanın 7 günü — yatay şerit.
    Her günün altında o günün antrenmanı yazar; yapıldıysa gerçekte yapılan
    antrenman gösterilir (plandan farklı olabilir). */
function HaftaSeridi({ db, secili, onSec }) {
  const bas = haftaBasi(bugun())
  const gunler = Array.from({ length: 7 }, (_, n) => ekleGun(bas, n))
  const yapilan = {}
  for (const s of db.antrenmanlar) {
    if (haftaBasi(s.tarih) === bas) (yapilan[s.tarih] ||= []).push(s.planKey)
  }

  return (
    <div className="flex gap-1">
      {gunler.map((t, n) => {
        const planKey = db.ayarlar.plan[n]
        const yapilanlar = yapilan[t] || []
        const yapildi = yapilanlar.length > 0
        const gosterilen = yapilanlar[0] || planKey
        const p = db.program[gosterilen]
        const dinlenme = gosterilen === 'dinlenme'
        const buGun = t === bugun()
        const kacirildi = t < bugun() && planKey !== 'dinlenme' && !yapildi
        const renk = metinRengi(db, gosterilen)

        const stil = yapildi ? 'bg-jade/12 border-jade/45'
          : buGun ? 'bg-flame/10 border-flame'
          : kacirildi ? 'bg-slab/70 border-line/70 opacity-55'
          : dinlenme ? 'bg-slab/40 border-line/50'
          : 'bg-slab border-line'

        return (
          <button key={t} onClick={() => onSec?.(t)}
            className={`flex-1 min-w-0 rounded-xl border pt-1.5 pb-1 px-0.5 overflow-hidden
              transition-colors ${stil} ${secili === t ? 'ring-1 ring-flame/50' : ''}`}>
            <div className={`text-[9px] font-semibold uppercase tracking-wider
              ${buGun ? 'text-flame2' : 'text-dim'}`}>{GUN_KISA[n]}</div>
            <div className={`num text-[15px] leading-none my-0.5
              ${yapildi ? 'text-jade' : buGun ? 'text-flame2' : 'text-ash'}`}>{gun(t).getDate()}</div>

            {/* Antrenman adı — dar hücrede iki satıra sarar */}
            <div className={`text-[8px] leading-[1.15] font-semibold h-[19px] px-0.5
              ${dinlenme ? 'text-dim/70' : yapildi ? 'text-jade/90' : renk} ${!dinlenme && !yapildi ? 'opacity-85' : ''}`}>
              {dinlenme ? '—' : p?.kisa || ''}
            </div>

            <div className="h-3.5 grid place-items-center">
              {yapildi ? <span className="text-[12px] leading-none text-jade">✓</span>
                : dinlenme ? <span className="w-2 h-[2px] bg-dim rounded-full" />
                : kacirildi ? <span className="text-[10px] leading-none text-dim">✕</span>
                : <span className={`w-1.5 h-1.5 rounded-full border ${buGun ? 'border-flame' : 'border-line2'}`} />}
            </div>
            {/* Birden fazla antrenman yapıldıysa göster */}
            {yapilanlar.length > 1 && (
              <div className="text-[8px] text-jade/70 -mt-0.5">+{yapilanlar.length - 1}</div>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Bugün ne yapılmalı? Plan doluysa onu, dinlenme günüyse bu hafta kaçırılan
    ya da sıradaki antrenmanı önerir. */
function onerilenAntrenman(db) {
  const t = bugun()
  const n = gunIndex(t)
  const planKey = db.ayarlar.plan[n]
  if (planKey !== 'dinlenme') return { key: planKey, neden: 'bugun' }

  const bas = haftaBasi(t)
  const kalan = db.antrenmanlar.filter((s) => haftaBasi(s.tarih) === bas).map((s) => s.planKey)
  // Bu hafta planlanıp yapılmamış ilk antrenman (telafi)
  for (let i = 0; i < n; i++) {
    const k = db.ayarlar.plan[i]
    if (k === 'dinlenme') continue
    const j = kalan.indexOf(k)
    if (j >= 0) kalan.splice(j, 1)
    else return { key: k, neden: 'kacirilan', gunAdi: GUN_UZUN[i] }
  }
  // Haftanın kalanındaki ilk antrenman
  for (let i = n + 1; i < 7; i++) {
    const k = db.ayarlar.plan[i]
    if (k !== 'dinlenme') return { key: k, neden: 'sonraki', gunAdi: GUN_UZUN[i] }
  }
  return null
}

/** Günlük beslenme kontrol listesi — maddeler Ayarlar'dan düzenlenebilir */
function BeslenmeListesi({ db, guncelle }) {
  const t = bugun()
  const liste = db.beslenmeListesi || []
  const veri = db.beslenme[t] || {}
  const tik = liste.filter((b) => veri[b.id]).length
  const oran = liste.length ? Math.round((tik / liste.length) * 100) : 0

  // Son 7 günün tutarlılığı
  const haftalik = useMemo(() => {
    if (!liste.length) return 0
    let toplam = 0
    for (let n = 0; n < 7; n++) {
      const g = db.beslenme[ekleGun(t, -n)] || {}
      toplam += liste.filter((b) => g[b.id]).length
    }
    return Math.round((toplam / (7 * liste.length)) * 100)
  }, [db.beslenme, liste])

  if (!liste.length) return null

  const cevir = (id) => guncelle((d) => {
    d.beslenme[t] ||= {}
    d.beslenme[t][id] = !d.beslenme[t][id]
  })

  return (
    <Kart className="p-3.5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[13px] font-semibold">Bugünün beslenmesi</div>
          <div className="text-[11px] text-dim mt-0.5">Haftalık tutarlılık: <b className={haftalik >= 70 ? 'text-jade' : 'text-gold'}>%{haftalik}</b></div>
        </div>
        <div className="relative w-12 h-12 shrink-0">
          <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
            <circle cx="24" cy="24" r="20" fill="none" stroke="#292d33" strokeWidth="4" />
            <circle cx="24" cy="24" r="20" fill="none" stroke="#45d483" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 20}
              strokeDashoffset={2 * Math.PI * 20 * (1 - tik / liste.length)}
              style={{ transition: 'stroke-dashoffset .3s' }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center num text-[12px]">{oran}%</div>
        </div>
      </div>
      <div className="space-y-1">
        {liste.map((b) => {
          const isaretli = !!veri[b.id]
          return (
            <button key={b.id} onClick={() => cevir(b.id)}
              className="w-full flex items-center gap-2.5 py-2 px-1 rounded-lg active:bg-slab2 text-left">
              <span className={`w-6 h-6 shrink-0 rounded-md border grid place-items-center text-[13px] transition-colors
                ${isaretli ? 'bg-jade border-jade text-ink' : 'border-line2 text-transparent'}`}>✓</span>
              <span className="text-base shrink-0">{b.ikon}</span>
              <span className={`text-[13.5px] leading-snug ${isaretli ? 'text-dim line-through' : 'text-bone'}`}>{b.ad}</span>
            </button>
          )
        })}
      </div>
    </Kart>
  )
}

function BugunEkrani({ db, guncelle, baslat }) {
  const t = bugun()
  const n = gunIndex(t)
  const planKey = db.ayarlar.plan[n]
  const program = db.program[planKey]
  const dinlenme = planKey === 'dinlenme'
  const bugunYapildi = db.antrenmanlar.some((s) => s.tarih === t)

  const { guncel, haftalikDegisim, uyarilar } = useMemo(() => kiloAnaliz(db), [db.kilolar, db.profil])
  const seri = useMemo(() => seriHesapla(db.antrenmanlar), [db.antrenmanlar])
  const deload = useMemo(() => deloadDurumu(db), [db.profil.baslangicTarih, db.ayarlar.deloadHatirlat])
  const buHaftaSayi = db.antrenmanlar.filter((s) => haftaBasi(s.tarih) === haftaBasi(t)).length

  const [secici, setSecici] = useState(false)
  const [kiloAcik, setKiloAcik] = useState(false)
  const [detay, setDetay] = useState(null) // { exId, asilId, plan }
  // Uygulama bugün ne yapılacağını kendisi önerir
  const oneri = useMemo(() => onerilenAntrenman(db), [db.ayarlar.plan, db.antrenmanlar])
  const kiloHedefiVar = db.profil.hedefTip === 'al' || db.profil.hedefTip === 'ver'

  return (
    <div className="px-3 pt-2 space-y-4">
      {/* ---- Tarih + günün antrenmanı ---- */}
      <div className="rise">
        <div className="text-[11px] uppercase tracking-[0.18em] text-dim font-semibold">
          {db.profil.ad ? `${db.profil.ad} · ` : ''}{GUN_UZUN[n]} · {trTarih(t, true)}
        </div>
        <div className="flex items-end justify-between gap-3 mt-1">
          <h1 className={`text-[34px] leading-none ${dinlenme ? 'text-ash' : 'text-bone'}`}>
            {program?.ad || 'Dinlenme'}
          </h1>
          {bugunYapildi && <Rozet renk="jade" className="mb-1">✓ Tamamlandı</Rozet>}
        </div>
        {!dinlenme && (
          <p className="text-[13px] text-ash mt-1.5">
            {program?.hareketler.length} hareket ·{' '}
            {program?.hareketler.reduce((a, h) => a + h.set, 0)} set
          </p>
        )}
        {dinlenme && (
          <p className="text-[13px] text-ash mt-1.5 leading-relaxed">
            Bugün dinlenme günü. Kas antrenmanda değil, dinlenirken büyür — iyi uyu ve yemeğini aksatma.
          </p>
        )}
      </div>

      {/* ---- Hafta şeridi ---- */}
      <div>
        <HaftaSeridi db={db} />
        <div className="flex items-center justify-between mt-2 px-0.5">
          <span className="text-[11px] text-dim">
            Bu hafta <b className="text-bone num">{buHaftaSayi}</b>/{db.ayarlar.haftalikHedef} antrenman
          </span>
          {seri > 0 && (
            <Rozet renk="flame">🔥 {seri} hafta seri</Rozet>
          )}
        </div>
      </div>

      {/* ---- Uyarılar ---- */}
      {deload && (
        <Kart className="p-3.5 border-steel/35 bg-steel/[0.06] rise">
          <div className="flex gap-2.5">
            <span className="text-lg shrink-0 leading-none">↺</span>
            <div>
              <div className="text-[13.5px] font-semibold text-steel">Deload haftası</div>
              <div className="text-[12.5px] text-ash mt-1 leading-relaxed">{deload.metin}</div>
            </div>
          </div>
        </Kart>
      )}
      {uyarilar.map((u, i) => (
        <Kart key={i} className={`p-3.5 rise ${u.tip === 'hizli' ? 'border-blood/35 bg-blood/[0.06]' : 'border-gold/35 bg-gold/[0.06]'}`}>
          <div className="flex gap-2.5">
            <span className="text-lg shrink-0 leading-none">{u.tip === 'hizli' ? '⚠' : u.tip === 'dus' ? '↓' : '▲'}</span>
            <div>
              <div className={`text-[13.5px] font-semibold ${u.tip === 'hizli' ? 'text-blood' : 'text-gold'}`}>{u.baslik}</div>
              <div className="text-[12.5px] text-ash mt-1 leading-relaxed">{u.metin}</div>
            </div>
          </div>
        </Kart>
      ))}

      {/* ---- Kilo & hedef özeti (kilo takibi kapalıysa antrenman istatistiği) ---- */}
      {db.ayarlar.kiloTakibi ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setKiloAcik(true)} className="text-left">
            <Kart className="p-3.5 h-full active:bg-slab2">
              <Stat ust="Güncel kilo"
                deger={guncel ? `${nf(guncel.kg, 1)} kg` : '— kg'}
                alt={haftalikDegisim !== null
                  ? `bu hafta ${nfSigned(haftalikDegisim)} kg`
                  : guncel ? trTarih(guncel.tarih) : 'ölçüm ekle'}
                renk={degisimRengi(db, haftalikDegisim)} />
            </Kart>
          </button>
          <Kart className="p-3.5">
            {kiloHedefiVar ? (
              <Stat ust="Hedefe kalan"
                deger={guncel ? `${nf(Math.abs(db.profil.hedefKilo - guncel.kg), 1)} kg` : '—'}
                alt={`${Math.max(0, gunFark(bugun(), db.profil.hedefTarih))} gün kaldı`} />
            ) : (
              <Stat ust="Başlangıçtan beri"
                deger={guncel ? `${nfSigned(guncel.kg - db.profil.baslangicKilo)} kg` : '—'}
                alt={`${trTarih(db.profil.baslangicTarih)} başlangıç`} />
            )}
          </Kart>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Kart className="p-3.5">
            <Stat ust="Toplam antrenman" deger={db.antrenmanlar.length} alt="kayıt" />
          </Kart>
          <Kart className="p-3.5">
            <Stat ust="Bu hafta hacim"
              deger={db.antrenmanlar.filter((s) => haftaBasi(s.tarih) === haftaBasi(t))
                .reduce((x, s) => x + seansHacmi(s), 0).toLocaleString('tr-TR')} alt="kg" />
          </Kart>
        </div>
      )}

      {/* ---- Beslenme ---- */}
      <BeslenmeListesi db={db} guncelle={guncelle} />

      {/* ---- Bugünün hareketleri (önizleme) — dokununca detay kartı açılır ---- */}
      {!dinlenme && program && (
        <div>
          <Baslik sag={<span className="text-[11px] text-dim">detay için dokun</span>}>
            Bugünün hareketleri
          </Baslik>
          <Kart className="divide-y divide-line/60 overflow-hidden">
            {program.hareketler.map((h, idx) => {
              const exId = cozExId(db, h.exId)
              const e = EX[exId]
              const degisti = exId !== h.exId
              return (
                <button key={idx} onClick={() => setDetay({ exId, asilId: h.exId, plan: h })}
                  className="w-full flex items-center gap-3 p-2.5 text-left active:bg-slab2">
                  <HareketGorseli ex={e} oynat={false} className="w-12 h-12 rounded-lg shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] leading-tight truncate">{e.ad}</div>
                    <div className="text-[11.5px] text-dim mt-0.5">
                      {hedefMetni(e, h)}
                      {e.perBacak && ' (her bacak)'}
                    </div>
                  </div>
                  {degisti && <Rozet renk="gold" className="shrink-0">değişik</Rozet>}
                  <span className="text-dim shrink-0">›</span>
                </button>
              )
            })}
          </Kart>
        </div>
      )}

      {/* ---- Ana aksiyon: ekranın alt yarısında, tek elle erişilir ----
           Uygulama hangi antrenmanın yapılacağını kendisi seçer; buton onun
           adını taşır. Altındaki tuş başka bir antrenmana geçmeyi sağlar. */}
      <div className="pt-1">
        {oneri ? (
          <Btn tip="ana" className="w-full !min-h-[66px]" onClick={() => baslat(oneri.key)}>
            <span className="flex flex-col items-center leading-tight py-1">
              <span className="font-display text-[19px] tracking-wide">{db.program[oneri.key]?.ad}</span>
              <span className="text-[11.5px] font-semibold opacity-85 mt-0.5">
                {oneri.neden === 'bugun'
                  ? (bugunYapildi ? 'bugün yapıldı — tekrar başlat' : 'antrenmanı başlat →')
                  : oneri.neden === 'kacirilan'
                    ? `${oneri.gunAdi} kaçmış — şimdi telafi et →`
                    : `${oneri.gunAdi} günü — istersen bugün yap →`}
              </span>
            </span>
          </Btn>
        ) : (
          <Btn tip="sade" className="w-full !min-h-[56px]" onClick={() => setSecici(true)}>
            Antrenman seç
          </Btn>
        )}
        <button onClick={() => setSecici(true)}
          className="w-full text-center text-[12.5px] text-dim mt-2.5 py-2 active:text-ash">
          Başka bir antrenman seç
        </button>
      </div>

      {/* Antrenman seçici */}
      <Sheet acik={secici} kapat={() => setSecici(false)} baslik="Hangi antrenman?">
        <div className="space-y-2">
          {antrenmanAnahtarlari(db).map((k) => {
            const p = db.program[k]
            if (!p) return null
            const sonu = son(db.antrenmanlar.filter((s) => s.planKey === k))
            return (
              <button key={k} onClick={() => { setSecici(false); baslat(k) }}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-slab2 border border-line active:bg-line text-left">
                <span className={`w-1.5 h-11 rounded-full shrink-0 ${zeminRengi(db, k)}`} />
                <span className="min-w-0 flex-1">
                  <span className="block num text-lg leading-tight">{p.ad}</span>
                  <span className="block text-[11.5px] text-dim mt-0.5">
                    {p.hareketler.length} hareket
                    {sonu && ` · son: ${trTarih(sonu.tarih)}`}
                  </span>
                </span>
                <span className="text-dim text-lg">›</span>
              </button>
            )
          })}
        </div>
      </Sheet>

      {/* Hareket detay kartı — antrenmana başlamadan da inceleyip alternatif seçebilirsin */}
      <Sheet acik={!!detay} kapat={() => setDetay(null)} baslik="Hareket detayı" tam>
        {detay && (
          <HareketKarti exId={cozExId(db, detay.asilId)} asilId={detay.asilId} plan={detay.plan}
            db={db} guncelle={guncelle} kapat={() => setDetay(null)} />
        )}
      </Sheet>

      <KiloGirisPaneli acik={kiloAcik} kapat={() => setKiloAcik(false)} db={db} guncelle={guncelle} />
    </div>
  )
}

/** Hızlı kilo girişi paneli — birden fazla ekrandan açılır */
function KiloGirisPaneli({ acik, kapat, db, guncelle }) {
  const varOlan = db.kilolar.find((k) => k.tarih === bugun())
  const [kg, setKg] = useState(varOlan?.kg ?? son([...db.kilolar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))?.kg ?? db.profil.baslangicKilo)
  useEffect(() => {
    if (!acik) return
    const v = db.kilolar.find((k) => k.tarih === bugun())
    const sonKg = son([...db.kilolar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))?.kg
    setKg(v?.kg ?? sonKg ?? db.profil.baslangicKilo)
  }, [acik])

  const kaydet = () => {
    guncelle((d) => {
      const i = d.kilolar.findIndex((k) => k.tarih === bugun())
      if (i >= 0) d.kilolar[i].kg = Number(kg)
      else d.kilolar.push({ tarih: bugun(), kg: Number(kg) })
      d.kilolar.sort((a, b) => (a.tarih < b.tarih ? -1 : 1))
    })
    kapat()
  }

  return (
    <Sheet acik={acik} kapat={kapat} baslik="Kilo girişi">
      <p className="text-[13px] text-ash leading-relaxed mb-4">
        En doğru ölçüm: <b className="text-bone">sabah, tuvaletten sonra, aç karnına, aynı kıyafetle.</b>{' '}
        Günlük dalgalanma normaldir — uygulama haftalık ortalamayla değerlendirir.
      </p>
      <div className="flex justify-center my-6">
        <div className="w-56">
          <Sayac deger={kg} ayarla={setKg} adim={0.1} min={30} max={200} birim="kg" />
        </div>
      </div>
      <div className="flex gap-2 mb-2">
        {[-0.5, -0.1, 0.1, 0.5].map((f) => (
          <Btn key={f} kucuk tip="hayalet" className="flex-1"
            onClick={() => setKg(Math.round((Number(kg) + f) * 10) / 10)}>
            {f > 0 ? '+' : '−'}{nf(Math.abs(f), 1)}
          </Btn>
        ))}
      </div>
      <Btn tip="ana" className="w-full mt-3" onClick={kaydet}>
        {varOlan ? 'Güncelle' : 'Kaydet'} · {trTarih(bugun())}
      </Btn>
    </Sheet>
  )
}

/* ═══ GEÇMİŞ EKRANI ════════════════════════════════════════════════════════ */

function GecmisEkrani({ db, guncelle }) {
  const [ay, setAy] = useState(() => { const d = gun(bugun()); return { y: d.getFullYear(), m: d.getMonth() } })
  const [secilenGun, setSecilenGun] = useState(null)

  // Ay ızgarası: pazartesi başlangıçlı
  const kareler = useMemo(() => {
    const ilk = new Date(ay.y, ay.m, 1)
    const bosluk = (ilk.getDay() + 6) % 7
    const gunSayisi = new Date(ay.y, ay.m + 1, 0).getDate()
    const arr = Array(bosluk).fill(null)
    for (let g = 1; g <= gunSayisi; g++) arr.push(iso(new Date(ay.y, ay.m, g)))
    return arr
  }, [ay])

  const seansMap = useMemo(() => {
    const m = {}
    for (const s of db.antrenmanlar) (m[s.tarih] ||= []).push(s)
    return m
  }, [db.antrenmanlar])

  const ayDegistir = (f) => setAy(({ y, m }) => {
    const d = new Date(y, m + f, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })

  // Son 6 haftanın özeti
  const haftalar = useMemo(() => {
    const arr = []
    let h = haftaBasi(bugun())
    for (let n = 0; n < 6; n++) {
      const seanslar = db.antrenmanlar.filter((s) => haftaBasi(s.tarih) === h)
      const kls = db.kilolar.filter((k) => haftaBasi(k.tarih) === h)
      const oncekiKls = db.kilolar.filter((k) => haftaBasi(k.tarih) === ekleGun(h, -7))
      const ort = (a) => (a.length ? a.reduce((t, k) => t + Number(k.kg), 0) / a.length : null)
      const o = ort(kls), oo = ort(oncekiKls)
      // Haftanın her günü için: planlanan ve gerçekte yapılan antrenman
      const gunler = Array.from({ length: 7 }, (_, i) => {
        const t = ekleGun(h, i)
        return { tarih: t, plan: db.ayarlar.plan[i], yapilan: seanslar.filter((s) => s.tarih === t).map((s) => s.planKey) }
      })
      arr.push({
        hafta: h, adet: seanslar.length, gunler,
        hacim: seanslar.reduce((t, s) => t + seansHacmi(s), 0),
        kiloFark: o !== null && oo !== null ? o - oo : null,
      })
      h = ekleGun(h, -7)
    }
    return arr
  }, [db.antrenmanlar, db.kilolar])

  const seciliSeanslar = secilenGun ? seansMap[secilenGun] || [] : []

  return (
    <div className="px-3 pt-2 space-y-5">
      <h1 className="text-[28px] leading-none rise">Geçmiş</h1>

      {/* ---- Takvim ---- */}
      <Kart className="p-3">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => ayDegistir(-1)}
            className="w-9 h-9 rounded-lg bg-slab2 border border-line grid place-items-center text-ash active:bg-line">‹</button>
          <div className="num text-lg">{AY[ay.m]} {ay.y}</div>
          <button onClick={() => ayDegistir(1)}
            className="w-9 h-9 rounded-lg bg-slab2 border border-line grid place-items-center text-ash active:bg-line">›</button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {GUN_KISA.map((g) => (
            <div key={g} className="text-center text-[9.5px] text-dim font-semibold uppercase tracking-wide">{g}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {kareler.map((t, n) => {
            if (!t) return <div key={n} />
            const seanslar = seansMap[t] || []
            const planKey = db.ayarlar.plan[gunIndex(t)]
            const dinlenme = planKey === 'dinlenme'
            const buGun = t === bugun()
            // O gün yapılan antrenmanların renkleri (aynı renkten bir nokta)
            const noktalar = [...new Set(seanslar.map(
              (s) => RENK_NOKTA[db.program?.[s.planKey]?.renk] || 'bg-flame'))]
            return (
              <button key={t} onClick={() => setSecilenGun(t)}
                className={`aspect-square rounded-lg border grid place-items-center relative
                  ${seanslar.length ? 'bg-slab2 border-line2' : dinlenme ? 'border-line/40' : 'border-line/70'}
                  ${buGun ? 'ring-1 ring-flame' : ''} active:bg-line`}>
                <span className={`num text-[13px] ${seanslar.length ? 'text-bone' : 'text-dim'}`}>
                  {gun(t).getDate()}
                </span>
                {!!noktalar.length && (
                  <span className="absolute bottom-1 flex gap-0.5">
                    {noktalar.map((c, i) => <i key={i} className={`w-1.5 h-1.5 rounded-full ${c}`} />)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {/* Renk açıklaması programdaki antrenmanlardan üretilir */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-dim">
          {antrenmanAnahtarlari(db).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <i className={`w-2 h-2 rounded-full ${zeminRengi(db, k)}`} />{db.program[k].kisa || db.program[k].ad}
            </span>
          ))}
        </div>
      </Kart>

      {/* ---- Haftalık özet: her hafta için 7 günün dökümü ---- */}
      <div>
        <Baslik>Haftalık döküm</Baslik>
        <Kart className="divide-y divide-line/60 overflow-hidden">
          {haftalar.map((h, n) => (
            <div key={h.hafta} className="p-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px]">
                    {n === 0 ? 'Bu hafta' : n === 1 ? 'Geçen hafta' : `${trTarih(h.hafta)} haftası`}
                  </div>
                  <div className="text-[11.5px] text-dim mt-0.5">
                    {h.adet === 0 ? 'antrenman yok'
                      : h.hacim > 0 ? `${h.hacim.toLocaleString('tr-TR')} kg hacim`
                      : `${h.adet} antrenman`}
                    {h.kiloFark !== null && ` · kilo ${nfSigned(h.kiloFark)} kg`}
                  </div>
                </div>
                <span className={`num text-sm shrink-0 ${h.adet >= db.ayarlar.haftalikHedef ? 'text-jade' : 'text-ash'}`}>
                  {h.adet}/{db.ayarlar.haftalikHedef}
                </span>
              </div>

              {/* 7 gün: hangi gün hangi antrenman yapıldı */}
              <div className="flex gap-1">
                {h.gunler.map((g, i) => {
                  const yapildi = g.yapilan.length > 0
                  const gosterilen = g.yapilan[0] || g.plan
                  const dinlenme = gosterilen === 'dinlenme'
                  const kacirildi = g.tarih < bugun() && g.plan !== 'dinlenme' && !yapildi
                  const renk = metinRengi(db, gosterilen)
                  return (
                    <button key={i} onClick={() => setSecilenGun(g.tarih)}
                      className={`flex-1 min-w-0 rounded-lg border px-0.5 pt-1 pb-0.5 overflow-hidden active:bg-line
                        ${yapildi ? 'bg-jade/10 border-jade/40'
                          : kacirildi ? 'border-line/60 opacity-50'
                          : dinlenme ? 'border-line/40' : 'border-line/70'}`}>
                      <div className="text-[8px] font-semibold uppercase text-dim tracking-wide">{GUN_KISA[i]}</div>
                      <div className={`text-[8px] leading-[1.15] font-semibold h-[19px] mt-0.5
                        ${dinlenme ? 'text-dim/60' : yapildi ? 'text-jade/90' : `${renk} opacity-70`}`}>
                        {dinlenme ? '—' : db.program[gosterilen]?.kisa || ''}
                      </div>
                      <div className="h-3 text-[10px] leading-none text-jade">{yapildi ? '✓' : ''}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </Kart>
      </div>

      {/* ---- Son antrenmanlar ---- */}
      <div>
        <Baslik>Son antrenmanlar</Baslik>
        {db.antrenmanlar.length === 0 ? (
          <Kart className="p-6 text-center text-sm text-dim">
            Henüz kayıtlı antrenman yok.<br />İlk antrenmanını tamamlayınca burada listelenecek.
          </Kart>
        ) : (
          <div className="space-y-2">
            {[...db.antrenmanlar].reverse().slice(0, 12).map((s) => (
              <button key={s.id} onClick={() => setSecilenGun(s.tarih)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-slab border border-line/70 active:bg-slab2 text-left">
                <span className={`w-1.5 h-10 rounded-full shrink-0 ${zeminRengi(db, s.planKey)}`} />
                <span className="min-w-0 flex-1">
                  <span className="block num text-[15px] leading-tight">{db.program[s.planKey]?.ad || s.planKey}</span>
                  <span className="block text-[11.5px] text-dim mt-0.5">
                    {trTarih(s.tarih, true)} · {setSayisi(s)} set · {seansOzetMetni(s)}
                  </span>
                </span>
                <span className="text-[11px] text-dim shrink-0">{sureUzun(s.sure || 0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- Gün detayı ---- */}
      <Sheet acik={!!secilenGun} kapat={() => setSecilenGun(null)}
        baslik={secilenGun ? trTarih(secilenGun, true) : ''}>
        {seciliSeanslar.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-4xl mb-3 opacity-40">🗓</div>
            <p className="text-sm text-dim">
              Bu gün antrenman kaydı yok.<br />
              Planda: <b className="text-ash">{db.program[db.ayarlar.plan[gunIndex(secilenGun || bugun())]]?.ad}</b>
            </p>
          </div>
        ) : seciliSeanslar.map((s) => (
          <div key={s.id} className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="num text-xl">{db.program[s.planKey]?.ad}</div>
                <div className="text-[12px] text-dim">
                  {sureUzun(s.sure || 0)} · {setSayisi(s)} set · {seansOzetMetni(s)}
                </div>
              </div>
              <SilButonu onSil={() => {
                guncelle((d) => {
                  d.antrenmanlar = d.antrenmanlar.filter((x) => x.id !== s.id)
                  d.rekorlar = rekorlariHesapla(d.antrenmanlar)
                })
                setSecilenGun(null)
              }} />
            </div>
            <div className="space-y-2.5">
              {s.kayitlar.map((k, n) => {
                const b = k.setler.filter((x) => x.bitti)
                if (!b.length) return null
                const e = EX[k.exId]
                return (
                  <Kart key={n} className="p-3">
                    <div className="text-[14px] leading-tight">{e?.ad || k.exId}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {b.map((st, si) => (
                        <span key={si} className="num text-[12.5px] px-2 py-1 rounded-md bg-slab2 border border-line">
                          {setMetni(e, st)}
                        </span>
                      ))}
                    </div>
                    {k.not && <div className="text-[12.5px] text-gold/80 mt-2 italic">✎ {k.not}</div>}
                  </Kart>
                )
              })}
            </div>
          </div>
        ))}
      </Sheet>
    </div>
  )
}

/** Küçük sil butonu — onay ister */
function SilButonu({ onSil }) {
  const [ac, setAc] = useState(false)
  return (
    <>
      <Btn kucuk tip="tehlike" onClick={() => setAc(true)}>Sil</Btn>
      <Onay acik={ac} kapat={() => setAc(false)} baslik="Bu antrenmanı sil?"
        metin="Kayıt kalıcı olarak silinecek ve rekorlar yeniden hesaplanacak."
        onayla={onSil} />
    </>
  )
}

/* ═══ İLERLEME EKRANI ══════════════════════════════════════════════════════ */

function IlerlemeEkrani({ db, guncelle, setDb }) {
  const [mod, setMod] = useState('simdi')
  const [kiloAcik, setKiloAcik] = useState(false)
  const [olcumAcik, setOlcumAcik] = useState(false)
  const [nabizAcik, setNabizAcik] = useState(false)
  const [seciliEx, setSeciliEx] = useState(null)
  const [exSecici, setExSecici] = useState(false)
  const [bildirim, setBildirim] = useState(null)
  const dosyaRef = useRef(null)

  const { guncel, haftalikDegisim } = useMemo(() => kiloAnaliz(db), [db.kilolar, db.profil])
  const p = db.profil
  const kiloTakibi = db.ayarlar.kiloTakibi
  const kiloHedefiVar = p.hedefTip === 'al' || p.hedefTip === 'ver'

  // Genel ilerleme (hedef ister artı ister eksi yönde olsun aynı formül çalışır)
  const suanki = guncel?.kg ?? p.baslangicKilo
  const toplamHedef = p.hedefKilo - p.baslangicKilo
  const alinan = suanki - p.baslangicKilo
  const yuzde = toplamHedef !== 0 ? clamp((alinan / toplamHedef) * 100, 0, 100) : 0
  // Değişim doğru yönde mi? (kilo verende azalma iyidir)
  const iyiYon = p.hedefTip === 'ver' ? alinan <= 0 : alinan >= 0
  const gecenGun = clamp(gunFark(p.baslangicTarih, bugun()), 0, 9999)
  const toplamGun = Math.max(1, gunFark(p.baslangicTarih, p.hedefTarih))
  const zamanYuzde = clamp((gecenGun / toplamGun) * 100, 0, 100)

  // Kayıtlı hareketler (grafik için)
  const kayitliExler = useMemo(() => {
    const s = new Set()
    for (const a of db.antrenmanlar) for (const k of a.kayitlar) if (k.setler.some((x) => x.bitti)) s.add(k.exId)
    return [...s].filter((id) => EX[id]).sort((a, b) => EX[a].ad.localeCompare(EX[b].ad, 'tr'))
  }, [db.antrenmanlar])

  const sonOlcum = son([...db.olcumler].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))
  const ilkOlcum = [...db.olcumler].sort((a, b) => (a.tarih < b.tarih ? -1 : 1))[0]
  const sonNabiz = son([...db.nabizlar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))

  /* --- Yedekleme --- */
  const disaAktar = () => {
    const metin = JSON.stringify(db, null, 2)
    const ad = `demir-yedek-${bugun()}.json`
    // Android uygulaması içindeysek dosyayı Java tarafı İndirilenler'e yazar
    if (window.Android?.dosyaKaydet) {
      const sonuc = window.Android.dosyaKaydet(ad, metin)
      setBildirim(sonuc
        ? { tip: 'ok', metin: `Yedek kaydedildi: ${sonuc}` }
        : { tip: 'hata', metin: 'Yedek kaydedilemedi.' })
      return
    }
    const blob = new Blob([metin], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = ad
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setBildirim({ tip: 'ok', metin: `${ad} indirildi.` })
  }
  const iceAktar = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      try {
        const d = JSON.parse(r.result)
        if (!yedekGecerliMi(d)) throw new Error('bozuk')
        setDb(duzelt(d))
        setBildirim({ tip: 'ok', metin: `Yedek yüklendi — ${(d.antrenmanlar || []).length} antrenman geri geldi.` })
      } catch {
        setBildirim({ tip: 'hata', metin: 'Dosya okunamadı. Bu uygulamadan alınmış bir yedek dosyası seç.' })
      }
    }
    r.readAsText(f)
    e.target.value = ''
  }

  return (
    <div className="px-3 pt-2 space-y-5">
      <h1 className="text-[28px] leading-none rise">İlerleme</h1>

      {/* ---- Genel ilerleme ---- */}
      {kiloTakibi && kiloHedefiVar && (
      <Kart className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[13px] font-semibold">
            {Math.round(Math.max(1, gunFark(p.baslangicTarih, p.hedefTarih)) / 7)} haftalık hedef
          </span>
          <span className="num text-lg text-flame">%{nf(yuzde, 0)}</span>
        </div>
        <div className="relative h-3 rounded-full bg-slab2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-flame2 to-flame rounded-full transition-[width]"
            style={{ width: `${yuzde}%` }} />
          {/* zaman göstergesi: ne kadar süre geçti */}
          <div className="absolute inset-y-0 w-[2px] bg-bone/70" style={{ left: `${zamanYuzde}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-[11px]">
          <span className="text-dim">{nf(p.baslangicKilo, 1)} kg <span className="opacity-60">başlangıç</span></span>
          <span className="num text-bone">{nf(suanki, 1)} kg</span>
          <span className="text-gold">{nf(p.hedefKilo, 1)} kg <span className="opacity-70">hedef</span></span>
        </div>
        <div className="mt-3 pt-3 border-t border-line/60 flex items-center gap-2 text-[11.5px] text-dim">
          <span className="w-[2px] h-3 bg-bone/70 shrink-0" />
          Sürenin %{nf(zamanYuzde, 0)}'i geçti · {Math.max(0, toplamGun - gecenGun)} gün kaldı
          {yuzde + 8 < zamanYuzde && <Rozet renk="gold" className="ml-auto">geride</Rozet>}
          {yuzde > zamanYuzde + 8 && <Rozet renk="jade" className="ml-auto">önde</Rozet>}
        </div>
      </Kart>
      )}

      {/* ---- Kilo grafiği ---- */}
      {kiloTakibi && (
      <div>
        <Baslik sag={<Btn kucuk tip="ana" onClick={() => setKiloAcik(true)}>+ Kilo</Btn>}>Kilo takibi</Baslik>
        <Kart className="p-3">
          <div className="flex gap-4 mb-2 px-1">
            <Stat ust="Güncel" deger={guncel ? `${nf(guncel.kg, 1)}` : '—'} alt="kg" />
            <Stat ust="Bu hafta" deger={haftalikDegisim !== null ? nfSigned(haftalikDegisim) : '—'} alt="kg"
              renk={degisimRengi(db, haftalikDegisim)} />
            <Stat ust="Toplam" deger={nfSigned(alinan)} alt="kg"
              renk={alinan === 0 ? 'text-bone' : iyiYon ? 'text-jade' : 'text-blood'} />
          </div>
          <KiloGrafik db={db} mod={mod} setMod={setMod} />
        </Kart>
      </div>
      )}

      {/* ---- Hareket bazlı grafik ---- */}
      <div>
        <Baslik>Hareket gelişimi</Baslik>
        {kayitliExler.length === 0 ? (
          <Kart className="p-5 text-center text-sm text-dim">
            Antrenman kaydettikçe hareketlerinin gelişim grafiği burada oluşur.
          </Kart>
        ) : (
          <Kart className="p-3">
            <button onClick={() => setExSecici(true)}
              className="w-full flex items-center gap-2 mb-2 px-1 py-1.5 rounded-lg active:bg-slab2">
              <span className="num text-[16px] truncate flex-1 text-left">
                {EX[seciliEx || kayitliExler[0]]?.ad}
              </span>
              <span className="text-[11px] text-flame2 font-semibold shrink-0">değiştir ▾</span>
            </button>
            <HareketGrafik db={db} exId={seciliEx || kayitliExler[0]} />
            {(() => {
              const id = seciliEx || kayitliExler[0]
              const m = rekorMetni(EX[id], db.rekorlar?.[id])
              if (!m) return null
              return (
                <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-line/60">
                  <Rozet renk="gold">🏆 En iyi: {m.ana}</Rozet>
                  <Rozet renk="gold">{m.alt}</Rozet>
                </div>
              )
            })()}
          </Kart>
        )}
      </div>

      {/* ---- Çevre ölçümleri ---- */}
      <div>
        <Baslik sag={<Btn kucuk tip="sade" onClick={() => setOlcumAcik(true)}>+ Ölçüm</Btn>}>Çevre ölçümleri</Baslik>
        <Kart className="p-3">
          {!sonOlcum ? (
            <p className="text-sm text-dim text-center py-4 leading-relaxed">
              Haftada bir ölç — kas kazanırken kilo tek başına yeterli bilgi vermez.<br />
              <span className="text-[12px]">Kol ve göğüs artarken bel sabitse doğru yoldasın.</span>
            </p>
          ) : (
            <div className="grid grid-cols-5 gap-1">
              {OLCUM.map((o) => {
                const s = sonOlcum[o.id]
                const i = ilkOlcum?.[o.id]
                const f = s != null && i != null ? s - i : null
                return (
                  <div key={o.id} className="text-center">
                    <div className="text-[10px] text-dim uppercase tracking-wider">{o.ad}</div>
                    <div className="num text-[17px] mt-0.5">{s != null ? nf(s, 1) : '—'}</div>
                    {f !== null && f !== 0 && (
                      <div className={`text-[10px] ${f > 0 ? 'text-jade' : 'text-ash'}`}>{nfSigned(f)}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {sonOlcum && <div className="text-[11px] text-dim text-center mt-2 pt-2 border-t border-line/60">
            Son ölçüm: {trTarih(sonOlcum.tarih, true)} · birim cm
          </div>}
        </Kart>
      </div>

      {/* ---- Dinlenme nabzı ---- */}
      <div>
        <Baslik sag={<Btn kucuk tip="sade" onClick={() => setNabizAcik(true)}>+ Nabız</Btn>}>Dinlenme nabzı</Baslik>
        <Kart className="p-3.5 flex items-center gap-4">
          <div className="text-3xl">❤️</div>
          <div className="min-w-0 flex-1">
            {sonNabiz ? (
              <>
                <div className="num text-2xl">{sonNabiz.bpm} <span className="text-sm text-dim">bpm</span></div>
                <div className="text-[11.5px] text-dim">{trTarih(sonNabiz.tarih, true)}</div>
              </>
            ) : (
              <p className="text-[12.5px] text-dim leading-snug">
                Sabah uyanınca, yataktan kalkmadan ölç. Zamanla düşmesi kondisyonun geliştiğini gösterir;
                birden yükselmesi yorgunluk veya hastalık işareti olabilir.
              </p>
            )}
          </div>
        </Kart>
      </div>

      {/* ---- Yedekleme ---- */}
      <div>
        <Baslik>Veri yedekleme</Baslik>
        <Kart className="p-3.5">
          <p className="text-[12.5px] text-ash leading-relaxed mb-3">
            Tüm verilerin bu cihazın tarayıcısında saklanıyor. Tarayıcı verisini silersen kaybolur —
            ara sıra yedek al.
          </p>
          <div className="flex gap-2">
            <Btn tip="sade" className="flex-1" onClick={disaAktar}>↓ Dışa aktar</Btn>
            <Btn tip="sade" className="flex-1" onClick={() => dosyaRef.current?.click()}>↑ İçe aktar</Btn>
          </div>
          <input ref={dosyaRef} type="file" accept="application/json,.json" onChange={iceAktar} className="hidden" />
        </Kart>
      </div>

      {/* ---- Paneller ---- */}
      <Bildirim veri={bildirim} kapat={() => setBildirim(null)} />
      <KiloGirisPaneli acik={kiloAcik} kapat={() => setKiloAcik(false)} db={db} guncelle={guncelle} />
      <OlcumPaneli acik={olcumAcik} kapat={() => setOlcumAcik(false)} db={db} guncelle={guncelle} />
      <NabizPaneli acik={nabizAcik} kapat={() => setNabizAcik(false)} db={db} guncelle={guncelle} />

      <Sheet acik={exSecici} kapat={() => setExSecici(false)} baslik="Hareket seç">
        <div className="space-y-1">
          {kayitliExler.map((id) => (
            <button key={id} onClick={() => { setSeciliEx(id); setExSecici(false) }}
              className={`w-full flex items-center gap-3 p-2 rounded-xl text-left active:bg-slab2
                ${(seciliEx || kayitliExler[0]) === id ? 'bg-flame/10 border border-flame/30' : 'border border-transparent'}`}>
              <HareketGorseli ex={EX[id]} oynat={false} className="w-11 h-11 rounded-lg shrink-0" />
              <span className="flex-1 text-[14px] truncate">{EX[id].ad}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

/** Çevre ölçümü giriş paneli */
function OlcumPaneli({ acik, kapat, db, guncelle }) {
  const bos = { kol: '', gogus: '', bel: '', kalca: '', uyluk: '' }
  const [v, setV] = useState(bos)
  useEffect(() => {
    if (!acik) return
    const bugunku = db.olcumler.find((o) => o.tarih === bugun())
    const sonu = son([...db.olcumler].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))
    const kaynak = bugunku || sonu
    setV(kaynak ? { kol: kaynak.kol ?? '', gogus: kaynak.gogus ?? '', bel: kaynak.bel ?? '',
      kalca: kaynak.kalca ?? '', uyluk: kaynak.uyluk ?? '' } : bos)
  }, [acik])

  const kaydet = () => {
    const kayit = { tarih: bugun() }
    let doluMu = false
    for (const o of OLCUM) {
      if (v[o.id] !== '' && !Number.isNaN(Number(v[o.id]))) { kayit[o.id] = Number(v[o.id]); doluMu = true }
    }
    if (!doluMu) return kapat()
    guncelle((d) => {
      const i = d.olcumler.findIndex((o) => o.tarih === bugun())
      if (i >= 0) d.olcumler[i] = kayit
      else d.olcumler.push(kayit)
      d.olcumler.sort((a, b) => (a.tarih < b.tarih ? -1 : 1))
    })
    kapat()
  }

  return (
    <Sheet acik={acik} kapat={kapat} baslik="Çevre ölçümleri">
      <p className="text-[13px] text-ash leading-relaxed mb-4">
        Haftada bir, aynı gün ve aynı koşullarda ölç. Kolu kasmadan, gevşek halde; beli göbek deliği hizasından.
        Boş bıraktığın alanlar kaydedilmez.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {OLCUM.map((o) => (
          <Alan key={o.id} etiket={o.ad} birim="cm" type="number" inputMode="decimal"
            value={v[o.id]} placeholder="—"
            onChange={(e) => setV((x) => ({ ...x, [o.id]: e.target.value }))} />
        ))}
      </div>
      <Btn tip="ana" className="w-full mt-5" onClick={kaydet}>Kaydet · {trTarih(bugun())}</Btn>
    </Sheet>
  )
}

/** Dinlenme nabzı giriş paneli */
function NabizPaneli({ acik, kapat, db, guncelle }) {
  const [bpm, setBpm] = useState(60)
  useEffect(() => {
    if (!acik) return
    const bugunku = db.nabizlar.find((x) => x.tarih === bugun())
    const sonu = son([...db.nabizlar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))
    setBpm(bugunku?.bpm ?? sonu?.bpm ?? 60)
  }, [acik])

  const kaydet = () => {
    guncelle((d) => {
      const i = d.nabizlar.findIndex((x) => x.tarih === bugun())
      if (i >= 0) d.nabizlar[i].bpm = Number(bpm)
      else d.nabizlar.push({ tarih: bugun(), bpm: Number(bpm) })
      d.nabizlar.sort((a, b) => (a.tarih < b.tarih ? -1 : 1))
    })
    kapat()
  }

  const gecmis = [...db.nabizlar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)).slice(-8)

  return (
    <Sheet acik={acik} kapat={kapat} baslik="Dinlenme nabzı">
      <p className="text-[13px] text-ash leading-relaxed mb-4">
        Sabah uyanınca, <b className="text-bone">yataktan kalkmadan</b> 30 saniye say ve ikiyle çarp.
      </p>
      <div className="flex justify-center my-6">
        <div className="w-48"><Sayac deger={bpm} ayarla={setBpm} adim={1} min={30} max={140} birim="bpm" /></div>
      </div>
      {gecmis.length > 1 && (
        <div className="mb-4">
          <Baslik>Son ölçümler</Baslik>
          <div className="flex items-end gap-1 h-16">
            {gecmis.map((x, i) => {
              const mn = Math.min(...gecmis.map((g) => g.bpm))
              const mx = Math.max(...gecmis.map((g) => g.bpm))
              const h = 25 + ((x.bpm - mn) / (mx - mn || 1)) * 75
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-blood/50" style={{ height: `${h}%` }} />
                  <span className="text-[9px] text-dim tabular-nums">{x.bpm}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <Btn tip="ana" className="w-full" onClick={kaydet}>Kaydet · {trTarih(bugun())}</Btn>
    </Sheet>
  )
}

/* ═══ AYARLAR EKRANI ═══════════════════════════════════════════════════════ */

function AyarlarEkrani({ db, guncelle, setDb, kurulumuAc }) {
  const [duzenle, setDuzenle] = useState(null) // düzenlenen antrenman anahtarı
  const [sifirlaOnay, setSifirlaOnay] = useState(false)
  const [beslenmeAcik, setBeslenmeAcik] = useState(false)
  const a = db.ayarlar
  const kiloHedefiVar = db.profil.hedefTip === 'al' || db.profil.hedefTip === 'ver'

  const ayarla = (k, v) => guncelle((d) => { d.ayarlar[k] = v })
  const profilAyarla = (k, v) => guncelle((d) => { d.profil[k] = v })

  // Plan açılır listesi programdaki antrenmanlardan üretilir
  const PLAN_SEC = [
    ...antrenmanAnahtarlari(db).map((k) => [k, db.program[k].ad]),
    ['dinlenme', 'Dinlenme'],
  ]

  return (
    <div className="px-3 pt-2 space-y-6">
      <h1 className="text-[28px] leading-none rise">Ayarlar</h1>

      {/* ---- Haftalık plan ---- */}
      <div>
        <Baslik>Haftalık plan</Baslik>
        <Kart className="divide-y divide-line/60 overflow-hidden">
          {GUN_UZUN.map((ad, n) => (
            <div key={n} className="flex items-center gap-3 p-2.5">
              <span className="text-[14px] w-24 shrink-0">{ad}</span>
              <select value={a.plan[n]}
                onChange={(e) => guncelle((d) => { d.ayarlar.plan[n] = e.target.value })}
                className="flex-1 min-w-0 bg-slab2 border border-line rounded-lg px-3 py-2.5 text-[14px]
                  outline-none focus:border-flame/50 appearance-none">
                {PLAN_SEC.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          ))}
        </Kart>
      </div>

      {/* ---- Ekipman ---- */}
      <div>
        <Baslik>Ekipmanım</Baslik>
        <Kart className="px-3.5">
          <Anahtar acik={a.barfiksBari} degistir={(v) => ayarla('barfiksBari', v)}
            etiket="Barfiks (çekme) barım var"
            alt={a.barfiksBari
              ? 'Barfiks ve negatif barfiks programda olduğu gibi gösteriliyor.'
              : 'Barfiks gerektiren hareketler otomatik olarak Dar Tutuş Lat Pulldown ile değiştiriliyor. Bar edinirsen bu anahtarı aç.'} />
        </Kart>
      </div>

      {/* ---- Antrenman içerikleri ---- */}
      <div>
        <Baslik>Antrenman içerikleri</Baslik>
        <Kart className="divide-y divide-line/60 overflow-hidden">
          {antrenmanAnahtarlari(db).map((k) => (
            <button key={k} onClick={() => setDuzenle(k)}
              className="w-full flex items-center gap-3 p-3 active:bg-slab2 text-left">
              <span className={`w-1.5 h-9 rounded-full shrink-0 ${zeminRengi(db, k)}`} />
              <span className="min-w-0 flex-1">
                <span className="block num text-[16px] leading-tight">{db.program[k].ad}</span>
                <span className="block text-[11.5px] text-dim mt-0.5">
                  {db.program[k].hareketler.length} hareket ·{' '}
                  {db.program[k].hareketler.reduce((t, h) => t + h.set, 0)} set
                </span>
              </span>
              <span className="text-dim text-lg">›</span>
            </button>
          ))}
        </Kart>
      </div>

      {/* ---- Hedef tipi ---- */}
      <div>
        <Baslik>Hedefim</Baslik>
        <Kart className="p-2 space-y-1.5">
          {Object.entries(HEDEF_TIPLERI).map(([k, t]) => {
            const secili = db.profil.hedefTip === k
            return (
              <button key={k}
                onClick={() => guncelle((d) => {
                  d.profil.hedefTip = k
                  d.ayarlar.hizAlt = t.hizAlt
                  d.ayarlar.hizUst = t.hizUst
                  d.ayarlar.kiloTakibi = k !== 'yok'
                })}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors
                  ${secili ? 'bg-flame/10 border-flame/50' : 'border-transparent active:bg-slab2'}`}>
                <span className={`num text-xl w-6 text-center shrink-0 ${secili ? 'text-flame' : 'text-dim'}`}>{t.ikon}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[14px] ${secili ? 'text-bone font-semibold' : 'text-ash'}`}>{t.ad}</span>
                  <span className="block text-[11.5px] text-dim">{t.alt}</span>
                </span>
                {secili && <span className="text-flame shrink-0">✓</span>}
              </button>
            )
          })}
        </Kart>
      </div>

      {/* ---- Hedef ayrıntıları ---- */}
      <div>
        <Baslik>{kiloHedefiVar ? 'Kilo hedefi' : 'Ölçüler'}</Baslik>
        <Kart className="p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Alan etiket="Başlangıç kilosu" birim="kg" type="number" inputMode="decimal"
              value={db.profil.baslangicKilo}
              onChange={(e) => profilAyarla('baslangicKilo', Number(e.target.value) || 0)} />
            <Alan etiket="Hedef kilo" birim="kg" type="number" inputMode="decimal"
              value={db.profil.hedefKilo}
              onChange={(e) => profilAyarla('hedefKilo', Number(e.target.value) || 0)} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Alan etiket="Başlangıç tarihi" type="date" value={db.profil.baslangicTarih}
              onChange={(e) => profilAyarla('baslangicTarih', e.target.value)} />
            <Alan etiket="Hedef tarihi" type="date" value={db.profil.hedefTarih}
              onChange={(e) => profilAyarla('hedefTarih', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Alan etiket="Boy" birim="cm" type="number" inputMode="numeric" value={db.profil.boy}
              onChange={(e) => profilAyarla('boy', Number(e.target.value) || 0)} />
            <Alan etiket="Yaş" type="number" inputMode="numeric" value={db.profil.yas}
              onChange={(e) => profilAyarla('yas', Number(e.target.value) || 0)} />
          </div>
          {kiloHedefiVar && (() => {
            const gunS = Math.max(1, gunFark(db.profil.baslangicTarih, db.profil.hedefTarih))
            const hiz = ((db.profil.hedefKilo - db.profil.baslangicKilo) / gunS) * 7
            const t = HEDEF_TIPLERI[db.profil.hedefTip]
            const cokHizli = db.profil.hedefTip === 'al' ? hiz > t.hizUst + 0.2 : hiz < t.hizAlt - 0.2
            return (
              <div className={`text-[12px] leading-relaxed p-2.5 rounded-lg border
                ${cokHizli ? 'text-gold border-gold/30 bg-gold/[0.06]' : 'text-ash border-line bg-slab2'}`}>
                Bu hedef haftada <b>{nfSigned(hiz, 2)} kg</b> demek.
                {cokHizli
                  ? (db.profil.hedefTip === 'al'
                    ? ' Bu hız agresif — alınanın büyük kısmı yağ olabilir.'
                    : ' Bu hızda kaybın önemli kısmı kas olur.')
                  : Math.abs(hiz) < 0.08 ? ' Bu hız çok yavaş, fark etmesi aylar alır.'
                  : ' Sağlıklı aralıkta.'}
              </div>
            )
          })()}
        </Kart>
      </div>

      {/* ---- İdeal değişim bandı ---- */}
      {db.ayarlar.kiloTakibi && (
        <div>
          <Baslik>Grafikteki ideal bant</Baslik>
          <Kart className="p-3.5">
            <p className="text-[12px] text-dim leading-relaxed mb-3">
              Kilo grafiğindeki yeşil alan. Haftalık değişimin bu aralıkta kalması hedeflenir;
              uyarılar da buna göre çıkar.
            </p>
            {[['hizAlt', 'Alt sınır'], ['hizUst', 'Üst sınır']].map(([k, ad]) => (
              <div key={k} className="mb-3 last:mb-0">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[13px]">{ad}</span>
                  <span className="num text-flame">{nfSigned(a[k], 2)} kg/hafta</span>
                </div>
                <input type="range" min="-1.2" max="1.2" step="0.05" value={a[k]}
                  onChange={(e) => ayarla(k, Number(e.target.value))}
                  className="w-full accent-[#ff4a17] h-2" />
              </div>
            ))}
            {a.hizAlt > a.hizUst && (
              <p className="text-[12px] text-gold mt-1">Alt sınır üst sınırdan büyük — değerleri değiştir.</p>
            )}
          </Kart>
        </div>
      )}

      {/* ---- Dinlenme süreleri ---- */}
      <div>
        <Baslik>Set arası dinlenme</Baslik>
        <Kart className="p-3.5 space-y-4">
          {[
            ['dinlenmeBilesik', 'Bileşik hareketler', 'Chest press, barfiks, bulgar split squat gibi çok eklemli hareketler'],
            ['dinlenmeIzolasyon', 'İzolasyon hareketleri', 'Kelebek, curl, kalf gibi tek eklemli hareketler'],
          ].map(([k, ad, alt]) => (
            <div key={k}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[14px]">{ad}</span>
                <span className="num text-flame">{sure(a[k])}</span>
              </div>
              <p className="text-[11.5px] text-dim mb-2 leading-snug">{alt}</p>
              <input type="range" min="30" max="300" step="15" value={a[k]}
                onChange={(e) => ayarla(k, Number(e.target.value))}
                className="w-full accent-[#ff4a17] h-2" />
            </div>
          ))}
        </Kart>
      </div>

      {/* ---- Diğer ---- */}
      <div>
        <Baslik>Uygulama</Baslik>
        <Kart className="px-3.5 divide-y divide-line/60">
          <Anahtar acik={a.deloadHatirlat} degistir={(v) => ayarla('deloadHatirlat', v)}
            etiket="Deload hatırlatması"
            alt="6 haftada bir hafifletme haftası önerilir — vücudun toparlanması için" />
          <Anahtar acik={a.ses} degistir={(v) => ayarla('ses', v)}
            etiket="Ses uyarısı" alt="Set bitince ve dinlenme dolunca bip sesi" />
          <Anahtar acik={a.titresim} degistir={(v) => ayarla('titresim', v)}
            etiket="Titreşim" alt="Telefon destekliyorsa titreşimle uyarır" />
          <Anahtar acik={a.kiloTakibi} degistir={(v) => ayarla('kiloTakibi', v)}
            etiket="Kilo takibi"
            alt="Kapatırsan kilo girişi, grafiği ve uyarıları gizlenir; sadece antrenman takibi kalır" />
          <div className="py-3">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[15px]">Haftalık antrenman hedefi</span>
              <span className="num text-flame">{a.haftalikHedef}</span>
            </div>
            <input type="range" min="2" max="6" step="1" value={a.haftalikHedef}
              onChange={(e) => ayarla('haftalikHedef', Number(e.target.value))}
              className="w-full accent-[#ff4a17] h-2" />
          </div>
        </Kart>
      </div>

      {/* ---- Beslenme listesi ---- */}
      <div>
        <Baslik>Beslenme listesi</Baslik>
        <Kart className="p-3.5">
          <p className="text-[12.5px] text-ash leading-relaxed mb-3">
            Bugün sekmesindeki günlük kontrol listesi. Kendi öğünlerini, takviyelerini veya
            alışkanlıklarını yazabilirsin.
          </p>
          <Btn tip="sade" className="w-full" onClick={() => setBeslenmeAcik(true)}>
            {(db.beslenmeListesi || []).length} madde — düzenle
          </Btn>
        </Kart>
      </div>

      {/* ---- Kurulum ---- */}
      <div>
        <Baslik>Profil ve program</Baslik>
        <Kart className="p-3.5">
          <p className="text-[12.5px] text-ash leading-relaxed mb-3">
            Hedefin veya durumun değiştiyse kurulum sihirbazını tekrar çalıştırabilirsin.
            Antrenman geçmişin ve kilo kayıtların silinmez, sadece program ve hedef güncellenir.
          </p>
          <Btn tip="sade" className="w-full" onClick={kurulumuAc}>↺ Kurulumu tekrar çalıştır</Btn>
        </Kart>
      </div>

      {/* ---- Alternatif seçimleri ---- */}
      {Object.keys(db.degisim || {}).length > 0 && (
        <div>
          <Baslik>Değiştirdiğin hareketler</Baslik>
          <Kart className="divide-y divide-line/60 overflow-hidden">
            {Object.entries(db.degisim).map(([asil, yeni]) => (
              <div key={asil} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] truncate">{EX[yeni]?.ad}</div>
                  <div className="text-[11.5px] text-dim truncate">{EX[asil]?.ad} yerine</div>
                </div>
                <Btn kucuk tip="hayalet"
                  onClick={() => guncelle((d) => { delete d.degisim[asil] })}>Geri al</Btn>
              </div>
            ))}
          </Kart>
        </div>
      )}

      {/* ---- Sıfırlama ---- */}
      <div>
        <Baslik>Tehlikeli bölge</Baslik>
        <Kart className="p-3.5 border-blood/25">
          <p className="text-[12.5px] text-ash leading-relaxed mb-3">
            Tüm antrenmanlar, kilo kayıtları, ölçümler ve ayarlar silinir. Bu işlem geri alınamaz —
            önce İlerleme sekmesinden yedek almanı öneririm.
          </p>
          <Btn tip="tehlike" className="w-full" onClick={() => setSifirlaOnay(true)}>
            Tüm verileri sıfırla
          </Btn>
        </Kart>
      </div>

      <p className="text-center text-[11px] text-dim pt-2 leading-relaxed">
        Demir · sürüm 1.0<br />
        Hareket görselleri: free-exercise-db (açık lisans)
      </p>

      {/* ---- Program düzenleyici ---- */}
      <ProgramDuzenleyici acik={!!duzenle} kapat={() => setDuzenle(null)}
        planKey={duzenle} db={db} guncelle={guncelle} />

      {/* ---- Beslenme listesi düzenleyici ---- */}
      <BeslenmeDuzenleyici acik={beslenmeAcik} kapat={() => setBeslenmeAcik(false)}
        db={db} guncelle={guncelle} />

      <Onay acik={sifirlaOnay} kapat={() => setSifirlaOnay(false)}
        baslik="Her şeyi sil?"
        metin="Tüm antrenman geçmişin, kilo kayıtların ve ayarların kalıcı olarak silinecek. Bu işlem geri alınamaz."
        onayla={() => { localStorage.removeItem(ANAHTAR); setDb(VARSAYILAN()) }}
        onayMetin="Evet, hepsini sil" />
    </div>
  )
}

/** Günlük beslenme kontrol listesini düzenleme: madde ekle/çıkar/yeniden adlandır */
function BeslenmeDuzenleyici({ acik, kapat, db, guncelle }) {
  const [ikonSecim, setIkonSecim] = useState(null) // düzenlenen maddenin id'si
  if (!acik) return null
  const liste = db.beslenmeListesi || []

  const yaz = (id, alan, deger) => guncelle((d) => {
    const m = d.beslenmeListesi.find((x) => x.id === id)
    if (m) m[alan] = deger
  })
  const sil = (id) => guncelle((d) => {
    d.beslenmeListesi = d.beslenmeListesi.filter((x) => x.id !== id)
  })
  const tasi = (i, yon) => guncelle((d) => {
    const l = d.beslenmeListesi
    const j = i + yon
    if (j < 0 || j >= l.length) return
    ;[l[i], l[j]] = [l[j], l[i]]
  })
  const ekle = () => guncelle((d) => {
    d.beslenmeListesi.push({ id: uid(), ad: '', ikon: '🍽' })
  })
  const varsayilana = () => guncelle((d) => {
    d.beslenmeListesi = JSON.parse(JSON.stringify(
      BESLENME_VARSAYILAN[d.profil.hedefTip] || BESLENME_VARSAYILAN.koru))
  })

  return (
    <Sheet acik={acik} kapat={kapat} baslik="Beslenme listesi" tam>
      <p className="text-[13px] text-ash leading-relaxed mb-4">
        Her gün tik atacağın maddeler. Kalori saymak yerine tutarlılığı ölçer —
        bu yüzden takip edebileceğin kadar madde yaz.
      </p>

      <div className="space-y-2">
        {liste.map((m, i) => (
          <Kart key={m.id} className="p-2">
            <div className="flex items-center gap-2">
              <button onClick={() => setIkonSecim(ikonSecim === m.id ? null : m.id)}
                className="w-10 h-10 shrink-0 rounded-lg bg-slab2 border border-line grid place-items-center text-lg active:bg-line">
                {m.ikon || '🍽'}
              </button>
              <input value={m.ad} placeholder="örn. Öğle: tavuk + pilav"
                onChange={(e) => yaz(m.id, 'ad', e.target.value)}
                className="flex-1 min-w-0 bg-slab2 border border-line rounded-lg px-3 py-2.5 text-[14px]
                  outline-none focus:border-flame/50 placeholder:text-dim/70" />
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => tasi(i, -1)} disabled={i === 0}
                  className="w-7 h-5 rounded bg-slab2 border border-line text-ash text-[10px] disabled:opacity-30 active:bg-line">▲</button>
                <button onClick={() => tasi(i, 1)} disabled={i === liste.length - 1}
                  className="w-7 h-5 rounded bg-slab2 border border-line text-ash text-[10px] disabled:opacity-30 active:bg-line">▼</button>
              </div>
              <button onClick={() => sil(m.id)}
                className="w-9 h-9 shrink-0 rounded-lg bg-blood/12 border border-blood/30 text-blood active:bg-blood/25">✕</button>
            </div>
            {ikonSecim === m.id && (
              <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-line/60">
                {BESLENME_IKONLAR.map((ik) => (
                  <button key={ik} onClick={() => { yaz(m.id, 'ikon', ik); setIkonSecim(null) }}
                    className={`w-9 h-9 rounded-lg grid place-items-center text-lg border
                      ${m.ikon === ik ? 'bg-flame/15 border-flame/50' : 'bg-slab2 border-line active:bg-line'}`}>
                    {ik}
                  </button>
                ))}
              </div>
            )}
          </Kart>
        ))}
      </div>

      {!liste.length && (
        <p className="text-center text-sm text-dim py-6">
          Liste boş. Madde eklemezsen Bugün sekmesinde beslenme bölümü görünmez.
        </p>
      )}

      <Btn tip="sade" className="w-full mt-4" onClick={ekle}>+ Madde ekle</Btn>
      <Btn tip="hayalet" className="w-full mt-2" onClick={varsayilana}>
        ↺ Hedefime uygun varsayılan listeye dön
      </Btn>
    </Sheet>
  )
}

/** Bir antrenmanın hareketlerini düzenleme: sıralama, silme, ekleme, set/tekrar ayarı */
function ProgramDuzenleyici({ acik, kapat, planKey, db, guncelle }) {
  const [ekleAcik, setEkleAcik] = useState(false)
  const [ara, setAra] = useState('')
  if (!acik || !planKey) return null
  const p = db.program[planKey]

  const tasi = (i, yon) => guncelle((d) => {
    const h = d.program[planKey].hareketler
    const j = i + yon
    if (j < 0 || j >= h.length) return
    ;[h[i], h[j]] = [h[j], h[i]]
  })
  const sil = (i) => guncelle((d) => { d.program[planKey].hareketler.splice(i, 1) })
  const alanAyarla = (i, k, v) => guncelle((d) => { d.program[planKey].hareketler[i][k] = v })
  const ekle = (exId) => {
    guncelle((d) => {
      d.program[planKey].hareketler.push({ exId, set: 3, hedefMin: 8, hedefMax: 12 })
    })
    setEkleAcik(false); setAra('')
  }
  // Bu antrenmanı geldiği şablondaki hâline döndürür
  const kaynak = SABLONLAR[db.ayarlar.sablon]?.antrenmanlar?.[planKey]
  const varsayilanaDon = () => guncelle((d) => {
    if (kaynak) d.program[planKey] = JSON.parse(JSON.stringify(kaynak))
  })

  const mevcut = new Set(p.hareketler.map((h) => h.exId))
  const adaylar = Object.entries(EX)
    .filter(([id, e]) => !mevcut.has(id) && (!ara || e.ad.toLocaleLowerCase('tr').includes(ara.toLocaleLowerCase('tr')) || e.kas.toLocaleLowerCase('tr').includes(ara.toLocaleLowerCase('tr'))))
    .sort((a, b) => a[1].ad.localeCompare(b[1].ad, 'tr'))

  return (
    <Sheet acik={acik} kapat={kapat} baslik={p.ad} tam>
      <div className="space-y-2.5">
        {p.hareketler.map((h, i) => {
          const e = EX[h.exId]
          if (!e) return null
          return (
            <Kart key={`${h.exId}-${i}`} className="p-2.5">
              <div className="flex items-center gap-2.5">
                <HareketGorseli ex={e} oynat={false} className="w-11 h-11 rounded-lg shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] leading-tight truncate">{e.ad}</div>
                  <div className="text-[11px] text-dim truncate mt-0.5">{e.kas}</div>
                </div>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => tasi(i, -1)} disabled={i === 0}
                    className="w-8 h-6 rounded bg-slab2 border border-line text-ash text-[11px] disabled:opacity-30 active:bg-line">▲</button>
                  <button onClick={() => tasi(i, 1)} disabled={i === p.hareketler.length - 1}
                    className="w-8 h-6 rounded bg-slab2 border border-line text-ash text-[11px] disabled:opacity-30 active:bg-line">▼</button>
                </div>
                <button onClick={() => sil(i)}
                  className="w-9 h-9 shrink-0 rounded-lg bg-blood/12 border border-blood/30 text-blood active:bg-blood/25">✕</button>
              </div>
              <div className="flex gap-1.5 mt-2.5">
                <Sayac kompakt deger={h.set} ayarla={(v) => alanAyarla(i, 'set', clamp(v, 1, 10))} adim={1} min={1} max={10} etiket="Set" />
                <Sayac kompakt deger={h.hedefMin} ayarla={(v) => alanAyarla(i, 'hedefMin', v)} adim={1} min={1} max={100} etiket="Alt tekrar" />
                <Sayac kompakt deger={h.hedefMax > 90 ? 99 : h.hedefMax} ayarla={(v) => alanAyarla(i, 'hedefMax', v)} adim={1} min={1} max={99} etiket="Üst tekrar" />
              </div>
              {h.maks && <div className="text-[11px] text-dim mt-1.5">Bu harekette hedef "maksimum tekrar" — üst sınır uygulanmaz.</div>}
            </Kart>
          )
        })}
      </div>

      <Btn tip="sade" className="w-full mt-4" onClick={() => setEkleAcik(true)}>+ Hareket ekle</Btn>
      {kaynak && (
        <Btn tip="hayalet" className="w-full mt-2" onClick={varsayilanaDon}>↺ Şablondaki hâline dön</Btn>
      )}

      <Sheet acik={ekleAcik} kapat={() => { setEkleAcik(false); setAra('') }} baslik="Hareket ekle" tam>
        <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Hareket veya kas ara…"
          className="w-full bg-slab2 border border-line rounded-xl px-3 py-3 text-[15px] outline-none
            focus:border-flame/50 mb-3 placeholder:text-dim" />
        <div className="space-y-1.5">
          {adaylar.map(([id, e]) => (
            <button key={id} onClick={() => ekle(id)}
              className="w-full flex items-center gap-3 p-2 rounded-xl bg-slab border border-line/70 active:bg-slab2 text-left">
              <HareketGorseli ex={e} oynat={false} className="w-12 h-12 rounded-lg shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-tight truncate">{e.ad}</span>
                <span className="block text-[11px] text-dim truncate mt-0.5">{e.kas}</span>
              </span>
              <span className="text-flame text-xl shrink-0">+</span>
            </button>
          ))}
          {!adaylar.length && <p className="text-center text-sm text-dim py-6">Sonuç yok.</p>}
        </div>
      </Sheet>
    </Sheet>
  )
}

/* ═══ İLK AÇILIŞ SİHİRBAZI ═════════════════════════════════════════════════
   Uygulama kimseye özel değildir; profil, hedef ve program burada kurulur.
   Ayarlar'dan istendiği zaman tekrar çalıştırılabilir. */

/** Bir şablondaki antrenman günü sayısı */
const sablonGunSayisi = (k) => (SABLONLAR[k]?.plan || []).filter((x) => x !== 'dinlenme').length

function KurulumSihirbazi({ db, guncelle, setDb, kapat, ilkKurulum = true }) {
  const p = db.profil
  const [adim, setAdim] = useState(0)
  const [yedekHata, setYedekHata] = useState(null)
  const dosyaRef = useRef(null)

  /* Hazır profil / yedek dosyasından başlama.
     Sıfırdan kuran bir kullanıcının yedeğini geri yüklemek için sihirbazı
     baştan sona geçmesi gerekmemeli. */
  const yedektenBasla = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const okuyucu = new FileReader()
    okuyucu.onload = () => {
      try {
        const d = JSON.parse(okuyucu.result)
        if (!yedekGecerliMi(d)) throw new Error('bozuk')
        const temiz = duzelt(d)
        temiz.profil.kurulumTamam = true   // yedek geldiyse kurulum bitmiş sayılır
        setDb(temiz)
        kapat()
      } catch {
        setYedekHata('Dosya okunamadı. Bu uygulamadan alınmış bir yedek dosyası seç.')
      }
    }
    okuyucu.readAsText(f)
    e.target.value = ''
  }
  const [v, setV] = useState(() => ({
    ad: p.ad || '',
    yas: p.yas || 25,
    boy: p.boy || 175,
    kilo: son([...db.kilolar].sort((a, b) => (a.tarih < b.tarih ? -1 : 1)))?.kg || p.baslangicKilo || 75,
    hedefTip: p.kurulumTamam ? p.hedefTip : 'al',
    hedefKilo: p.hedefKilo || 80,
    hafta: 16,
    sablon: db.ayarlar.sablon || 'ustAlt4',
    barfiksBari: !!db.ayarlar.barfiksBari,
  }))
  const ayarla = (k, deger) => setV((x) => ({ ...x, [k]: deger }))

  // Hedef tipi seçilince makul bir hedef kilo ve program önerisi üret
  const hedefSec = (tip) => {
    const t = HEDEF_TIPLERI[tip]
    const hafta = 16
    const onerilen = tip === 'al' ? v.kilo + t.hizUst * hafta * 0.8
      : tip === 'ver' ? v.kilo + t.hizAlt * hafta * 0.8
      : v.kilo
    setV((x) => ({
      ...x, hedefTip: tip, hafta,
      hedefKilo: Math.round(onerilen * 2) / 2,
      sablon: t.sablon,
    }))
  }

  const kiloHedefiVar = v.hedefTip === 'al' || v.hedefTip === 'ver'
  const haftalikHiz = kiloHedefiVar && v.hafta > 0 ? (v.hedefKilo - v.kilo) / v.hafta : 0

  const ADIMLAR = kiloHedefiVar
    ? ['Merhaba', 'Ölçüler', 'Hedef', 'Hız', 'Program', 'Ekipman']
    : ['Merhaba', 'Ölçüler', 'Hedef', 'Program', 'Ekipman']
  const sonAdim = ADIMLAR.length - 1
  // Kilo hedefi yoksa "Hız" adımı atlanır
  const adimAdi = ADIMLAR[adim]

  const tamamla = () => {
    guncelle((d) => {
      d.profil = {
        ad: v.ad.trim(), yas: Number(v.yas) || 25, boy: Number(v.boy) || 175,
        hedefTip: v.hedefTip,
        baslangicKilo: Number(v.kilo),
        baslangicTarih: bugun(),
        hedefKilo: kiloHedefiVar ? Number(v.hedefKilo) : Number(v.kilo),
        hedefTarih: ekleGun(bugun(), Math.max(1, Number(v.hafta) || 16) * 7),
        kurulumTamam: true,
      }
      const t = HEDEF_TIPLERI[v.hedefTip]
      Object.assign(d.ayarlar, {
        sablon: v.sablon,
        plan: sablondanPlan(v.sablon),
        haftalikHedef: sablonGunSayisi(v.sablon),
        barfiksBari: v.barfiksBari,
        hizAlt: t.hizAlt, hizUst: t.hizUst,
        kiloTakibi: v.hedefTip !== 'yok',
      })
      d.program = sablondanProgram(v.sablon)
      d.beslenmeListesi = JSON.parse(JSON.stringify(BESLENME_VARSAYILAN[v.hedefTip] || BESLENME_VARSAYILAN.koru))
      d.degisim = {}
      // İlk kilo kaydını da oluştur ki grafik hemen başlasın
      if (v.hedefTip !== 'yok' && !d.kilolar.some((k) => k.tarih === bugun())) {
        d.kilolar.push({ tarih: bugun(), kg: Number(v.kilo) })
        d.kilolar.sort((a, b) => (a.tarih < b.tarih ? -1 : 1))
      }
    })
    kapat()
  }

  const SecKart = ({ secili, onClick, baslik, alt, ikon, etiketler }) => (
    <button onClick={onClick}
      className={`w-full text-left p-3.5 rounded-2xl border transition-colors
        ${secili ? 'bg-flame/10 border-flame' : 'bg-slab border-line active:bg-slab2'}`}>
      <div className="flex items-start gap-3">
        {ikon && <span className={`num text-2xl leading-none mt-0.5 shrink-0 ${secili ? 'text-flame' : 'text-dim'}`}>{ikon}</span>}
        <div className="min-w-0 flex-1">
          <div className={`font-semibold text-[15px] ${secili ? 'text-bone' : 'text-ash'}`}>{baslik}</div>
          {alt && <div className="text-[12px] text-dim mt-1 leading-snug">{alt}</div>}
          {etiketler && (
            <div className="flex flex-wrap gap-1 mt-2">
              {etiketler.map((e) => <Rozet key={e} renk={secili ? 'flame' : 'ash'}>{e}</Rozet>)}
            </div>
          )}
        </div>
        <span className={`shrink-0 w-5 h-5 rounded-full border grid place-items-center text-[11px]
          ${secili ? 'bg-flame border-flame text-white' : 'border-line2 text-transparent'}`}>✓</span>
      </div>
    </button>
  )

  return (
    <div className="fixed inset-0 z-[80] bg-coal flex flex-col">
      {/* Üst: ilerleme */}
      <div className="shrink-0 pt-safe px-4 pb-3 border-b border-line/60">
        <div className="flex items-center gap-2 pt-2">
          {adim > 0 ? (
            <button onClick={() => setAdim(adim - 1)}
              className="w-9 h-9 rounded-lg bg-slab2 border border-line text-ash active:bg-line">‹</button>
          ) : <div className="w-9" />}
          <div className="flex-1 flex gap-1">
            {ADIMLAR.map((_, n) => (
              <div key={n} className={`h-1 flex-1 rounded-full ${n <= adim ? 'bg-flame' : 'bg-line2'}`} />
            ))}
          </div>
          {!ilkKurulum ? (
            <button onClick={kapat} className="w-9 h-9 rounded-lg bg-slab2 border border-line text-ash active:bg-line">×</button>
          ) : <div className="w-9" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-lg mx-auto rise" key={adim}>

          {adimAdi === 'Merhaba' && (
            <>
              <div className="text-center mb-6">
                <svg viewBox="0 0 64 34" className="w-24 mx-auto mb-4">
                  <rect x="6" y="14" width="52" height="6" rx="3" fill="#ff4a17" />
                  <rect x="12" y="6" width="9" height="22" rx="3.5" fill="#ff4a17" />
                  <rect x="43" y="6" width="9" height="22" rx="3.5" fill="#ff4a17" />
                  <rect x="2" y="11" width="6" height="12" rx="3" fill="#ff4a17" opacity=".7" />
                  <rect x="56" y="11" width="6" height="12" rx="3" fill="#ff4a17" opacity=".7" />
                </svg>
                <h1 className="text-[30px] leading-none">Demir</h1>
                <p className="text-sm text-ash mt-2 leading-relaxed">
                  Antrenman defterin. Birkaç soruyla programını ve hedefini kuralım —
                  sonra istediğin her şeyi Ayarlar'dan değiştirebilirsin.
                </p>
              </div>
              <Alan etiket="Adın (isteğe bağlı)" type="text" value={v.ad} placeholder="—"
                onChange={(e) => ayarla('ad', e.target.value)} />
              <p className="text-[12px] text-dim mt-4 leading-relaxed">
                Tüm verilerin yalnızca bu cihazda saklanır. Hesap yok, sunucu yok, internet gerekmez.
              </p>

              {/* Hazır profil veya eski yedekle başlama */}
              {ilkKurulum && (
                <div className="mt-7 pt-5 border-t border-line/60">
                  <p className="text-[12.5px] text-ash leading-relaxed mb-3">
                    Elinde hazır bir profil dosyası ya da daha önce aldığın bir yedek varsa
                    kurulumu atlayıp doğrudan onunla başlayabilirsin.
                  </p>
                  <Btn tip="sade" className="w-full" onClick={() => dosyaRef.current?.click()}>
                    ↑ Dosyadan yükle
                  </Btn>
                  <input ref={dosyaRef} type="file" accept="application/json,.json"
                    onChange={yedektenBasla} className="hidden" />
                  {yedekHata && <p className="text-[12px] text-blood mt-2 leading-snug">{yedekHata}</p>}
                </div>
              )}
            </>
          )}

          {adimAdi === 'Ölçüler' && (
            <>
              <h2 className="text-[26px] leading-tight mb-1">Ölçülerin</h2>
              <p className="text-sm text-ash mb-5">Sadece ilerlemeni hesaplamak için kullanılır.</p>
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1 font-semibold">Güncel kilon</div>
                  <Sayac deger={v.kilo} ayarla={(x) => ayarla('kilo', x)} adim={0.5} min={30} max={250} birim="kg" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1 font-semibold">Boy</div>
                    <Sayac deger={v.boy} ayarla={(x) => ayarla('boy', x)} adim={1} min={120} max={230} birim="cm" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1 font-semibold">Yaş</div>
                    <Sayac deger={v.yas} ayarla={(x) => ayarla('yas', x)} adim={1} min={12} max={99} />
                  </div>
                </div>
              </div>
              {(() => {
                const bkiDeger = Number(v.kilo) / Math.pow(Number(v.boy) / 100, 2)
                const yorum = bkiDeger < 18.5 ? 'zayıf' : bkiDeger < 25 ? 'normal' : bkiDeger < 30 ? 'kilolu' : 'obez'
                return (
                  <p className="text-[12px] text-dim mt-4 leading-relaxed">
                    Vücut kitle indeksin <b className="text-ash">{nf(bkiDeger, 1)}</b> ({yorum}).
                    BKİ kas kütlesini ayırt etmez — tek başına karar verme, sadece kaba bir referans.
                  </p>
                )
              })()}
            </>
          )}

          {adimAdi === 'Hedef' && (
            <>
              <h2 className="text-[26px] leading-tight mb-1">Hedefin ne?</h2>
              <p className="text-sm text-ash mb-5">
                Uygulamanın uyarıları, grafikleri ve önerdiği program buna göre değişir.
              </p>
              <div className="space-y-2.5">
                {Object.entries(HEDEF_TIPLERI).map(([k, t]) => (
                  <SecKart key={k} secili={v.hedefTip === k} onClick={() => hedefSec(k)}
                    baslik={t.ad} alt={t.alt} ikon={t.ikon} />
                ))}
              </div>
            </>
          )}

          {adimAdi === 'Hız' && (
            <>
              <h2 className="text-[26px] leading-tight mb-1">Hedef kilo ve süre</h2>
              <p className="text-sm text-ash mb-5">
                Acele etmek işe yaramaz: çok hızlı alırsan yağlanırsın, çok hızlı verirsen kas kaybedersin.
              </p>
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1 font-semibold">Hedef kilo</div>
                  <Sayac deger={v.hedefKilo} ayarla={(x) => ayarla('hedefKilo', x)} adim={0.5} min={30} max={250} birim="kg" />
                </div>
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim font-semibold">Süre</span>
                    <span className="num text-flame">{v.hafta} hafta</span>
                  </div>
                  <input type="range" min="4" max="52" step="1" value={v.hafta}
                    onChange={(e) => ayarla('hafta', Number(e.target.value))}
                    className="w-full accent-[#ff4a17] h-2" />
                  <div className="flex justify-between text-[11px] text-dim mt-1">
                    <span>1 ay</span><span>1 yıl</span>
                  </div>
                </div>
              </div>
              {(() => {
                const t = HEDEF_TIPLERI[v.hedefTip]
                const cokHizli = v.hedefTip === 'al' ? haftalikHiz > t.hizUst + 0.2 : haftalikHiz < t.hizAlt - 0.2
                const cokYavas = Math.abs(haftalikHiz) < 0.08
                const tersYon = (v.hedefTip === 'al' && haftalikHiz < 0) || (v.hedefTip === 'ver' && haftalikHiz > 0)
                return (
                  <Kart className={`p-3.5 mt-5 ${cokHizli || tersYon ? 'border-gold/40 bg-gold/[0.07]' : 'border-jade/30 bg-jade/[0.05]'}`}>
                    <div className="text-[13.5px] font-semibold">
                      Haftada <span className="num">{nfSigned(haftalikHiz, 2)} kg</span>
                    </div>
                    <div className="text-[12px] text-ash mt-1 leading-relaxed">
                      {tersYon ? 'Hedef kilon mevcut kilonun ters yönünde. Hedefini gözden geçir.'
                        : cokHizli ? (v.hedefTip === 'al'
                          ? 'Bu hız yeni başlayan için agresif — alınanın büyük kısmı yağ olabilir. Süreyi uzatmayı düşün.'
                          : 'Bu hızda kaybın önemli kısmı kas olur. Süreyi uzatmanı öneririm.')
                        : cokYavas ? 'Bu hız çok yavaş; fark etmesi aylar alır.'
                        : `Sağlıklı aralıkta (${nfSigned(t.hizAlt, 2)} … ${nfSigned(t.hizUst, 2)} kg/hafta).`}
                    </div>
                  </Kart>
                )
              })()}
            </>
          )}

          {adimAdi === 'Program' && (
            <>
              <h2 className="text-[26px] leading-tight mb-1">Program</h2>
              <p className="text-sm text-ash mb-5">
                Hedefine uygun olanı seçtim, ama istediğini seçebilirsin. Hareketleri ve günleri
                sonradan tek tek değiştirebilirsin.
              </p>
              <div className="space-y-2.5">
                {Object.entries(SABLONLAR).map(([k, s]) => (
                  <SecKart key={k} secili={v.sablon === k} onClick={() => ayarla('sablon', k)}
                    baslik={s.ad} alt={s.aciklama} etiketler={s.etiket} />
                ))}
              </div>
            </>
          )}

          {adimAdi === 'Ekipman' && (
            <>
              <h2 className="text-[26px] leading-tight mb-1">Ekipmanın</h2>
              <p className="text-sm text-ash mb-5">
                Olmayan aletin hareketleri otomatik olarak alternatifiyle değiştirilir.
                Sonradan Ayarlar'dan değiştirebilirsin.
              </p>
              <Kart className="px-3.5">
                <Anahtar acik={v.barfiksBari} degistir={(x) => ayarla('barfiksBari', x)}
                  etiket="Barfiks (çekme) barım var"
                  alt={v.barfiksBari
                    ? 'Barfiks ve negatif barfiks programda görünecek.'
                    : 'Barfiks gerektiren hareketler Dar Tutuş Lat Pulldown ile değiştirilecek.'} />
              </Kart>

              <Kart className="p-3.5 mt-4">
                <div className="text-[13px] font-semibold mb-2">Özet</div>
                <div className="space-y-1.5 text-[12.5px] text-ash">
                  <div className="flex justify-between gap-3"><span className="text-dim">Hedef</span>
                    <span className="text-right">{HEDEF_TIPLERI[v.hedefTip].ad}</span></div>
                  {kiloHedefiVar && (
                    <div className="flex justify-between gap-3"><span className="text-dim">Kilo</span>
                      <span className="num text-right">{nf(v.kilo, 1)} → {nf(v.hedefKilo, 1)} kg · {v.hafta} hafta</span></div>
                  )}
                  <div className="flex justify-between gap-3"><span className="text-dim">Program</span>
                    <span className="text-right">{SABLONLAR[v.sablon].ad}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-dim">Haftalık</span>
                    <span className="num text-right">{sablonGunSayisi(v.sablon)} antrenman</span></div>
                </div>
              </Kart>
              {!ilkKurulum && (
                <p className="text-[12px] text-gold mt-4 leading-relaxed">
                  Not: Kurulumu tamamlamak programı ve beslenme listesini seçtiğin şablona göre
                  sıfırlar. Antrenman geçmişin ve kilo kayıtların korunur.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Alt: ilerle */}
      <div className="shrink-0 px-4 pb-safe pt-3 border-t border-line/60 bg-slab/40">
        <div className="max-w-lg mx-auto">
          {adim < sonAdim ? (
            <Btn tip="ana" className="w-full !min-h-[54px] !text-base" onClick={() => setAdim(adim + 1)}>
              Devam →
            </Btn>
          ) : (
            <Btn tip="ana" className="w-full !min-h-[54px] !text-base" onClick={tamamla}>
              {ilkKurulum ? 'Hadi başlayalım ✓' : 'Kaydet ✓'}
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══ 8) KÖK BİLEŞEN ═══════════════════════════════════════════════════════ */

const SEKMELER = [
  { k: 'bugun', ad: 'Bugün', ikon: 'M3 10.5 12 3l9 7.5V21H3z' },
  { k: 'gecmis', ad: 'Geçmiş', ikon: 'M4 5h16v16H4zM4 9h16M9 3v4M15 3v4' },
  { k: 'ilerleme', ad: 'İlerleme', ikon: 'M4 19V9M10 19V5M16 19v-7M22 19H2' },
  { k: 'ayarlar', ad: 'Ayarlar', ikon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 12h2M19 12h2M12 3v2M12 19v2' },
]

export default function App() {
  const [db, guncelle, setDb] = useStore()
  const [sekme, setSekme] = useState('bugun')
  const [ozet, setOzet] = useState(null)
  const [kurulumAcik, setKurulumAcik] = useState(false)
  const kurulumGerekli = !db.profil.kurulumTamam

  /* Antrenman başlat: hareketleri kur, geçen seferki değerlerle doldur */
  const baslat = (planKey) => {
    guncelle((d) => {
      const p = d.program[planKey]
      if (!p) return
      d.aktif = {
        id: uid(), tarih: bugun(), planKey, basladi: Date.now(), aktifIndex: 0,
        kayitlar: p.hareketler.map((h) => {
          const exId = cozExId(d, h.exId)
          const gecen = sonKayit(d, exId)
          const gecenSetler = gecen?.setler.filter((s) => s.bitti) || []
          return {
            exId, asilId: h.exId, plan: { ...h }, not: '',
            // Geçen seferki aynı sıradaki set; yoksa son set; o da yoksa plandaki hedef
            setler: Array.from({ length: h.set }, (_, si) =>
              setVarsayilani(EX[exId], h, gecenSetler[si] || son(gecenSetler))),
          }
        }),
      }
    })
  }

  /* Antrenmanı bitir: en az bir set tamamlandıysa kaydet */
  const bitir = () => {
    const s = db.aktif
    if (!s) return
    const doluMu = s.kayitlar.some((k) => k.setler.some((x) => x.bitti))
    const tamam = { ...s, bitti: Date.now(), sure: Math.round((Date.now() - s.basladi) / 1000) }
    delete tamam.dinlenmeBitis
    delete tamam.dinlenmeToplam
    guncelle((d) => {
      if (doluMu) {
        // Sadece tamamlanan setleri sakla
        tamam.kayitlar = tamam.kayitlar.map((k) => ({ ...k, setler: k.setler.filter((x) => x.bitti) }))
          .filter((k) => k.setler.length || k.not)
        d.antrenmanlar.push(tamam)
        d.antrenmanlar.sort((a, b) => (a.tarih < b.tarih ? -1 : a.tarih > b.tarih ? 1 : a.basladi - b.basladi))
        d.rekorlar = rekorlariHesapla(d.antrenmanlar)
      }
      d.aktif = null
    })
    if (doluMu) setOzet(tamam)
  }

  const vazgec = () => guncelle((d) => { d.aktif = null })

  /* Android geri tuşu: önce açık panelleri kapat, sonra Bugün sekmesine dön,
     en son uygulamadan çık. Antrenman sürerken kazara çıkışı engeller.
     Java tarafı bu fonksiyonu çağırıp dönen değere göre davranır. */
  const aktifVar = !!db.aktif
  useEffect(() => {
    window.__geriTusu = () => {
      if (GERI_YIGINI.length) { GERI_YIGINI[GERI_YIGINI.length - 1](); return 'kapatildi' }
      if (aktifVar) return 'antrenman'
      if (sekme !== 'bugun') { setSekme('bugun'); return 'kapatildi' }
      return 'cikis'
    }
    return () => { delete window.__geriTusu }
  }, [aktifVar, sekme])

  return (
    <div className="min-h-dvh bg-coal text-bone grain">
      {/* Üst kenarda ince turuncu çizgi — uygulamaya "ekipman etiketi" hissi verir */}
      <div className="fixed inset-x-0 top-0 h-[3px] bg-gradient-to-r from-flame via-flame2 to-flame/20 z-20" />

      <main className="max-w-lg mx-auto pt-safe pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <div className="pt-2">
          {sekme === 'bugun' && <BugunEkrani db={db} guncelle={guncelle} baslat={baslat} />}
          {sekme === 'gecmis' && <GecmisEkrani db={db} guncelle={guncelle} />}
          {sekme === 'ilerleme' && <IlerlemeEkrani db={db} guncelle={guncelle} setDb={setDb} />}
          {sekme === 'ayarlar' && (
            <AyarlarEkrani db={db} guncelle={guncelle} setDb={setDb}
              kurulumuAc={() => setKurulumAcik(true)} />
          )}
        </div>
      </main>

      {/* ---- Devam eden antrenman şeridi ---- */}
      {db.aktif && (
        <button onClick={() => setSekme('bugun')}
          className="fixed inset-x-0 z-30 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] px-3">
          <span className="max-w-lg mx-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl
            bg-flame text-white shadow-[0_8px_24px_-8px_rgba(255,74,23,.8)]">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-[13.5px] font-semibold flex-1 text-left">Antrenman devam ediyor</span>
            <span className="text-[13px] font-semibold">Devam et →</span>
          </span>
        </button>
      )}

      {/* ---- Alt menü ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 bg-coal/95 backdrop-blur-md border-t border-line pb-safe">
        <div className="max-w-lg mx-auto flex">
          {SEKMELER.map((s) => {
            const aktif = sekme === s.k
            return (
              <button key={s.k} onClick={() => setSekme(s.k)}
                className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-1
                  transition-colors ${aktif ? 'text-flame' : 'text-dim active:text-ash'}`}>
                <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="none"
                  stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d={s.ikon} />
                </svg>
                <span className={`text-[10.5px] font-semibold tracking-wide ${aktif ? '' : 'opacity-90'}`}>{s.ad}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ---- Aktif antrenman tam ekran ---- */}
      {db.aktif && <AntrenmanEkrani db={db} guncelle={guncelle} bitir={bitir} vazgec={vazgec} />}

      {/* ---- Antrenman özeti ---- */}
      <OzetPaneli acik={!!ozet} kapat={() => setOzet(null)} seans={ozet} db={db} />

      {/* ---- İlk açılış sihirbazı (veya Ayarlar'dan tekrar çalıştırma) ---- */}
      {(kurulumGerekli || kurulumAcik) && (
        <KurulumSihirbazi db={db} guncelle={guncelle} setDb={setDb} ilkKurulum={kurulumGerekli}
          kapat={() => setKurulumAcik(false)} />
      )}
    </div>
  )
}
