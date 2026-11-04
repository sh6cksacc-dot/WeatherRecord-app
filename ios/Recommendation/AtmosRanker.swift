import Foundation

// Spotify-independent rules. Values describe musical atmosphere, not a person's mood.
struct MoodVector: Codable, Equatable {
    let energy: Double
    let valence: Double
    let calmness: Double
    init(_ energy: Double, _ valence: Double, _ calmness: Double) {
        self.energy = Self.unit(energy); self.valence = Self.unit(valence); self.calmness = Self.unit(calmness)
    }
    static func unit(_ value: Double) -> Double { value.isFinite ? min(1, max(0, value)) : 0.5 }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(try c.decode(Double.self, forKey: .energy), try c.decode(Double.self, forKey: .valence), try c.decode(Double.self, forKey: .calmness))
    }
}

struct AtmosConfig {
    var weatherWeight = 0.45, timeWeight = 0.30, userWeight = 0.25
    var moodWeight = 0.60, noveltyWeight = 0.20, diversityWeight = 0.10, explorationWeight = 0.10
    var temperature = 0.20
    var recentWindow: Double = 7 * 86400
    var skipWindow: Double = 3600
    var repeatCooldown: Double = 1800
}

enum ContextMoodMapper {
    static func weather(_ code: Int?) -> MoodVector {
        switch code {
        case 0, 1: return MoodVector(0.8, 0.8, 0.3)
        case 2, 3: return MoodVector(0.45, 0.55, 0.7)
        case 51, 53, 55, 56, 57, 61, 63, 66, 67, 80: return MoodVector(0.3, 0.5, 0.85)
        case 65, 81, 82, 95, 96, 99: return MoodVector(0.25, 0.4, 0.9)
        case 71, 73, 75, 77, 85, 86: return MoodVector(0.25, 0.65, 0.9)
        default: return MoodVector(0.5, 0.5, 0.5)
        }
    }
    static func time(_ hour: Int) -> MoodVector {
        switch hour {
        case 5...10: return MoodVector(0.7, 0.75, 0.45)
        case 11...16: return MoodVector(0.65, 0.7, 0.5)
        case 17...20: return MoodVector(0.4, 0.65, 0.75)
        default: return MoodVector(0.2, 0.5, 0.95)
        }
    }
    static func target(code: Int?, hour: Int, user: MoodVector? = nil, config: AtmosConfig = AtmosConfig()) -> MoodVector {
        let w = weather(code), t = time(hour), u = user ?? MoodVector(0.5, 0.5, 0.5)
        let a = code == nil ? 0 : max(0, config.weatherWeight), b = max(0, config.timeWeight), c = user == nil ? 0 : max(0, config.userWeight)
        let sum = max(0.001, a + b + c)
        return MoodVector((w.energy*a+t.energy*b+u.energy*c)/sum, (w.valence*a+t.valence*b+u.valence*c)/sum, (w.calmness*a+t.calmness*b+u.calmness*c)/sum)
    }
}

