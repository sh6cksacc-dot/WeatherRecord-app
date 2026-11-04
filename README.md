# Weather Record / 气象唱片

## 中文简介

**气象唱片（Weather Record）** 是一款围绕天气、时间与音乐氛围设计的 Spotify 音乐发现应用。
让每个当下，都有一张适合聆听的唱片。

- **整张专辑探索**：从 Spotify 目录中按随机年份和分页发现专辑，减少固定清单带来的重复。
- **我的喜欢**：结合 AtmosRank、天气、时间及六维主观评分进行推荐，控制近期重复和连续艺人。
- **沉浸式界面**：极简封面播放器、同步歌词、横屏分栏、滑动切歌，以及可保存的左右换边设置。
- **健身模式**：设置每周训练计划、记录动作完成情况，并从喜欢歌曲中筛选强律动候选。
- **连续播放与简介**：Windows 原生后台维护推荐队列；Android 使用算法生成的私人歌单。专辑模式显示 Pitchfork 短评及可用的中文翻译。
- **多端支持**：提供 iOS 源码、Android 测试 APK 和 Windows 一键启动 EXE。

**版本说明**：Android/Windows 已接入推荐、评分、健身筛选、队列和简介服务，仍为测试版；平台限制与验证范围见下文。
首次使用需要配置自己的 Spotify Client ID，远程播放需要 Spotify Premium 和活跃的播放设备。
iOS 需要在 Xcode 中自行签名安装。项目源码采用 MIT 许可证，音乐、歌词等第三方内容保留各自权利。

