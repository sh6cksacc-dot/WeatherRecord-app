import Foundation
import Combine
import AuthenticationServices
import CryptoKit
import UIKit
import Security
import AVFoundation

#if canImport(SpotifyiOS)
import SpotifyiOS

final class SpotifyBridge: NSObject, ObservableObject, SPTAppRemoteDelegate, SPTAppRemotePlayerStateDelegate, ASWebAuthenticationPresentationContextProviding {
    private let clientID = Bundle.main.object(forInfoDictionaryKey: "SPOTIFY_CLIENT_ID") as? String ?? ""
    private let redirectURL = URL(string: "weatherrecord://spotify-login-callback")!
    private lazy var configuration = SPTConfiguration(clientID: clientID, redirectURL: redirectURL)
    private lazy var appRemote: SPTAppRemote = {
        let remote = SPTAppRemote(configuration: configuration, logLevel: .none)
        remote.delegate = self
        return remote
    }()
    private var authSession: ASWebAuthenticationSession?
    private var codeVerifier: String?
    private var pendingURI: String?
    private var pendingRemoteAccessToken: String?
    private var pendingResume = false
    private var appIsActive = false
    private var remoteWasUsed = false
    private var remoteConnectInProgress = false
    private var tokenRefreshInProgress = false
    private var reconnectAttempts = 0
    private var reconnectWorkItem: DispatchWorkItem?
    private var spotifyActivationInProgress = false
    private var playbackRequestID = 0
    private var playbackStateVersion = 0
    private(set) var playbackSampledAt = Date().timeIntervalSince1970 * 1000
    var playbackSampleVersion: Int { playbackStateVersion }
    private var playbackRefreshInProgress = false
    private var playbackRefreshCompletions: [() -> Void] = []
    private var didStopOtherAudioOnLaunch = false
    private var savedTrackCache: [String: (saved: Bool, checkedAt: Date)] = [:]
    private var savedTrackChecks: [String: [(Bool?) -> Void]] = [:]
    private let reconnectDelays: [TimeInterval] = [0.6, 1.8, 4.0]
    private let tokenAccount = "weather-record-spotify-session"

    override init() {
        super.init()
        Task { _ = await restoreSession() }
    }

    @Published private(set) var isConnected = false
    @Published private(set) var isPlaying = false
    @Published private(set) var accessToken: String?
    @Published private(set) var playbackPosition = 0
    @Published private(set) var playbackDuration = 0
    @Published private(set) var currentTrackURI = ""
    @Published var connectionError: String?

    func stopOtherAudioOnLaunch() {
        guard !didStopOtherAudioOnLaunch else { return }
        didStopOtherAudioOnLaunch = true

        // Briefly claim audio focus without mixing. Releasing it without the
        // notify option leaves previously playing local audio paused.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            try? session.setActive(false, options: [])
        }

        appRemote.playerAPI?.pause(nil)
        isPlaying = false
        playbackPosition = 0

