# Demir APK derleyicisi.
# Skill'in build-apk.ps1'i kaynak (res/) ve varlik (assets/) paketlemedigi icin
# ayni arac zinciriyle calisan bu betik kullanilir.
#
# Boru hatti:
#   aapt2 compile (res) -> aapt2 link (manifest+res) -> javac -> d8
#   -> dex'i apk'ye ekle -> web varliklarini apk'ye ekle -> zipalign -> apksigner
param([string] $OutName = "Demir")

# DIKKAT: Windows PowerShell 5.1'de $ErrorActionPreference="Stop" iken native bir
# exe'nin stderr'e yazmasi (ornegin javac'in zararsiz "deprecated API" notu)
# NativeCommandError'a donusup derlemeyi durdurur. Bu yuzden tercih "Continue"
# birakilir ve her adim $LASTEXITCODE ile acikca kontrol edilir.
$ErrorActionPreference = "Continue"

function Dogrula([string] $Adim) {
    if ($LASTEXITCODE -ne 0) { throw "$Adim basarisiz (cikis kodu=$LASTEXITCODE)" }
}

$Proje  = $PSScriptRoot
$Web    = Join-Path (Split-Path $Proje -Parent) "dist"
$Tools  = Join-Path $env:USERPROFILE ".android-apk-tools"
$Sdk    = Join-Path $Tools "android-sdk"
$bt     = "$Sdk\build-tools\35.0.1"
$androidJar = "$Sdk\platforms\android-35\android.jar"
$ks     = "$Tools\debug.keystore"

$jdk = (Get-ChildItem "$Tools\jdk" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $jdk) { throw "JDK bulunamadi. Once setup-toolchain.ps1 calistir." }
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"
$javac  = "$jdk\bin\javac.exe"
$jarExe = "$jdk\bin\jar.exe"

if (-not (Test-Path $Web)) { throw "dist/ yok. Once npm run build calistir." }

$app = Join-Path $Proje "app"
$out = Join-Path $Proje "out"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force "$out\classes", "$out\dex" | Out-Null

# ---------------------------------------------------------------------------
Write-Host "[1/8] web varliklari hazirlaniyor..."
# NOT: aapt2'nin -A (assets) secenegi Windows'ta girdi adlarini ters bolu ile
# yazar ("assets/web\assets\index.js"); AssetManager bunlari bulamaz ve uygulama
# bos ekran acilir. Bu yuzden varliklar aapt2'ye verilmez; asagida jar ile
# eklenir (jar ayiraci daima ileri boluye cevirir).
$stage = Join-Path $out "stage\assets\web"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$Web\*" $stage -Recurse -Force
# Service worker APK icinde gereksiz (dosyalar zaten yerelde) - paketleme
Remove-Item (Join-Path $stage "sw.js") -Force -ErrorAction SilentlyContinue
Write-Host ("      {0} dosya" -f (Get-ChildItem $stage -Recurse -File).Count)

# ---------------------------------------------------------------------------
Write-Host "[2/8] aapt2 compile (ikon kaynaklari)..."
& "$bt\aapt2.exe" compile --dir (Join-Path $app "res") -o "$out\res.zip"
Dogrula "aapt2 compile"

Write-Host "[3/8] aapt2 link (manifest + kaynak)..."
& "$bt\aapt2.exe" link -o "$out\base.apk" -I $androidJar `
    --manifest (Join-Path $app "AndroidManifest.xml") `
    --auto-add-overlay "$out\res.zip"
Dogrula "aapt2 link"

Write-Host "[4/8] javac..."
$javaFiles = Get-ChildItem (Join-Path $app "src") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
if (-not $javaFiles) { throw "Derlenecek .java bulunamadi" }
& $javac -encoding UTF-8 -source 1.8 -target 1.8 -nowarn `
    -bootclasspath $androidJar -classpath $androidJar -d "$out\classes" $javaFiles
Dogrula "javac"

Write-Host "[5/8] d8 (class -> dex)..."
$classes = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$bt\d8.bat" --release --lib $androidJar --min-api 21 --output "$out\dex" $classes
Dogrula "d8"

Write-Host "[6/8] dex + web varliklari apk'ye ekleniyor..."
Copy-Item "$out\base.apk" "$out\unsigned.apk" -Force
Push-Location "$out\dex"
& $jarExe uf "$out\unsigned.apk" "classes.dex"
$je = $LASTEXITCODE
Pop-Location
if ($je -ne 0) { throw "dex ekleme basarisiz (cikis=$je)" }

Push-Location "$out\stage"
& $jarExe ufM "$out\unsigned.apk" "assets"     # M: jar kendi MANIFEST'ini eklemesin
$je = $LASTEXITCODE
Pop-Location
if ($je -ne 0) { throw "varlik ekleme basarisiz (cikis=$je)" }

# Dogrulama: girdi adlarinda ters bolu kalmamali, varliklar yerinde olmali
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
$zip = [System.IO.Compression.ZipFile]::OpenRead("$out\unsigned.apk")
$bozuk    = @($zip.Entries | Where-Object { $_.FullName -like "*\*" })
$varlik   = @($zip.Entries | Where-Object { $_.FullName -like "assets/web/*" -and -not $_.FullName.EndsWith("/") })
$indexVar = @($zip.Entries | Where-Object { $_.FullName -eq "assets/web/index.html" }).Count -eq 1
$zip.Dispose()
if ($bozuk.Count -gt 0) { throw "APK icinde ters bolulu girdi var: $($bozuk[0].FullName)" }
if (-not $indexVar)     { throw "assets/web/index.html APK icinde bulunamadi" }
Write-Host "      $($varlik.Count) varlik, yol adlari temiz, index.html yerinde"

Write-Host "[7/8] zipalign..."
& "$bt\zipalign.exe" -p -f 4 "$out\unsigned.apk" "$out\aligned.apk"
Dogrula "zipalign"

Write-Host "[8/8] apksigner imzalama..."
$apk = Join-Path $Proje "$OutName.apk"
if (Test-Path $apk) { Remove-Item $apk -Force }
& "$bt\apksigner.bat" sign --ks $ks --ks-pass pass:android --key-pass pass:android `
    --min-sdk-version 21 --out $apk "$out\aligned.apk"
Dogrula "apksigner"

& "$bt\apksigner.bat" verify $apk | Out-Null
$imzaOk = $LASTEXITCODE -eq 0

Write-Host ""
Write-Host "=== BITTI ==="
Write-Host ("APK  : $apk")
Write-Host ("Boyut: {0:N1} MB   imza_dogrulandi={1}" -f ((Get-Item $apk).Length/1MB), $imzaOk)
Write-Host "--- izinler (aapt2 ile okunabiliyorsa arsiv saglam demektir) ---"
& "$bt\aapt2.exe" dump permissions $apk
Dogrula "aapt2 dump (arsiv butunlugu)"
