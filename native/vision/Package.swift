// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "cezane-vision",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "cezane-vision", targets: ["cezane-vision"])],
    targets: [
        .executableTarget(
            name: "cezane-vision",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
