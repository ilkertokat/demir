import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker: uygulamayı çevrimdışı çalışır hale getirir.
// (Sadece http/https üzerinden çalışır; dosyayı file:// ile açarsan atlanır.
//  Android uygulamasının içinde dosyalar zaten APK'nin içinden okunur, gerekmez.)
// Android kabuğu iki şekilde anlaşılır: sahte varlık origin'i veya JS köprüsü
const APK_ICINDE = location.hostname === 'appassets.androidplatform.net' || !!window.Android
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !APK_ICINDE) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
