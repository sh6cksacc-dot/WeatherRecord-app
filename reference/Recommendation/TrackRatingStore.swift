import Foundation

struct SubjectiveTrackRating: Codable, Equatable {
    let spotifyURI: String
    let title: String
    let artist: String
    let album: String
    let energy: Int
    let valence: Int
    let calmness: Int
    let acousticness: Int
    let instrumentalness: Int
    let groove: Int
    let ratedAt: Date

    init(spotifyURI: String, title: String, artist: String, album: String,
         energy: Int, valence: Int, calmness: Int, acousticness: Int,
         instrumentalness: Int, groove: Int, ratedAt: Date = Date()) {
        self.spotifyURI = spotifyURI
        self.title = title
        self.artist = artist
        self.album = album
        self.energy = Self.score(energy)
        self.valence = Self.score(valence)
        self.calmness = Self.score(calmness)
        self.acousticness = Self.score(acousticness)
        self.instrumentalness = Self.score(instrumentalness)
        self.groove = Self.score(groove)
        self.ratedAt = ratedAt
    }

    private static func score(_ value: Int) -> Int { min(100, max(0, value)) }
}

enum TrackRatingStatus: String, Codable {
    case unrated, rated, suppressed
}

final class TrackRatingStore {
    private struct Payload: Codable {
        var ratings: [String: SubjectiveTrackRating] = [:]
        var suppressedURIs: Set<String> = []
    }

    private let defaults: UserDefaults
    private let key = "atmos.subjective-track-ratings.v1"
    private var payload: Payload

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        payload = defaults.data(forKey: key)
            .flatMap { try? JSONDecoder().decode(Payload.self, from: $0) } ?? Payload()
    }

    func status(for spotifyURI: String) -> TrackRatingStatus {
        if payload.ratings[spotifyURI] != nil { return .rated }
        if payload.suppressedURIs.contains(spotifyURI) { return .suppressed }
        return .unrated
    }

    func rating(for spotifyURI: String) -> SubjectiveTrackRating? { payload.ratings[spotifyURI] }
    var allRatings: [SubjectiveTrackRating] { Array(payload.ratings.values) }

    func save(_ rating: SubjectiveTrackRating) {
        guard rating.spotifyURI.hasPrefix("spotify:track:") else { return }
        payload.ratings[rating.spotifyURI] = rating
        payload.suppressedURIs.remove(rating.spotifyURI)
        persist()
    }

    func suppress(_ spotifyURI: String) {
        guard spotifyURI.hasPrefix("spotify:track:"), payload.ratings[spotifyURI] == nil else { return }
        payload.suppressedURIs.insert(spotifyURI)
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(payload) { defaults.set(data, forKey: key) }
    }
}