[下载测试版](https://github.com/sh6cksacc-dot/WeatherRecord-app/releases) · [中文安装说明](docs/INSTALL.zh-CN.md) · [iOS 配置说明](ios/README.md)

## English overview

Weather, time and music discovery. Android APK and a Windows one-click EXE launcher,
sharing the existing minimalist interface, portrait/landscape layouts, lyrics,
album discovery, Liked Songs, swipe history and local workout plans.

The original **SwiftUI iOS app** is now included under [`ios/`](ios/README.md).
It retains the native App Remote, AtmosRank, rating and queue integration. Open
`ios/WeatherRecord.xcodeproj`, supply your own Client ID/signing, and add Spotify's
official iOS SDK as described in the iOS README. SDK binaries and personal data
are excluded; the bundled local tag file starts empty.

## Status

This is the first cross-platform port, not a feature-identical replacement for the
iOS App Remote application. Both ports control an active Spotify Connect device.
The Windows EXE opens the interface in the default browser and keeps a small local
server running; it is not an embedded desktop window. Audio plays through Spotify.
The Android APK uses an Android System WebView and opens the system browser for OAuth.

The portable service layer now implements AtmosRank weather/time rules, stable
weighted sampling, recent/skip history, six-axis subjective ratings and workout
filtering. Windows moves recommendation, OAuth refresh and queue maintenance into
the C# process, independently of browser timers. Android creates/reuses one private
Atmos playlist, starts playback at the selected position and appends future batches
while foregrounded. The same plan supplies swipe candidates and playback order.
`web/atmos-rank.js` mirrors the Swift reference formulas. `web/track-features.json`
contains 500 public Wikipedia-backed, low-confidence album metadata estimates;
these are not audio measurements. Personal ratings and history stay on the device.
Unknown songs remain unknown; workout selection can use the existing low-confidence
artist priors until the user has rated enough tracks.

Lyrics use recording/title/artist/duration validation with bounded retries.
Pitchfork search and optional Chinese translation use fixed-endpoint local host
routes to avoid browser CORS restrictions. Service failures show an explicit
unavailable message; no review or translation is fabricated.

### Platform limits / 平台限制

- Audio still plays through an active Spotify Connect device with Premium.
  The ports do not include an in-app Spotify audio decoder or iOS App Remote.
- Windows continues queue maintenance while its EXE runs, even if the browser is
  closed or sleeping. Closing the EXE, computer sleep or loss of network stops it.
  OAuth refresh tokens are persisted with Windows current-user DPAPI encryption.
- Android generates up to 30 unique tracks per batch and appends when eight or
  fewer remain while foregrounded (bounded to 300 tracks per session). Spotify can
  play the generated playlist while Weather Record is suspended. An exhausted
  playlist still needs the app foregrounded for fresh recommendations; Spotify's
  own autoplay setting may take over at the end. No endless background refill is
  claimed. Small libraries can produce shorter batches.
- Existing external queue entries are preserved. Spotify offers no queue-clear or
  arbitrary queue-reorder endpoint; conflicting order is reported rather than
  silently deleting another app's entries.
- Saved-track membership must be confirmed in the cached Liked Songs API results
  before a rating prompt. The original 15 seconds of real playing time, pause,
  skip, later and never-ask rules are reused.
- Location, Pitchfork, translation and lyrics depend on network/service availability.
  Desktop weather requires location support and permission in the selected browser.
- These builds pass automated tests and compilation; Android/Windows Spotify
  account playback and long-running lock-screen behavior still need device testing.

## First launch

1. Create a Spotify Developer app: https://developer.spotify.com/dashboard .
2. Register **exactly** `http://127.0.0.1:5500/` as a redirect URI. Enable Web API.
3. Start Weather Record, press Connect Spotify and enter your own public Client ID.
   No client secret is needed. OAuth uses PKCE and state verification.
4. Sign in using an account allowed by your Spotify app's development mode.
5. Open Spotify on the same account and play any song once. Then return to Weather Record.
   Spotify must have an active, controllable playback device. Premium is required
   by Spotify's remote playback APIs.

Port 5500 must be free. Tokens and settings stay in local app/browser storage;
use a dedicated browser profile on shared computers. Internet access is needed.
On Android, grant location permission when asked; weather continues after granting it.
Existing Android users must reconnect once to grant `playlist-modify-private` and
`playlist-read-private`. The dedicated private playlist is managed by the app;
other user playlists are never modified. Ambiguous playlist creation/writes are
reconciled before retry, rather than creating duplicates.
The app must remain running during OAuth; Android background process termination
can interrupt authorization. No background service or full offline mode is provided.

## Downloads / build

GitHub Actions → **Build Android and Windows** → latest successful run → Artifacts.
The Android artifact is a **debug-signed test APK**, suitable for personal testing,
not a production signing identity. The Windows artifact is a self-contained,
unsigned x64 EXE; Windows may show an unknown-publisher notice.

Local builds:

```sh
# Android: JDK 17, Android SDK 35, Gradle 8.9
gradle --no-daemon -p android assembleDebug
# Windows: .NET SDK 8
dotnet publish windows/WeatherRecord.csproj -c Release -r win-x64 -o dist/windows
```

The EXE embeds all web assets and needs no separately installed .NET runtime.
Close its console window to stop the local server. Android requires Android 8+.

## Project layout

`ios/`: original SwiftUI app, native services and unmodified iOS web interface.
`web/`: exported UI plus the Spotify Connect/PKCE adapter.
`web/portable-services.js`: rating/history/context/lyrics/review service bridge.
`web/portable-session.js`: Android private playlist and Windows plan bridge.
`web/atmos-rank.js`: independent portable recommendation engine.
`tests/`: Node integration tests (`node --test tests/portable.test.cjs`).
`tests/native/`: dependency-free native queue tests (`dotnet run --project tests/native/NativeTests.csproj`).
`windows/NativeQueueService.cs`: serialized native Spotify transport and background queue.
`windows/AtmosEngine.cs`: C# AtmosRank used when browser scripts are suspended.
`android/`: native Android WebView host and loopback callback server.
`windows/`: .NET local server/browser launcher.
`.github/workflows/`: independent Android and Windows artifact builds.

Catalog discovery samples random years and pages. Spotify search pagination is
limited, so this is broad discovery rather than uniform sampling of every album.
Unknown musical features are not replaced with invented mood scores.

## Attribution

Weather data by [Open-Meteo](https://open-meteo.com/). Lyrics via
[LRCLIB](https://lrclib.net/). See `THIRD_PARTY_NOTICES.md`.

MIT license for project source; third-party content retains its own rights.