enum FeatureSource: String, Codable { case manual, licensedAI, metadataEstimate, unlabeled }
struct TrackFeatures: Codable {
    let spotifyID: String
    let energy: Double?
    let valence: Double?
    let calmness: Double?
    let acousticness: Double?
    let instrumentalness: Double?
    let groove: Double?
    let confidence: Double
    let source: FeatureSource
    let provenance: String?
    init(spotifyID: String, energy: Double?, valence: Double?, calmness: Double?,
         acousticness: Double? = nil, instrumentalness: Double? = nil, groove: Double? = nil,
         confidence: Double, source: FeatureSource, provenance: String? = nil) {
        self.spotifyID = spotifyID
        self.energy = energy
        self.valence = valence
        self.calmness = calmness
        self.acousticness = acousticness
        self.instrumentalness = instrumentalness
        self.groove = groove
        self.confidence = confidence
        self.source = source
        self.provenance = provenance
    }
}
struct AtmosCandidate: Codable {
    let id: String
    let artists: [String]
    let tags: [String]
    let featureKey: String?
    init(id: String, artists: [String], tags: [String], featureKey: String? = nil) {
        self.id = id
        self.artists = artists
        self.tags = tags
        self.featureKey = featureKey
    }
}
struct AtmosEvent: Codable {
    let id: String
    let artists: [String]
    let timestamp: Double
    let skipped: Bool
}
struct AtmosScore: Codable {
    let id: String
    let moodMatch: Double
    let novelty: Double
    let diversity: Double
    let exploration: Double
    let confidence: Double
    let total: Double
}
struct AtmosRanker {
    var config = AtmosConfig()
    var features: [String: TrackFeatures] = [:]
    private func artistKeys(_ artists: [String]) -> Set<String> {
        Set(artists.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
    }
    mutating func load(_ data: Data) throws {
        let records = try JSONDecoder().decode([TrackFeatures].self, from: data)
        features = records.reduce(into: [:]) { $0[$1.spotifyID] = $1 }
    }
    mutating func upsert(_ feature: TrackFeatures) { features[feature.spotifyID] = feature }
    func workoutEligible(_ item: AtmosCandidate) -> Bool {
        if let f = feature(item), f.source != .unlabeled, f.confidence.isFinite, f.confidence > 0 {
            if let groove = f.groove, groove.isFinite { return groove >= 0.65 }
            if let energy = f.energy, energy.isFinite, energy >= 0.72,
               (f.calmness ?? 0.5) <= 0.55 { return true }
        }
        // Existing artist tags are explicit low-confidence priors. They keep
        // Workout useful before the user has rated many individual tracks.
        return item.tags.contains("motivate") || item.tags.contains("vivid")
    }
    private func feature(_ item: AtmosCandidate) -> TrackFeatures? {
        features[item.id] ?? item.featureKey.flatMap { features[$0] }
    }
    // These are explicit low-confidence priors from the existing artist tags,
    // never measurements of an individual Spotify recording.
    func vector(_ item: AtmosCandidate) -> (MoodVector, Double) {
        if let f = feature(item), f.source != .unlabeled {
            let values = [f.energy, f.valence, f.calmness]
            let coverage = Double(values.compactMap { $0 }.count)/3
            let confidence = min(f.source == .metadataEstimate ? 0.3 : 1, MoodVector.unit(f.confidence)) * coverage
            return (MoodVector(f.energy ?? 0.5, f.valence ?? 0.5, f.calmness ?? 0.5), confidence)
        }
        let priors: [String: MoodVector] = ["motivate": MoodVector(0.8,0.7,0.25), "pop": MoodVector(0.65,0.65,0.4), "relaxed": MoodVector(0.4,0.6,0.8), "soft": MoodVector(0.25,0.5,0.9), "vivid": MoodVector(0.85,0.8,0.2), "night": MoodVector(0.25,0.4,0.8)]
        let known = item.tags.compactMap { priors[$0] }
        guard !known.isEmpty else { return (MoodVector(0.5,0.5,0.5), 0) }
        let n = Double(known.count)
        return (MoodVector(known.reduce(0){$0+$1.energy}/n,known.reduce(0){$0+$1.valence}/n,known.reduce(0){$0+$1.calmness}/n),0.2)
    }
    func score(_ item: AtmosCandidate, target: MoodVector, history: [AtmosEvent], now: Double, previous: AtmosCandidate?, exploration: Double) -> AtmosScore {
        let (v,c) = vector(item)
        let distance = sqrt((pow(v.energy-target.energy,2)+pow(v.valence-target.valence,2)+pow(v.calmness-target.calmness,2))/3)
        var match = 0.5 + c * (0.5-distance)
        // User ratings add three independent texture/rhythm axes. Their targets
        // are derived from the same weather/time mood, not treated as objective
        // Spotify audio analysis.
        if let f = feature(item), f.source != .unlabeled {
            let acousticTarget = MoodVector.unit(0.15 + target.calmness * 0.70 - target.energy * 0.15)
            let instrumentalTarget = MoodVector.unit(0.12 + target.calmness * 0.68 - target.valence * 0.10)
            let grooveTarget = MoodVector.unit(target.energy * 0.72 + target.valence * 0.28)
            let pairs = [(f.acousticness, acousticTarget), (f.instrumentalness, instrumentalTarget), (f.groove, grooveTarget)].compactMap { pair in pair.0.map { ($0, pair.1) } }
            if !pairs.isEmpty {
                let extendedDistance = sqrt(pairs.reduce(0) { $0 + pow(MoodVector.unit($1.0) - $1.1, 2) } / Double(pairs.count))
                let extendedMatch = 0.5 + c * (0.5 - extendedDistance)
                match = match * 0.68 + extendedMatch * 0.32
            }
        }
        let relevant = history.filter { $0.timestamp <= now && now-$0.timestamp < config.recentWindow }.sorted { $0.timestamp < $1.timestamp }
        let last = relevant.filter{$0.id == item.id}.map(\.timestamp).max()
        let novelty = last.map{min(1,max(0,(now-$0)/config.recentWindow))} ?? 1
        let recentArtists = artistKeys(relevant.suffix(5).flatMap(\.artists))
        var diversity = recentArtists.isDisjoint(with: artistKeys(item.artists)) ? 1.0 : 0.4
        if let p = previous {
            if !artistKeys(p.artists).isDisjoint(with: artistKeys(item.artists)) { diversity *= 0.2 }
            let (pv,pc) = vector(p)
            diversity *= 1 - min(c,pc) * abs(v.energy-pv.energy)
        }
        let skipped = relevant.contains{$0.id == item.id && $0.skipped && now-$0.timestamp < config.skipWindow}
        let raw = match*config.moodWeight+novelty*config.noveltyWeight+diversity*config.diversityWeight+MoodVector.unit(exploration)*config.explorationWeight
        return AtmosScore(id:item.id,moodMatch:match,novelty:novelty,diversity:diversity,exploration:exploration,confidence:c,total:MoodVector.unit(raw * (skipped ? 0.35 : 1)))
    }
    func sample<R: RandomNumberGenerator>(_ candidates: [AtmosCandidate], count: Int, target: MoodVector, history: [AtmosEvent], now: Double, previous: AtmosCandidate? = nil, using rng: inout R) -> [AtmosScore] {
        var seen = Set<String>()
        var pool = candidates.filter{!$0.id.isEmpty && seen.insert($0.id).inserted}
        var result: [AtmosScore] = [], prior = previous
        while !pool.isEmpty && result.count < max(0,count) {
            // Prefer tracks outside the cooldown, but always allow a finite
            // fallback for small libraries. Artist separation is secondary.
            let blocked = Set(history.filter {
                $0.timestamp <= now && now - $0.timestamp < ($0.skipped ? config.skipWindow : config.repeatCooldown)
            }.map(\.id))
            let fresh = pool.indices.filter { !blocked.contains(pool[$0].id) && pool[$0].id != prior?.id }
            var eligible = fresh.isEmpty ? Array(pool.indices) : fresh
            if let prior {
                let different = eligible.filter { artistKeys(prior.artists).isDisjoint(with: artistKeys(pool[$0].artists)) }
                if !different.isEmpty { eligible = different }
            }
            let scores = eligible.map{score(pool[$0],target:target,history:history,now:now,previous:prior,exploration:Double.random(in:0...1,using:&rng))}
            let maximum = scores.map(\.total).max() ?? 0
            let temperature = config.temperature.isFinite ? max(0.001,config.temperature) : 0.2
            let weights = scores.map{exp(($0.total-maximum)/temperature)}
            var draw = Double.random(in:0..<1,using:&rng) * weights.reduce(0,+)
            var index = weights.count-1
            for i in weights.indices { draw -= weights[i]; if draw < 0 { index=i; break } }
            result.append(scores[index]); prior=pool.remove(at:eligible[index])
        }
        return result
    }
}

final class RecommendationHistory {
    private let defaults: UserDefaults
    private let key = "atmosrank.history.v1"
    private(set) var events: [AtmosEvent]
    init(defaults: UserDefaults = .standard) {
        self.defaults=defaults
        events=(defaults.data(forKey:key).flatMap{try? JSONDecoder().decode([AtmosEvent].self,from:$0)}) ?? []
    }
    func record(_ event: AtmosEvent) {
        if let last=events.last, last.id == event.id && last.skipped == event.skipped && event.timestamp-last.timestamp < 30 { return }
        events.append(event); events=Array(events.suffix(1000))
        if let data=try? JSONEncoder().encode(events) { defaults.set(data,forKey:key) }
    }
}
