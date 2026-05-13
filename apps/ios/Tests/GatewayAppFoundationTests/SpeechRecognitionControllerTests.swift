#if canImport(Speech)
import XCTest
@testable import GatewayAppFoundation

@MainActor
final class SpeechRecognitionControllerTests: XCTestCase {

  // MARK: - SpeechRecognitionController initial state

  func testInitialStateIsIdle() {
    let controller = SpeechRecognitionController()
    XCTAssertEqual(controller.recognitionState, .idle)
    XCTAssertFalse(controller.isRecording)
    XCTAssertEqual(controller.transcript, "")
  }

  func testStopRecordingFromIdleIsNoOp() {
    let controller = SpeechRecognitionController()
    controller.stopRecording()
    XCTAssertEqual(controller.recognitionState, .idle)
    XCTAssertFalse(controller.isRecording)
    XCTAssertEqual(controller.transcript, "")
  }

  func testStartRecordingWithUnavailableRecognizerSetsUnavailableState() throws {
    // An unsupported locale causes SFSpeechRecognizer to return nil, which
    // is treated as an unavailable recognizer.
    let controller = SpeechRecognitionController(locale: Locale(identifier: "xx_XX"))
    try controller.startRecording()
    XCTAssertEqual(controller.recognitionState, .unavailable)
    XCTAssertFalse(controller.isRecording)
    XCTAssertEqual(controller.transcript, "")
  }

  // MARK: - SpeechRecognitionState equality

  func testSpeechRecognitionStateEquality() {
    XCTAssertEqual(SpeechRecognitionState.idle, .idle)
    XCTAssertEqual(SpeechRecognitionState.recording, .recording)
    XCTAssertEqual(SpeechRecognitionState.permissionDenied, .permissionDenied)
    XCTAssertEqual(SpeechRecognitionState.unavailable, .unavailable)
    XCTAssertEqual(SpeechRecognitionState.failed("oops"), .failed("oops"))
    XCTAssertNotEqual(SpeechRecognitionState.failed("a"), .failed("b"))
    XCTAssertNotEqual(SpeechRecognitionState.idle, .recording)
  }

  // MARK: - MockSpeechRecognizer (protocol conformance tests)

  func testMockRecognizerStartSetsRecordingState() throws {
    let mock = MockSpeechRecognizer()
    XCTAssertFalse(mock.isRecording)
    XCTAssertEqual(mock.recognitionState, .idle)

    try mock.startRecording()

    XCTAssertTrue(mock.isRecording)
    XCTAssertTrue(mock.startRecordingCalled)
    XCTAssertEqual(mock.recognitionState, .recording)
  }

  func testMockRecognizerStopClearsRecordingState() throws {
    let mock = MockSpeechRecognizer()
    try mock.startRecording()

    mock.stopRecording()

    XCTAssertFalse(mock.isRecording)
    XCTAssertTrue(mock.stopRecordingCalled)
    XCTAssertEqual(mock.recognitionState, .idle)
  }

  func testMockRecognizerRequestPermissionsSetsFlag() async {
    let mock = MockSpeechRecognizer()
    await mock.requestPermissions()
    XCTAssertTrue(mock.requestPermissionsCalled)
  }

  func testMockRecognizerPropagatesStartError() {
    let mock = MockSpeechRecognizer()
    mock.startRecordingError = NSError(domain: "test", code: -1, userInfo: [NSLocalizedDescriptionKey: "test error"])

    XCTAssertThrowsError(try mock.startRecording()) { error in
      XCTAssertEqual((error as NSError).domain, "test")
    }
    XCTAssertFalse(mock.isRecording)
    XCTAssertFalse(mock.startRecordingCalled)
  }
}

// MARK: - MockSpeechRecognizer

/// Lightweight test double that conforms to `SpeechTranscribing`.
@MainActor
final class MockSpeechRecognizer: SpeechTranscribing {
  var transcript: String = ""
  var isRecording: Bool = false
  var recognitionState: SpeechRecognitionState = .idle

  var requestPermissionsCalled = false
  var startRecordingCalled = false
  var stopRecordingCalled = false
  var startRecordingError: Error?

  func requestPermissions() async {
    requestPermissionsCalled = true
  }

  func startRecording() throws {
    if let error = startRecordingError {
      throw error
    }
    startRecordingCalled = true
    isRecording = true
    recognitionState = .recording
  }

  func stopRecording() {
    stopRecordingCalled = true
    isRecording = false
    recognitionState = .idle
  }
}
#endif
