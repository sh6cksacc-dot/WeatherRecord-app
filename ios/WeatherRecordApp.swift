import SwiftUI

@main
struct WeatherRecordApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var spotify = SpotifyBridge()

    var body: some Scene {
        WindowGroup {
            WeatherWebView(spotify: spotify)
                .ignoresSafeArea()
                .preferredColorScheme(.light)
                .onOpenURL { url in _ = spotify.handle(url: url) }
                .onAppear {
                    spotify.setAppActive(scenePhase == .active)
                }
                .onChange(of: scenePhase) { phase in spotify.setAppActive(phase == .active) }
                .alert("Spotify 连接失败", isPresented: Binding(
                    get: { spotify.connectionError != nil },
                    set: { if !$0 { spotify.connectionError = nil } }
                )) {
                    Button("好", role: .cancel) {}
                } message: {
                    Text(spotify.connectionError ?? "未知错误")
                }
        }
    }
}
