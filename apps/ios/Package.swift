// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "GatewayAppFoundation",
  platforms: [
    .iOS(.v17),
    .macOS(.v14),
  ],
  products: [
    .library(name: "GatewayAppFoundation", targets: ["GatewayAppFoundation"]),
  ],
  targets: [
    .target(name: "GatewayAppFoundation"),
    .testTarget(
      name: "GatewayAppFoundationTests",
      dependencies: ["GatewayAppFoundation"]
    ),
  ]
)