        guard let token = accessToken ?? loadSession()?.accessToken,
              let url = URL(string: "https://api.spotify.com/v1/me/player/pause") else { return }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request).resume()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? UIWindow()
    }

    func setAppActive(_ active: Bool) {
        guard appIsActive != active else { return }
        appIsActive = active
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        if !active {
            // Keep the last known player state while iOS suspends the app. The
            // web view can immediately continue its progress clock on return,
            // then refreshPlaybackState() corrects it against Spotify.
            return
        }
        refreshPlaybackState()
        if remoteWasUsed, accessToken != nil {
            reconnectAttempts = 0
            if spotifyActivationInProgress, pendingURI != nil {
                let work = DispatchWorkItem { [weak self] in
                    self?.reconnectWorkItem = nil
                    self?.connectRemoteIfNeeded()
                }
                reconnectWorkItem = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: work)
            } else {
                connectRemoteIfNeeded()
            }
        }
    }

    private func connectRemoteIfNeeded() {
        guard appIsActive, let token = pendingRemoteAccessToken ?? accessToken,
              !appRemote.isConnected, !remoteConnectInProgress else { return }
        if pendingRemoteAccessToken == nil, let saved = loadSession(), saved.expiresAt <= Date() {
            guard !tokenRefreshInProgress else { return }
            tokenRefreshInProgress = true
            Task { [weak self] in
                guard let self else { return }
                let restored = await self.restoreSession()
                await MainActor.run {
                    self.tokenRefreshInProgress = false
                    if restored { self.connectRemoteIfNeeded() }
                    else if self.pendingURI != nil || self.pendingResume {
                        self.connectionError = "Spotify 登录已过期，请重新连接账号。"
                    }
                }
            }
            return
        }
        appRemote.connectionParameters.accessToken = token
        remoteConnectInProgress = true
        reconnectAttempts += 1
        appRemote.connect()
    }

    private func scheduleReconnect() {
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        guard appIsActive, remoteWasUsed, accessToken != nil,
              isPlaying || pendingURI != nil || pendingResume else { return }
        guard reconnectAttempts <= reconnectDelays.count else {
            if spotifyActivationInProgress {
                spotifyActivationInProgress = false
                connectionError = "Spotify 已打开，但播放器连接尚未就绪。请保持 Spotify 在后台后再按一次播放。"
            } else if let uri = pendingURI { activateSpotify(for: uri) }
            else if pendingResume { connectionError = "Spotify 当前没有运行，请先打开 Spotify 后再继续播放。" }
            return
        }
        let delay = reconnectDelays[max(0, reconnectAttempts - 1)]
        let work = DispatchWorkItem { [weak self] in
            self?.reconnectWorkItem = nil
            self?.connectRemoteIfNeeded()
        }
        reconnectWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func activateSpotify(for uri: String) {
        guard !spotifyActivationInProgress else { return }
        spotifyActivationInProgress = true
        reconnectAttempts = 0
        appRemote.authorizeAndPlayURI(uri, asRadio: false, additionalScopes: ["user-library-read", "user-read-private", "user-read-playback-state", "user-modify-playback-state"]) { [weak self] canOpen in
            guard let self else { return }
            DispatchQueue.main.async {
                if !canOpen {
                    self.spotifyActivationInProgress = false
                    self.pendingURI = nil
                    self.connectionError = "无法打开 Spotify App，请确认它已安装并登录。"
                }
            }
        }
    }

    private func recoverRemoteConnection() {
        remoteConnectInProgress = false
        isConnected = false
        if appRemote.isConnected { appRemote.disconnect() }
        scheduleReconnect()
    }

    private func handlePlaybackError(_ error: Error, retryingURI uri: String? = nil) {
        let problem = error as NSError
        let connectionLost = !appRemote.isConnected
            || problem.domain.contains("transport")
            || error.localizedDescription.localizedCaseInsensitiveContains("connection terminated")
        if connectionLost {
            if let uri { pendingURI = uri }
            else { pendingResume = true }
            recoverRemoteConnection()
        } else {
            connectionError = error.localizedDescription
        }
    }

    // Reuse a saved account session; an explicit tap may also retry App Remote.
    func connect() {
        connectionError = nil
        if let saved = loadSession(), saved.expiresAt > Date() {
            accessToken = saved.accessToken
            remoteWasUsed = true
            reconnectAttempts = 0
            connectRemoteIfNeeded()
            return
        }
        if loadSession()?.refreshToken != nil {
            Task {
                if !(await restoreSession()) {
                    await MainActor.run {
                        self.accessToken = nil
                        self.beginAuthorization()
                    }
                } else {
                    await MainActor.run {
                        self.remoteWasUsed = true
                        self.reconnectAttempts = 0
                        self.connectRemoteIfNeeded()
                    }
                }
            }
            return
        }
        accessToken = nil
        beginAuthorization()
    }

    private func beginAuthorization() {
        let verifier = Self.base64URL(Data((0..<64).map { _ in UInt8.random(in: 0...255) }))
        codeVerifier = verifier
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var components = URLComponents(string: "https://accounts.spotify.com/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "redirect_uri", value: redirectURL.absoluteString),
            URLQueryItem(name: "scope", value: "app-remote-control user-library-read user-read-private user-read-playback-state user-modify-playback-state"),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: challenge)
        ]
        let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: redirectURL.scheme) { [weak self] url, error in
            guard let self else { return }
            DispatchQueue.main.async {
                self.authSession = nil
                if let error {
                    let nsError = error as NSError
                    if nsError.code != ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        self.connectionError = error.localizedDescription
                    }
                    return
                }
                guard let url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                    self.connectionError = "Spotify 未返回授权结果。"
                    return
                }
                if let message = parts.queryItems?.first(where: { $0.name == "error" })?.value {
                    self.connectionError = "Spotify 授权失败：\(message)"
                    return
                }
                guard let code = parts.queryItems?.first(where: { $0.name == "code" })?.value,
                      let verifier = self.codeVerifier else {
                    self.connectionError = "Spotify 回调缺少授权码。"
                    return
                }
                self.codeVerifier = nil
                Task { await self.exchangeCode(code, verifier: verifier) }
            }
        }
        session.presentationContextProvider = self
        authSession = session
        if !session.start() { connectionError = "无法打开 Spotify 授权页面。" }
    }

    private func exchangeCode(_ code: String, verifier: String) async {
        var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "redirect_uri", value: redirectURL.absoluteString),
            URLQueryItem(name: "code_verifier", value: verifier)
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let result = try JSONDecoder().decode(TokenResponse.self, from: data)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let token = result.access_token else {
                await MainActor.run { self.connectionError = "Spotify 换取令牌失败：\(result.error_description ?? result.error ?? "未知错误")" }
                return
            }
            await MainActor.run {
                self.accessToken = token
                self.appRemote.connectionParameters.accessToken = token
                let previous = self.loadSession()
                self.saveSession(StoredSession(accessToken: token, refreshToken: result.refresh_token ?? previous?.refreshToken, expiresAt: Date().addingTimeInterval(TimeInterval(result.expires_in ?? 3600) - 60)))
                self.remoteWasUsed = true
                self.reconnectAttempts = 0
                self.connectRemoteIfNeeded()
            }
        } catch {
            await MainActor.run { self.connectionError = "Spotify 登录失败：\(error.localizedDescription)" }
        }
    }

    private struct TokenResponse: Decodable {
        let access_token: String?
        let refresh_token: String?
        let expires_in: Int?
        let error: String?
        let error_description: String?
    }

    private struct StoredSession: Codable {
        let accessToken: String
        let refreshToken: String?
        let expiresAt: Date
    }

    private func loadSession() -> StoredSession? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: tokenAccount, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    private func saveSession(_ session: StoredSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: tokenAccount]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    private func restoreSession(reconnect: Bool = true) async -> Bool {
        guard let saved = loadSession() else { return false }
        if saved.expiresAt > Date() {
            await MainActor.run {
                self.accessToken = saved.accessToken
                self.appRemote.connectionParameters.accessToken = saved.accessToken
                if reconnect {
                    self.remoteWasUsed = true
                    self.reconnectAttempts = 0
                    self.connectRemoteIfNeeded()
                }
            }
            return true
        }
        guard let refreshToken = saved.refreshToken else { return false }
        var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [URLQueryItem(name: "client_id", value: clientID), URLQueryItem(name: "grant_type", value: "refresh_token"), URLQueryItem(name: "refresh_token", value: refreshToken)]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let result = try JSONDecoder().decode(TokenResponse.self, from: data)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let token = result.access_token else { return false }
            await MainActor.run {
                self.accessToken = token
                self.appRemote.connectionParameters.accessToken = token
                self.saveSession(StoredSession(accessToken: token, refreshToken: result.refresh_token ?? refreshToken, expiresAt: Date().addingTimeInterval(TimeInterval(result.expires_in ?? 3600) - 60)))
                if reconnect {
                    self.remoteWasUsed = true
                    self.reconnectAttempts = 0
                    self.connectRemoteIfNeeded()
                }
            }
            return true
        } catch { return false }
    }

    /// Returns a Web API token that is still valid, refreshing the PKCE session when needed.
    func validWebAPIToken() async -> String? {
        guard await restoreSession(reconnect: false) else { return nil }
        return await MainActor.run { self.accessToken }
    }

    /// Refreshes the visible player state without waiting for App Remote to
    /// reconnect. Calls are coalesced because foreground activation and the web
    /// view visibility event can arrive almost simultaneously.
    func refreshPlaybackState(completion: (() -> Void)? = nil) {
        if let completion { playbackRefreshCompletions.append(completion) }
        guard !playbackRefreshInProgress else { return }
        playbackRefreshInProgress = true
        let startingVersion = playbackStateVersion

        Task { [weak self] in
            guard let self else { return }
            guard let token = await self.validWebAPIToken() else {
                await MainActor.run { self.finishPlaybackRefresh() }
                return
            }
            var request = URLRequest(url: URL(string: "https://api.spotify.com/v1/me/player")!, timeoutInterval: 6)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let payload = status == 200 ? (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) : nil
                await MainActor.run {
                    // A newer App Remote callback is more authoritative than
                    // the HTTP snapshot that began before it.
                    if self.playbackStateVersion == startingVersion, let payload,
                       let item = payload["item"] as? [String: Any],
                       let uri = item["uri"] as? String {
                        self.playbackSampledAt = Date().timeIntervalSince1970 * 1000
                        self.isConnected = true
                        self.isPlaying = payload["is_playing"] as? Bool ?? false
                        self.playbackPosition = payload["progress_ms"] as? Int ?? 0
                        self.playbackDuration = item["duration_ms"] as? Int ?? 0
                        self.currentTrackURI = uri
                        self.playbackStateVersion += 1
                    }
                    self.finishPlaybackRefresh()
                }
            } catch {
                await MainActor.run { self.finishPlaybackRefresh() }
            }
        }
    }

    private func finishPlaybackRefresh() {
        playbackRefreshInProgress = false
        let completions = playbackRefreshCompletions
        playbackRefreshCompletions.removeAll(keepingCapacity: true)
        completions.forEach { $0() }
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    func handle(url: URL) -> Bool {
        guard url.scheme == redirectURL.scheme else { return false }
        // ASWebAuthenticationSession consumes the code callback itself.
        if URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "code" }) == true { return true }
        guard let parameters = appRemote.authorizationParameters(from: url) else {
            connectionError = "Spotify 回调地址不匹配，请检查 Dashboard 的 Redirect URI。"
            return false
        }
        if let message = parameters[SPTAppRemoteErrorDescriptionKey] {
            spotifyActivationInProgress = false
            connectionError = "Spotify 播放授权失败：\(message)"
            return true
        }
        if let token = parameters[SPTAppRemoteAccessTokenKey] {
            if accessToken == nil { accessToken = token }
            pendingRemoteAccessToken = token
            appRemote.connectionParameters.accessToken = token
            remoteWasUsed = true
            reconnectAttempts = 0
            let work = DispatchWorkItem { [weak self] in
                self?.reconnectWorkItem = nil
                self?.connectRemoteIfNeeded()
            }
            reconnectWorkItem?.cancel()
            reconnectWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.55, execute: work)
        }
        return true
    }

    func play(uri: String) {
        guard uri.hasPrefix("spotify:track:") || uri.hasPrefix("spotify:album:") else { return }
        connectionError = nil
        remoteWasUsed = true
        pendingResume = false
        if appRemote.isConnected {
            playConnectedURI(uri)
            return
        }
        if remoteConnectInProgress || reconnectWorkItem != nil {
            pendingURI = uri
            reconnectWorkItem?.cancel()
            reconnectWorkItem = nil
            remoteConnectInProgress = false
            if appRemote.isConnected { appRemote.disconnect() }
            activateSpotify(for: uri)
            return
        }
        pendingURI = uri
        reconnectAttempts = 0
        activateSpotify(for: uri)
    }

    private func playConnectedURI(_ uri: String) {
        playbackRequestID += 1
        let requestID = playbackRequestID
        if uri.hasPrefix("spotify:album:") {
            playAlbumFromBeginning(uri, requestID: requestID, retryAfterActivation: true)
        } else {
            playTrackURI(uri, requestID: requestID)
        }
    }

    private func playTrackURI(_ uri: String, requestID: Int) {
        appRemote.playerAPI?.play(uri) { [weak self] _, error in
            guard let self, requestID == self.playbackRequestID else { return }
            if let error { DispatchQueue.main.async { self.handlePlaybackError(error, retryingURI: uri) } }
        }
    }

    private func playAlbumFromBeginning(_ uri: String, requestID: Int, retryAfterActivation: Bool) {
        guard let token = accessToken,
              let url = URL(string: "https://api.spotify.com/v1/me/player/play") else {
            fallbackAlbumPlay(uri, requestID: requestID)
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "context_uri": uri,
            "offset": ["position": 0],
            "position_ms": 0
        ])
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self, requestID == self.playbackRequestID else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 204 {
                    self.playbackPosition = 0
                    return
                }
                if retryAfterActivation {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                        guard let self, requestID == self.playbackRequestID else { return }
                        self.playAlbumFromBeginning(uri, requestID: requestID, retryAfterActivation: false)
                    }
                } else {
                    self.fallbackAlbumPlay(uri, requestID: requestID)
                }
            }
        }.resume()
    }

    private func fallbackAlbumPlay(_ uri: String, requestID: Int) {
        appRemote.playerAPI?.play(uri) { [weak self] _, error in
            guard let self, requestID == self.playbackRequestID else { return }
            if let error {
                DispatchQueue.main.async { self.handlePlaybackError(error, retryingURI: uri) }
                return
            }
            self.appRemote.playerAPI?.seek(toPosition: 0, callback: nil)
        }
    }

    func queueCommand(_ action: String, completion: @escaping (String?) -> Void) {
        guard appRemote.isConnected, let player = appRemote.playerAPI else {
            completion("Spotify 未连接，请连接后重试")
            return
        }
        let callback: SPTAppRemoteCallback = { _, error in
            DispatchQueue.main.async { completion(error?.localizedDescription) }
        }
        if action == "next" { player.skip(toNext: callback) }
        else if action == "resume" { player.resume(callback) }
        else { completion("不支持的队列操作") }
    }
    func skipNext() {
        guard appRemote.isConnected else { return }
        appRemote.playerAPI?.skip(toNext: { [weak self] _, error in
            if let error { DispatchQueue.main.async { self?.connectionError = error.localizedDescription } }
        })
    }
    func pause() { playbackRequestID += 1; pendingResume = false; appRemote.playerAPI?.pause(nil) }
    func resume() {
        connectionError = nil
        remoteWasUsed = true
        if appRemote.isConnected {
            appRemote.playerAPI?.resume { [weak self] _, error in
                if let error {
                    DispatchQueue.main.async {
                        self?.handlePlaybackError(error)
                    }
                }
            }
        } else {
            pendingResume = true
            reconnectAttempts = 0
            connectRemoteIfNeeded()
        }
    }
    func seek(to milliseconds: Int) { appRemote.playerAPI?.seek(toPosition: max(0, milliseconds), callback: nil) }

    /// Uses Spotify's current library endpoint. `nil` means the saved state
    /// could not be confirmed, so callers must not display a rating prompt.
    func checkSavedTrack(uri: String, completion: @escaping (Bool?) -> Void) {
        guard uri.hasPrefix("spotify:track:") else { completion(nil); return }
        if let cached = savedTrackCache[uri], Date().timeIntervalSince(cached.checkedAt) < 600 {
            completion(cached.saved)
            return
        }
        if savedTrackChecks[uri] != nil {
            savedTrackChecks[uri]?.append(completion)
            return
        }
        savedTrackChecks[uri] = [completion]
        guard let token = accessToken else { finishSavedTrackCheck(uri: uri, result: nil); return }
        var components = URLComponents(string: "https://api.spotify.com/v1/me/library/contains")!
        components.queryItems = [URLQueryItem(name: "uris", value: uri)]
        guard let url = components.url else { finishSavedTrackCheck(uri: uri, result: nil); return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let result = status == 200 ? (data.flatMap { try? JSONDecoder().decode([Bool].self, from: $0) }?.first) : nil
            DispatchQueue.main.async { self?.finishSavedTrackCheck(uri: uri, result: result) }
        }.resume()
    }

    private func finishSavedTrackCheck(uri: String, result: Bool?) {
        if let result { savedTrackCache[uri] = (result, Date()) }
        let completions = savedTrackChecks.removeValue(forKey: uri) ?? []
        completions.forEach { $0(result) }
    }

    func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        spotifyActivationInProgress = false
        remoteConnectInProgress = false
        reconnectAttempts = 0
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        if !appIsActive { appRemote.disconnect(); return }
        pendingRemoteAccessToken = nil
        if let saved = loadSession(), saved.expiresAt <= Date() {
            Task { _ = await restoreSession() }
        }
        let selectedURI = pendingURI
        pendingURI = nil
        let shouldResume = pendingResume && selectedURI == nil
        pendingResume = false
        DispatchQueue.main.async { self.isConnected = true; self.connectionError = nil }
        appRemote.playerAPI?.delegate = self
        appRemote.playerAPI?.subscribe(toPlayerState: nil)
        if let selectedURI {
            playConnectedURI(selectedURI)
        } else if shouldResume {
            appRemote.playerAPI?.resume { [weak self] _, error in
                if let error {
                    DispatchQueue.main.async {
                        self?.handlePlaybackError(error)
                    }
                }
            }
        }
    }

    func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        DispatchQueue.main.async {
            self.remoteConnectInProgress = false
            self.isConnected = false
            if self.appIsActive { self.refreshPlaybackState() }
            self.scheduleReconnect()
        }
    }

    func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        DispatchQueue.main.async {
            self.remoteConnectInProgress = false
            self.isConnected = false
            self.isPlaying = false
            self.scheduleReconnect()
        }
    }

    func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        let sampledAt = Date().timeIntervalSince1970 * 1000
        DispatchQueue.main.async {
            self.playbackSampledAt = sampledAt
            self.playbackStateVersion += 1
            self.isPlaying = !playerState.isPaused
            self.playbackPosition = playerState.playbackPosition
            self.playbackDuration = Int(playerState.track.duration)
            self.currentTrackURI = playerState.track.uri
        }
    }
}
#else
final class SpotifyBridge: ObservableObject {
    var playbackSampledAt: Double { Date().timeIntervalSince1970 * 1000 }
    var playbackSampleVersion: Int { 0 }
    @Published private(set) var isConnected = false
    @Published private(set) var isPlaying = false
    @Published private(set) var accessToken: String?
    @Published private(set) var playbackPosition = 0
    @Published private(set) var playbackDuration = 0
    @Published private(set) var currentTrackURI = ""
    @Published var connectionError: String?
    func stopOtherAudioOnLaunch() {}
    func connect() { connectionError = "未加入 SpotifyiOS.xcframework。" }
    func setAppActive(_ active: Bool) {}
    func handle(url: URL) -> Bool { false }
    func play(uri: String) { connectionError = "未加入 SpotifyiOS.xcframework。" }
    func pause() {}
    func skipNext() {}
    func queueCommand(_ action: String, completion: @escaping (String?) -> Void) { completion("Spotify SDK 不可用") }
    func resume() {}
    func seek(to milliseconds: Int) {}
    func validWebAPIToken() async -> String? { nil }
    func refreshPlaybackState(completion: (() -> Void)? = nil) { completion?() }
    func checkSavedTrack(uri: String, completion: @escaping (Bool?) -> Void) { completion(nil) }
}
#endif
