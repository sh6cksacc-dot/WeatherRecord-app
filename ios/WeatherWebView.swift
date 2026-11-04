import SwiftUI
import WebKit
import CoreLocation

struct WeatherWebView: UIViewRepresentable {
    @ObservedObject var spotify: SpotifyBridge

    func makeCoordinator() -> Coordinator { Coordinator(spotify: spotify) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "spotifyConnect")
        controller.add(context.coordinator, name: "spotifyPlay")
        controller.add(context.coordinator, name: "spotifyPause")
        controller.add(context.coordinator, name: "spotifyResume")
        controller.add(context.coordinator, name: "spotifySeek")
        controller.add(context.coordinator, name: "spotifyStateRefresh")
        controller.add(context.coordinator, name: "spotifyQueueRequest")
        controller.add(context.coordinator, name: "spotifyNext")
        controller.add(context.coordinator, name: "spotifyQueueCommand")
        controller.add(context.coordinator, name: "weatherLocation")
        controller.add(context.coordinator, name: "lyricsFetch")
        controller.add(context.coordinator, name: "pitchforkReview")
        controller.add(context.coordinator, name: "atmosRank")
        controller.add(context.coordinator, name: "atmosEvent")
        controller.add(context.coordinator, name: "trackRatingCheck")
        controller.add(context.coordinator, name: "trackRatingSave")
        controller.add(context.coordinator, name: "trackRatingSuppress")
        let nativeMarker = WKUserScript(source: "window.WEATHER_RECORD_NATIVE = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        controller.addUserScript(nativeMarker)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        context.coordinator.webView = webView
        webView.isOpaque = true
        webView.backgroundColor = .systemBackground
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            let html = """
            <html><body style=\"font-family:-apple-system;padding:32px;background:#f7f7f5;color:#172033\">
            <h2>Weather Record</h2><p>找不到 index.html。</p>
            <p>请把 index.html、styles.css、clean-app.js 和 bootstrap.js 加入 App Target。</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.scheduleState(to: webView)
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, CLLocationManagerDelegate {
        let spotify: SpotifyBridge
        weak var webView: WKWebView?
        private let locationManager = CLLocationManager()
        private var pendingStateUpdate: DispatchWorkItem?
        private let recommendationHistory = RecommendationHistory()
        private let trackRatings = TrackRatingStore()
        private var ranker: AtmosRanker = {
            var engine = AtmosRanker()
            if let url = Bundle.main.url(forResource: "track-features", withExtension: "json"),
               let data = try? Data(contentsOf: url) { try? engine.load(data) }
            return engine
        }()
        init(spotify: SpotifyBridge) {
            self.spotify = spotify
            super.init()
            trackRatings.allRatings.forEach { ranker.upsert(Self.atmosFeature(from: $0)) }
        }

        private static func atmosFeature(from rating: SubjectiveTrackRating) -> TrackFeatures {
            let trackID = rating.spotifyURI.split(separator: ":").last.map(String.init) ?? rating.spotifyURI
            return TrackFeatures(
                spotifyID: trackID,
                energy: Double(rating.energy) / 100,
                valence: Double(rating.valence) / 100,
                calmness: Double(rating.calmness) / 100,
                acousticness: Double(rating.acousticness) / 100,
                instrumentalness: Double(rating.instrumentalness) / 100,
                groove: Double(rating.groove) / 100,
                confidence: 1,
                source: .manual,
                provenance: "userSubjective"
            )
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            sendState(to: webView)
        }

        func sendState(to webView: WKWebView) {
            let state: [String: Any] = [
            "connected": spotify.isConnected,
            "playing": spotify.isPlaying,
            "token": spotify.accessToken ?? "",
            "position": spotify.playbackPosition,
            "sampledAt": spotify.playbackSampledAt,
            "sampleVersion": spotify.playbackSampleVersion,
            "duration": spotify.playbackDuration,
            "trackURI": spotify.currentTrackURI
            ]
            guard JSONSerialization.isValidJSONObject(state),
                  let data = try? JSONSerialization.data(withJSONObject: state),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('weatherRecordSpotifyState', { detail: \(json) }));", completionHandler: nil)
        }

        // Queue maintenance is deliberately incapable of pausing or restarting playback.
        private func queueRequest(_ body: [String: Any]) {
            guard let id = body["requestID"] as? Int,
                  let method = body["method"] as? String,
                  let path = body["path"] as? String,
                  (method == "GET" && ["/me/player", "/me/player/queue"].contains(path)) ||
                    (method == "POST" && path == "/me/player/queue") else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                var result: [String: Any] = ["requestID": id, "status": 0]
                if let token = await spotify.validWebAPIToken() {
                    var components = URLComponents(string: "https://api.spotify.com/v1" + path)!
                    if method == "POST" {
                        guard let uri = body["uri"] as? String, uri.hasPrefix("spotify:track:"),
                              let device = body["deviceID"] as? String, !device.isEmpty else { return }
                        components.queryItems = [URLQueryItem(name: "uri", value: uri), URLQueryItem(name: "device_id", value: device)]
                    }
                    var request = URLRequest(url: components.url!, timeoutInterval: 12)
                    request.httpMethod = method
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    do {
                        let (data, response) = try await URLSession.shared.data(for: request)
                        let http = response as? HTTPURLResponse
                        result["status"] = http?.statusCode ?? 0
                        result["retryAfter"] = http?.value(forHTTPHeaderField: "Retry-After") ?? "0"
                        if !data.isEmpty { result["body"] = try? JSONSerialization.jsonObject(with: data) }
                    } catch { result["message"] = error.localizedDescription }
                } else { result["status"] = 401 }
                // Bounded diagnostics for device verification; never persist tokens.
                var diagnostic: [String: Any] = ["time": ISO8601DateFormatter().string(from: Date()), "method": method, "path": path, "status": result["status"] ?? 0]
                diagnostic["requestedURI"] = body["uri"]
                if let response = result["body"] as? [String: Any] {
                    diagnostic["currentURI"] = ((response["currently_playing"] ?? response["item"]) as? [String: Any])?["uri"]
                    diagnostic["queue"] = (response["queue"] as? [[String: Any]])?.compactMap { $0["uri"] as? String }
                    diagnostic["playing"] = response["is_playing"]
                    diagnostic["error"] = response["error"]
                }
                if let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                    let url = directory.appendingPathComponent("AtmosQueueDiagnostics.json")
                    var entries = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
                    entries.append(diagnostic)
                    if let data = try? JSONSerialization.data(withJSONObject: Array(entries.suffix(150))) { try? data.write(to: url, options: .atomic) }
                }
                if let data = try? JSONSerialization.data(withJSONObject: result),
                   let json = String(data: data, encoding: .utf8) {
                    webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('spotifyQueueResponse',{detail:\(json)}));", completionHandler: nil)
                }
            }
        }

        func scheduleState(to webView: WKWebView) {
            pendingStateUpdate?.cancel()
            let update = DispatchWorkItem { [weak self, weak webView] in
                guard let self, let webView else { return }
                self.sendState(to: webView)
            }
            pendingStateUpdate = update
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.06, execute: update)
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            switch message.name {
            case "atmosRank": rankCandidates(body)
            case "atmosEvent":
                if let data = try? JSONSerialization.data(withJSONObject: body),
                   let event = try? JSONDecoder().decode(AtmosEvent.self, from: data) {
                    recommendationHistory.record(event)
                }
            case "spotifyConnect": spotify.connect()
            case "spotifyPlay": if let uri = body["uri"] as? String { spotify.play(uri: uri) }
            case "spotifyPause": spotify.pause()
            case "spotifyResume": spotify.resume()
            case "spotifySeek": if let position = body["position"] as? Int { spotify.seek(to: position) }
            case "spotifyStateRefresh":
                spotify.refreshPlaybackState { [weak self] in
                    guard let self, let webView = self.webView else { return }
                    self.sendState(to: webView)
                }
            case "spotifyQueueRequest": queueRequest(body)
            case "spotifyNext": spotify.skipNext()
            case "spotifyQueueCommand":
                guard let id = body["requestID"] as? Int, let action = body["action"] as? String else { return }
                spotify.queueCommand(action) { [weak self] error in
                    let result: [String: Any] = ["requestID": id, "status": error == nil ? 204 : 409, "message": error ?? ""]
                    if let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) {
                        self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('spotifyQueueResponse',{detail:\(json)}));", completionHandler: nil)
                    }
                }
            case "trackRatingCheck": checkTrackRating(body)
            case "trackRatingSave": saveTrackRating(body)
            case "trackRatingSuppress": suppressTrackRating(body)
            case "lyricsFetch": fetchLyrics(body)
            case "pitchforkReview": fetchPitchforkReview(body)
            case "weatherLocation":
                guard Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil else {
                    sendLocationError("iOS Target 缺少位置权限说明")
                    return
                }
                locationManager.delegate = self
                if locationManager.authorizationStatus == .notDetermined { locationManager.requestWhenInUseAuthorization() }
                else { locationManager.requestLocation() }
            default: break
            }
        }

        private func checkTrackRating(_ body: [String: Any]) {
            guard let uri = body["uri"] as? String,
                  uri.hasPrefix("spotify:track:"), uri == spotify.currentTrackURI else { return }
            let status = trackRatings.status(for: uri)
            guard status == .unrated else {
                sendTrackRatingStatus(uri: uri, eligible: false, status: status)
                return
            }
            // Songs returned by GET /me/tracks were already confirmed by Spotify
            // as saved; avoid a second request that can fail or be rate-limited.
            if body["knownLiked"] as? Bool == true {
                sendTrackRatingStatus(uri: uri, eligible: true, status: .unrated)
                return
            }
            spotify.checkSavedTrack(uri: uri) { [weak self] saved in
                guard let self, uri == self.spotify.currentTrackURI else { return }
                // Unknown membership is deliberately ineligible.
                self.sendTrackRatingStatus(uri: uri, eligible: saved == true, status: .unrated)
            }
        }

        private func saveTrackRating(_ body: [String: Any]) {
            guard let uri = body["uri"] as? String,
                  uri.hasPrefix("spotify:track:"),
                  let values = body["values"] as? [String: Any] else { return }
            func score(_ key: String) -> Int? {
                if let value = values[key] as? Int { return value }
                if let value = values[key] as? NSNumber { return value.intValue }
                return nil
            }
            guard let energy = score("energy"), let valence = score("valence"),
                  let calmness = score("calmness"), let acousticness = score("acousticness"),
                  let instrumentalness = score("instrumentalness"), let groove = score("groove") else { return }
            let rating = SubjectiveTrackRating(
                spotifyURI: uri,
                title: body["title"] as? String ?? "",
                artist: body["artist"] as? String ?? "",
                album: body["album"] as? String ?? "",
                energy: energy, valence: valence, calmness: calmness,
                acousticness: acousticness, instrumentalness: instrumentalness, groove: groove
            )
            trackRatings.save(rating)
            ranker.upsert(Self.atmosFeature(from: rating))
            sendTrackRatingEvent("atmosTrackRatingSaved", payload: ["uri": uri])
        }

        private func suppressTrackRating(_ body: [String: Any]) {
            guard let uri = body["uri"] as? String else { return }
            trackRatings.suppress(uri)
            sendTrackRatingEvent("atmosTrackRatingSuppressed", payload: ["uri": uri])
        }

        private func sendTrackRatingStatus(uri: String, eligible: Bool, status: TrackRatingStatus) {
            sendTrackRatingEvent("atmosTrackRatingStatus", payload: [
                "uri": uri, "eligible": eligible, "status": status.rawValue
            ])
        }

        private func sendTrackRatingEvent(_ name: String, payload: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)',{detail:\(json)}));", completionHandler: nil)
        }

        private func rankCandidates(_ body: [String: Any]) {
            guard let requestID = body["requestID"] as? Int,
                  let items = body["candidates"],
                  let data = try? JSONSerialization.data(withJSONObject: items),
                  let candidates = try? JSONDecoder().decode([AtmosCandidate].self, from: data) else { return }
            var previous: AtmosCandidate?
            if let value = body["previous"], JSONSerialization.isValidJSONObject(value),
               let encoded = try? JSONSerialization.data(withJSONObject: value) {
                previous = try? JSONDecoder().decode(AtmosCandidate.self, from: encoded)
            }
            var rng = SystemRandomNumberGenerator()
            let workout = body["workout"] as? Bool == true
            let target = workout ? MoodVector(0.85, 0.75, 0.2) : ContextMoodMapper.target(code: body["weatherCode"] as? Int, hour: Calendar.current.component(.hour, from: Date()))
            let pool = workout ? candidates.filter { ranker.workoutEligible($0) } : candidates
            let scores = ranker.sample(Array(pool.prefix(150)), count: 1, target: target,
                                       history: recommendationHistory.events, now: Date().timeIntervalSince1970,
                                       previous: previous, using: &rng)
            guard let encoded = try? JSONEncoder().encode(scores), let json = String(data: encoded, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('atmosRankResult',{detail:{requestID:\(requestID),scores:\(json)}}));", completionHandler: nil)
        }

        private struct LyricsLookup {
            let requestId: Int
            let trackURI: String
            let trackName: String
            let artistName: String
            let albumName: String
            let duration: Int
        }

        private func fetchLyrics(_ body: [String: Any]) {
            guard let requestId = body["requestId"] as? Int,
                  let trackURI = body["trackURI"] as? String,
                  let trackName = body["trackName"] as? String,
                  let artistName = body["artistName"] as? String else { return }
            let lookup = LyricsLookup(
                requestId: requestId,
                trackURI: trackURI,
                trackName: trackName,
                artistName: artistName,
                albumName: body["albumName"] as? String ?? "",
                duration: body["duration"] as? Int ?? 0
            )
            performLyricsRequest(lyricsRequest(for: lookup, stage: 0), lookup: lookup, stage: 0, attempt: 0)
        }

        private func lyricsRequest(for lookup: LyricsLookup, stage: Int) -> URLRequest {
            var components = URLComponents(string: stage == 2 ? "https://lrclib.net/api/search" : "https://lrclib.net/api/get")!
            components.queryItems = [
                URLQueryItem(name: "track_name", value: lookup.trackName),
                URLQueryItem(name: "artist_name", value: lookup.artistName)
            ]
            if stage == 0, !lookup.albumName.isEmpty {
                components.queryItems?.append(URLQueryItem(name: "album_name", value: lookup.albumName))
            }
            if stage == 0, lookup.duration > 0, lookup.duration <= 3600 {
                components.queryItems?.append(URLQueryItem(name: "duration", value: String(lookup.duration)))
            }
            var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
            request.setValue("WeatherRecord/1.0 (personal music app)", forHTTPHeaderField: "User-Agent")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            return request
        }

        private func performLyricsRequest(_ request: URLRequest, lookup: LyricsLookup, stage: Int, attempt: Int) {
            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 200, let data, let record = self.bestLyricsRecord(in: data, lookup: lookup, search: stage == 2) {
                    let payload: [String: Any] = [
                        "requestId": lookup.requestId,
                        "trackURI": lookup.trackURI,
                        "syncedLyrics": record["syncedLyrics"] as? String ?? "",
                        "instrumental": record["instrumental"] as? Bool ?? false
                    ]
                    DispatchQueue.main.async { self.sendLyrics(payload) }
                    return
                }
                // Spotify album editions and durations often differ slightly
                // from LRCLIB. Relax exact metadata first, then use structured
                // search, while still validating the returned title/artist.
                if (status == 200 || status == 404), stage < 2 {
                    let nextStage = stage + 1
                    self.performLyricsRequest(self.lyricsRequest(for: lookup, stage: nextStage), lookup: lookup, stage: nextStage, attempt: 0)
                    return
                }
                let retryable = error != nil || status == 0 || status == 408 || status == 425 || status == 429 || (500...599).contains(status)
                if retryable, attempt < 2 {
                    let delays: [TimeInterval] = [0.55, 1.4]
                    let retryAfter = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init) ?? 0
                    let delay = min(3, max(delays[attempt], retryAfter))
                    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay) { [weak self] in
                        self?.performLyricsRequest(request, lookup: lookup, stage: stage, attempt: attempt + 1)
                    }
                    return
                }
                let unavailable = status != 404 && (status == 0 || status == 408 || status == 425 || status == 429 || status >= 500)
                let message = unavailable
                    ? (self.isEnglishLocale ? "Lyrics service is temporarily unavailable. Please try again later." : "歌词服务暂时不可用，请稍后再试")
                    : (self.isEnglishLocale ? "Synced lyrics are not available for this song" : "这首歌暂时没有同步歌词")
                let payload: [String: Any] = ["requestId": lookup.requestId, "trackURI": lookup.trackURI, "error": message]
                DispatchQueue.main.async { self.sendLyrics(payload) }
            }.resume()
        }

        private func bestLyricsRecord(in data: Data, lookup: LyricsLookup, search: Bool) -> [String: Any]? {
            guard let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
            let records: [[String: Any]]
            if let record = object as? [String: Any] { records = [record] }
            else if let values = object as? [[String: Any]] { records = values }
            else { return nil }
            let usable = records.filter {
                (($0["syncedLyrics"] as? String)?.isEmpty == false) || ($0["instrumental"] as? Bool == true)
            }
            return usable.compactMap { record -> (record: [String: Any], score: Int)? in
                let title = self.normalizedLyricsText(record["trackName"] as? String ?? record["name"] as? String ?? "")
                let artist = self.normalizedLyricsText(record["artistName"] as? String ?? "")
                let wantedTitle = self.normalizedLyricsText(lookup.trackName)
                let wantedArtist = self.normalizedLyricsText(lookup.artistName)
                let titleMatches = title == wantedTitle || title.contains(wantedTitle) || wantedTitle.contains(title)
                let artistMatches = artist == wantedArtist || artist.contains(wantedArtist) || wantedArtist.contains(artist)
                guard !title.isEmpty, !artist.isEmpty, titleMatches, artistMatches else { return nil }
                // Same title/artist can refer to live, edited or remixed audio.
                // Never show timestamps from a substantially different recording.
                if let duration = record["duration"] as? Double, lookup.duration > 0,
                   abs(duration - Double(lookup.duration)) > 3 { return nil }
                let variants = ["live", "remix", "acoustic", "instrumental", "spedup", "slowed", "radioedit", "现场", "伴奏"]
                guard !variants.contains(where: { title.contains($0) != wantedTitle.contains($0) }) else { return nil }
                var score = title == wantedTitle ? 8 : 4
                score += artist == wantedArtist ? 6 : 3
                if let duration = record["duration"] as? Double, lookup.duration > 0 {
                    let difference = abs(duration - Double(lookup.duration))
                    score += difference <= 3 ? 3 : difference <= 10 ? 1 : 0
                }
                if (record["syncedLyrics"] as? String)?.isEmpty == false { score += 4 }
                return (record, score)
            }.max(by: { $0.score < $1.score })?.record
        }

        private func normalizedLyricsText(_ value: String) -> String {
            value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                .unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }
                .map(String.init).joined()
        }

        private func sendLyrics(_ payload: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('weatherRecordLyrics',{detail:\(json)}));", completionHandler: nil)
        }

        private struct PitchforkResult {
            let title: String
            let artist: String
            let summary: String
            let score: Double
            let url: String
        }

        private func fetchPitchforkReview(_ body: [String: Any]) {
            guard let requestId = body["requestId"] as? Int,
                  let albumURI = body["albumURI"] as? String,
                  let albumKey = body["albumKey"] as? String,
                  let albumName = body["albumName"] as? String,
                  let artistName = body["artistName"] as? String else { return }
            var components = URLComponents(string: "https://pitchfork.com/search/")!
            components.queryItems = [URLQueryItem(name: "query", value: "\(artistName) \(albumName)")]
            guard let url = components.url else { return }
            var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
            request.setValue("Mozilla/5.0 (iPhone; WeatherRecord/1.0)", forHTTPHeaderField: "User-Agent")
            URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
                guard let self else { return }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data, let html = String(data: data, encoding: .utf8) else {
                    self.sendPitchforkFailure(requestId: requestId, albumURI: albumURI, albumKey: albumKey, message: self.isEnglishLocale ? "Pitchfork is temporarily unavailable" : "Pitchfork 暂时无法连接")
                    return
                }
                guard let review = self.bestPitchforkResult(in: html, album: albumName, artist: artistName) else {
                    self.sendPitchforkFailure(requestId: requestId, albumURI: albumURI, albumKey: albumKey, message: self.isEnglishLocale ? "Pitchfork has not reviewed this album" : "Pitchfork 暂未收录这张专辑")
                    return
                }
                let originalPayload: [String: Any] = [
                    "requestId": requestId, "albumURI": albumURI, "albumKey": albumKey,
                    "summary": review.summary, "score": review.score, "url": review.url,
                    "translated": false
                ]
                DispatchQueue.main.async { self.sendPitchfork(originalPayload) }
                guard !self.isEnglishLocale else { return }
                self.translateToChinese(review.summary) { translated in
                    guard let translated, !translated.isEmpty else { return }
                    let payload: [String: Any] = [
                        "requestId": requestId,
                        "albumURI": albumURI,
                        "albumKey": albumKey,
                        "summary": translated,
                        "score": review.score,
                        "url": review.url,
                        "translated": true
                    ]
                    DispatchQueue.main.async { self.sendPitchfork(payload) }
                }
            }.resume()
        }

        private var isEnglishLocale: Bool {
            Locale.preferredLanguages.first?.lowercased().hasPrefix("en") == true
        }

        private func bestPitchforkResult(in html: String, album: String, artist: String) -> PitchforkResult? {
            let pattern = #"\"source\":\{\"hed\":\"((?:\\.|[^\"\\])*)\",\"dek\":\"((?:\\.|[^\"\\])*)\"\},\"subHed\":\{\"name\":\"((?:\\.|[^\"\\])*)\"[^}]*\}.*?\"ratingValue\":\{.*?\"score\":([0-9.]+).*?\"url\":\"((?:\\.|[^\"\\])*)\""#
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
            let range = NSRange(html.startIndex..., in: html)
            let wantedAlbum = normalizedPitchforkText(album)
            let wantedArtist = normalizedPitchforkText(artist)
            var best: (rank: Int, result: PitchforkResult)?
            for match in regex.matches(in: html, options: [.withTransparentBounds], range: range) {
                guard match.numberOfRanges == 6,
                      let title = decodedJSONString(match.range(at: 1), in: html),
                      let summary = decodedJSONString(match.range(at: 2), in: html),
                      let resultArtist = decodedJSONString(match.range(at: 3), in: html),
                      let scoreRange = Range(match.range(at: 4), in: html),
                      let score = Double(html[scoreRange]),
                      let path = decodedJSONString(match.range(at: 5), in: html) else { continue }
                let foundAlbum = normalizedPitchforkText(title)
                let foundArtist = normalizedPitchforkText(resultArtist)
                guard foundArtist == wantedArtist || foundArtist.contains(wantedArtist) || wantedArtist.contains(foundArtist) else { continue }
                var rank = foundArtist == wantedArtist ? 40 : 20
                if foundAlbum == wantedAlbum { rank += 100 }
                else if foundAlbum.contains(wantedAlbum) || wantedAlbum.contains(foundAlbum) { rank += 45 }
                else { continue }
                let cleanSummary = summary.replacingOccurrences(of: "*", with: "")
                let result = PitchforkResult(title: title, artist: resultArtist, summary: cleanSummary, score: score, url: "https://pitchfork.com" + path)
                if best == nil || rank > best!.rank { best = (rank, result) }
            }
            return best?.result
        }

        private func decodedJSONString(_ range: NSRange, in source: String) -> String? {
            guard let swiftRange = Range(range, in: source) else { return nil }
            let wrapped = "\"\(source[swiftRange])\""
            guard let data = wrapped.data(using: .utf8) else { return nil }
            return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? String
        }

        private func normalizedPitchforkText(_ value: String) -> String {
            value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
                .replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
        }

        private func translateToChinese(_ text: String, completion: @escaping (String?) -> Void) {
            var components = URLComponents(string: "https://translate.googleapis.com/translate_a/single")!
            components.queryItems = [
                URLQueryItem(name: "client", value: "gtx"),
                URLQueryItem(name: "sl", value: "en"),
                URLQueryItem(name: "tl", value: "zh-CN"),
                URLQueryItem(name: "dt", value: "t"),
                URLQueryItem(name: "q", value: text)
            ]
            guard let url = components.url else { completion(nil); return }
            URLSession.shared.dataTask(with: URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 12)) { data, response, _ in
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data,
                      let root = try? JSONSerialization.jsonObject(with: data) as? [Any],
                      let segments = root.first as? [Any] else { completion(nil); return }
                let translated = segments.compactMap { ($0 as? [Any])?.first as? String }.joined()
                completion(translated.isEmpty ? nil : translated)
            }.resume()
        }

        private func sendPitchfork(_ payload: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('weatherRecordPitchfork',{detail:\(json)}));", completionHandler: nil)
        }

        private func sendPitchforkFailure(requestId: Int, albumURI: String, albumKey: String, message: String) {
            let payload: [String: Any] = ["requestId": requestId, "albumURI": albumURI, "albumKey": albumKey, "error": message]
            DispatchQueue.main.async { self.sendPitchfork(payload) }
        }

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
                manager.requestLocation()
            } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                sendLocationError("请在 iPhone 设置中允许此 App 使用位置")
            }
        }

        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard let location = locations.last else { return }
            var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
            components.queryItems = [
                URLQueryItem(name: "latitude", value: String(location.coordinate.latitude)),
                URLQueryItem(name: "longitude", value: String(location.coordinate.longitude)),
                URLQueryItem(name: "current", value: "temperature_2m,weather_code"),
                URLQueryItem(name: "timezone", value: "auto")
            ]
            Task {
                do {
                    let (data, response) = try await URLSession.shared.data(from: components.url!)
                    guard (response as? HTTPURLResponse)?.statusCode == 200,
                          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let current = result["current"] as? [String: Any],
                          let temperature = current["temperature_2m"] as? Double, temperature.isFinite,
                          let code = current["weather_code"] as? Int else {
                        sendLocationError("天气服务暂时不可用")
                        return
                    }
                    let weather: [String: Any] = ["temperature": temperature, "code": code]
                    guard JSONSerialization.isValidJSONObject(weather) else {
                        sendLocationError("天气数据格式异常")
                        return
                    }
                    let jsonData = try JSONSerialization.data(withJSONObject: weather)
                    guard let json = String(data: jsonData, encoding: .utf8) else { return }
                    await MainActor.run {
                        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('weatherRecordWeather',{detail:\(json)}));", completionHandler: nil)
                    }
                } catch { sendLocationError("天气获取失败，请检查网络") }
            }
        }

        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
            sendLocationError("定位失败，请检查定位服务")
        }

        private func sendLocationError(_ message: String) {
            guard let data = try? JSONEncoder().encode(message),
                  let json = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('weatherRecordLocationError',{detail:\(json)}));", completionHandler: nil)
            }
        }
    }
}
