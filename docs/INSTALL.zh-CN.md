# Weather Record 0.1.0-beta.1 测试版

## 下载哪个文件

- Android：`WeatherRecord-Android-test.apk`，Android 8.0 及以上。
- Windows：`WeatherRecord-Windows-x64.exe`，Windows x64；无需额外安装 .NET。
- iOS：使用 Release 自动附带的 Source code，按 `ios/README.md` 在 Xcode 中自行签名安装；此版本不提供可供任意 iPhone 直接安装的 IPA。
- `SHA256SUMS.txt`：下载文件的 SHA-256 校验值。

## 连接 Spotify

1. 在 https://developer.spotify.com/dashboard 创建自己的 Spotify 应用。
2. 为 Android/Windows 配置 Web API，并登记精确回调地址 `http://127.0.0.1:5500/`。
3. 启动 Weather Record，点击连接 Spotify，填写该应用的公开 Client ID。
4. 完成浏览器授权。在 Spotify 中播放任意歌曲，使账号有可控制的设备，再返回本应用选歌。

不需要 Client Secret。开发模式的 Spotify 应用受账号访问限制；不同使用者不能因为下载了安装包就自动取得开发者 Spotify 应用的访问权。
播放控制需要 Spotify Premium、网络连接和活跃的 Spotify Connect 设备。
音乐声音由 Spotify 输出，不由此 APK/EXE 解码。

## Android

APK 为 debug 签名的个人测试包，不是应用商店正式版本。
如系统询问安装来源，仅在核实下载来自本仓库后允许这次安装。
不同构建环境的 debug 签名可能不同，不能保证覆盖安装之前的测试包；
不要为强行更新而直接删除旧应用，先备份重要计划和评分。
天气定位允许后，可能需要重启一次应用。

## Windows

双击 EXE 后，默认浏览器会打开本地界面。请保持控制台窗口运行；关闭它会停止本地服务。
端口 5500 必须空闲。此 EXE 没有商业代码签名，Windows 可能显示未知发布者。

## 已知范围

Android 和 Windows 为跨平台初版：原生 AtmosRank 桥接、评分、队列和 Pitchfork 服务尚未全部移植。
健身计划可以编辑，但严格的健身歌曲筛选暂不可用，请使用日常模式播放。
源代码包含功能更完整的原版 iOS App，Spotify SDK 二进制、个人凭据、签名和个人标签库不随仓库分发。

本次产物来自已通过 Android、Windows 构建及 iOS 无签名源码构建的提交。
构建成功不代表 Android、Windows 真机播放已验收；此 Release 明确标记为预发布测试版。
