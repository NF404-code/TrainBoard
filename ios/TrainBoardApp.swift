import SwiftUI
import Combine
import UserNotifications

@main
struct TrainBoardApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct Train: Decodable, Identifiable, Equatable {
    let number: String
    let time: String?
    let targetArrival: String?
    let station: String?
    let delayMinutes: Int?
    let platform: String?
    let track: String?
    let updateConfirmed: Bool?

    var id: String { number }
    var arrival: String { time ?? targetArrival ?? "—" }
}

struct ScheduleResponse: Decodable {
    let status: String
    let fromStorage: Bool?
    let snapshot: Snapshot?
    struct Snapshot: Decodable {
        let date: String
        let checkedAt: String?
        let trains: [Train]
    }
}

@MainActor
final class TrainBoardModel: ObservableObject {
    @Published var trains: [Train] = []
    @Published var status = "Загрузка…"
    @Published var lastChecked = ""
    @Published var isLoading = false
    @Published var notificationsEnabled = false
    private var previous: [String: Train] = [:]
    private let url = URL(string: "https://trainboard-freeman.patientbrownie8.chatgpt.site/api/schedule?stored=1")!

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 15
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let result = try JSONDecoder().decode(ScheduleResponse.self, from: data)
            guard let snapshot = result.snapshot else { throw URLError(.cannotParseResponse) }
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = TimeZone(identifier: "Europe/Warsaw")
            formatter.dateFormat = "yyyy-MM-dd"
            let today = formatter.string(from: Date())
            guard snapshot.date == today else {
                status = "Данные за другую дату — обновление недоступно"
                return
            }
            let fresh = result.status == "fresh" && result.fromStorage == true
            status = fresh ? "Данные актуальны" : "Источник не обновлён — показано последнее расписание"
            if fresh && !previous.isEmpty {
                for train in snapshot.trains {
                    if let old = previous[train.id], old != train {
                        await notifyChange(train)
                    }
                }
            }
            trains = snapshot.trains
            if fresh { previous = Dictionary(uniqueKeysWithValues: trains.map { ($0.id, $0) }) }
            lastChecked = Date.now.formatted(date: .omitted, time: .shortened)
        } catch {
            status = "Нет связи с TrainBoard — данные не подтверждены"
        }
    }

    func requestNotifications() async {
        do {
            notificationsEnabled = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch { notificationsEnabled = false }
    }

    private func notifyChange(_ train: Train) async {
        guard notificationsEnabled else { return }
        let content = UNMutableNotificationContent()
        content.title = "Изменение поезда \(train.number)"
        content.body = "\(train.station ?? "Станция"): \(train.arrival), платформа \(train.platform ?? "—"), путь \(train.track ?? "—")"
        content.sound = .default
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}

struct ContentView: View {
    @StateObject private var model = TrainBoardModel()
    @Environment(\.scenePhase) private var scenePhase
    private let timer = Timer.publish(every: 120, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("LEO EXPRESS").font(.caption.bold()).tracking(2).foregroundStyle(.orange)
                        Text("Расписание поездов").font(.largeTitle.bold())
                        Text(model.status).font(.subheadline).foregroundStyle(model.status == "Данные актуальны" ? .green : .orange)
                        if !model.lastChecked.isEmpty { Text("Проверено: \(model.lastChecked)").font(.caption).foregroundStyle(.secondary) }
                    }
                    ForEach(model.trains) { train in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Label("Поезд \(train.number)", systemImage: "tram.fill").font(.headline)
                                Spacer()
                                Text(train.arrival).font(.title2.monospacedDigit().bold())
                            }
                            Text(train.station ?? "Станция уточняется").font(.body)
                            HStack {
                                Label("Платформа \(train.platform ?? "—")", systemImage: "square.stack.3d.up")
                                Spacer()
                                Text("Путь \(train.track ?? "—")")
                            }.font(.subheadline).foregroundStyle(.secondary)
                            if let delay = train.delayMinutes, delay > 0 {
                                Label("Опоздание \(delay) мин", systemImage: "clock.badge.exclamationmark")
                                    .foregroundStyle(.orange).font(.subheadline.bold())
                            }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    }
                    Button {
                        Task { await model.requestNotifications() }
                    } label: {
                        Label("Включить уведомления", systemImage: "bell.badge")
                            .frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent).tint(.orange)
                    Text("Уведомления об изменениях работают при активной проверке приложения. Фоновые push-уведомления для всей группы потребуют отдельной серверной настройки.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await model.load() } } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(model.isLoading)
            }}
            .refreshable { await model.load() }
        }
        .task { await model.load() }
        .onReceive(timer) { _ in Task { await model.load() } }
        .onChange(of: scenePhase) { _, newValue in if newValue == .active { Task { await model.load() } } }
    }
}
