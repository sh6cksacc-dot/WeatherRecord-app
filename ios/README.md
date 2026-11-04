# iOS 原版源码

打开 `WeatherRecord.xcodeproj`，选择 WeatherRecord scheme。
本目录包含 SwiftUI/WKWebView 界面、Spotify App Remote 桥接、原生天气、
AtmosRank、歌曲主观评分、队列和歌词服务，以及当前网页资源。

1. 从 Spotify 官方 https://github.com/spotify/ios-sdk/releases 获取 SDK。
2. 将 `SpotifyiOS.xcframework` 加入 Target 的 Frameworks, Libraries, and
   Embedded Content，设为 **Embed & Sign**。二进制不随本仓库分发。
3. 在 `Info.plist` 的 `SPOTIFY_CLIENT_ID` 中填写自己的 Spotify Client ID。
4. 在 Signing & Capabilities 选择自己的 Team 和唯一 Bundle Identifier。
5. 在 Spotify Dashboard 登记该 Bundle Identifier，以及
   `weatherrecord://spotify-login-callback` 回调，启用 iOS 和 Web API。
6. 在真机安装 Spotify 并登录，连接手机后选择设备运行。

没有 SDK 时使用源码里的明确错误提示分支，可验证工程和资源编译，但不能播放。
CI 的无签名模拟器构建验证的也是该分支，不代表真机 Spotify 播放验收。
SDK 加入后会自动通过 `canImport(SpotifyiOS)` 使用完整原生桥接。

仓库不包含开发者签名、用户令牌、个人评分记录和原始本地标签库。
`Recommendation/track-features.json` 初始为空；算法支持安全降级及后续用户评分。
图标使用仓库内的线条 SVG 作为启动展示，可在 Xcode 自行配置 AppIcon。

歌词优先匹配相同演唱者、标题和时长。不同现场、混音或剪辑版本不会被当作
同一首歌的同步歌词，找不到可靠版本时显示暂无同步歌词。
