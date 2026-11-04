# Weather Record 跨平台测试版安装说明

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

从 0.2 升级 Android 后请重新连接一次 Spotify，授予私人歌单的创建和读取权限。
App 会创建/复用 `Weather Record · Atmos Session` 私人歌单，按 AtmosRank 排序；只管理自己的歌单，不会覆盖其他歌单。

不需要 Client Secret。开发模式的 Spotify 应用受账号访问限制；不同使用者不能因为下载了安装包就自动取得开发者 Spotify 应用的访问权。
播放控制需要 Spotify Premium、网络连接和活跃的 Spotify Connect 设备。
音乐声音由 Spotify 输出，不由此 APK/EXE 解码。

## Android

APK 为 debug 签名的个人测试包，不是应用商店正式版本。
如系统询问安装来源，仅在核实下载来自本仓库后允许这次安装。
不同构建环境的 debug 签名可能不同，不能保证覆盖安装之前的测试包；
不要为强行更新而直接删除旧应用，先备份重要计划和评分。
首次允许天气定位后会继续查询，无需为授权重启应用。

## Windows

双击 EXE 后，默认浏览器会打开本地界面。推荐算法、Token 刷新和队列维护运行在 C# 进程中。
可以关闭网页或让浏览器休眠；请保持 EXE 的控制台窗口运行。关闭 EXE、电脑睡眠或断网会停止后台补歌。
登录凭据通过 Windows 当前用户 DPAPI 加密保存在本机，播放计划和评分也在本机保存。
端口 5500 必须空闲。此 EXE 没有商业代码签名，Windows 可能显示未知发布者。

## 已知范围

Android 和 Windows 已移植 AtmosRank 天气/时间推荐、500 张专辑元数据标签、六维主观评分、健身强律动筛选、同步歌词录音匹配、Pitchfork 短简介与可用的中文翻译。
评分仅针对已确认收藏、连续实际播放满 15 秒的歌曲触发；暂停、跳进度不会凑满时间。
用户评分、训练计划和播放历史保存在本机。专辑标签是低置信度元数据估计，不是 Spotify 音频分析结果。

Windows 使用原生服务持续核对和补充六首队列，支持恢复和防重复；Android 改用最多 30 首一批的私人歌单。
Android 锁屏后由 Spotify 接续已生成歌单，回到前台后可追加下一批；单个会话最多 300 首，小歌库可能少于 30 首。歌单耗尽后 Spotify 自身的自动播放设置可能接管，不保证无限后台生成。
其他来源的队列不会被清空；旧队列冲突时会提示在 Spotify 中处理。暂停后续播保留进度；主动选择另一首时，从那首的开头播放。
天气、歌词、简介和翻译依赖网络与第三方服务。没有位置权限、Spotify 活跃设备或足够的强律动候选时，会显示对应提示。
源代码保留原版 iOS App，未改变其登录和播放架构；Spotify SDK 二进制、个人凭据、签名及个人评分不随仓库分发。

编译及自动测试不代表 Android、Windows 的真实账号播放和长期锁屏行为已经验收；请按测试版使用。
