# Weather Record / 气象唱片

## 中文简介

**气象唱片（Weather Record）** 是一款围绕天气、时间与音乐氛围设计的 Spotify 音乐发现应用。让每个当下，都有一张适合聆听的唱片。

- **整张专辑探索**：从 Spotify 目录中按随机年份和分页发现专辑，减少固定清单带来的重复。
- **我的喜欢**：随机聆听收藏歌曲；iOS 原版结合 AtmosRank、天气、时间及用户评分进行推荐。
- **沉浸式界面**：极简封面播放器、同步歌词、横屏分栏、滑动切歌及可保存的左右换边设置。
- **健身模式**：设置每周训练计划、记录动作完成情况；iOS 原版支持强律动歌曲筛选。
- **多端支持**：提供 iOS 源码、Android 测试 APK 和 Windows 一键启动 EXE。

**版本说明**：iOS 是功能更完整的原版；Android/Windows 目前为跨平台测试版，部分原生推荐、评分和队列功能尚未移植。首次使用需要配置自己的 Spotify Client ID，远程播放需要 Spotify Premium 和活跃的播放设备。iOS 需要在 Xcode 中自行签名安装。项目源码采用 MIT 许可证，第三方内容保留各自权利。

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

The original native AtmosRank engine is included as Swift reference source in
`reference/Recommendation`. Its native ranking bridge, subjective rating modal,
native queue writer and native review service have **not** been ported. The port uses
the existing web recommendation fallback. Workout plan editing works, but strict
high-groove workout selection needs the future portable ranker; until then the
workout music filter is unavailable and the app shows an explanatory message.

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
On Android, grant location permission and restart the app to refresh weather.
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
