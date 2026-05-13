#if canImport(Speech)
import Foundation
import Speech
import AVFoundation

/// Observable state of the speech recognition pipeline.
public enum SpeechRecognitionState: Equatable, Sendable {
  /// No recording is in progress and no terminal error has occurred.
  case idle
  /// The microphone is active and audio is being transcribed.
  case recording
  /// The user denied microphone or speech-recognition permission.
  case permissionDenied
  /// Speech recognition is not available on this device or locale.
  case unavailable
  /// A recording or recognition error occurred; the associated value is a short description.
  case failed(String)
}

/// Abstraction over the speech-recognition pipeline used by `ChatView`.
/// Keeping the protocol separate from the concrete implementation lets tests
/// supply a lightweight fake without requiring real device permission dialogs.
@MainActor
public protocol SpeechTranscribing: AnyObject {
  /// Accumulated transcript for the current or most recent recording session.
  var transcript: String { get }
  /// `true` while the audio engine is actively capturing and transcribing speech.
  var isRecording: Bool { get }
  /// Current state of the recognition pipeline.
  var recognitionState: SpeechRecognitionState { get }
  /// Request microphone and speech-recognition permissions from the user.
  /// Has no effect when permissions have already been determined.
  func requestPermissions() async
  /// Start capturing audio and producing live transcription results.
  /// - Throws: If the audio engine cannot be started (e.g. audio session error).
  func startRecording() throws
  /// Stop capturing audio and finalise the transcript.
  func stopRecording()
}

/// Concrete speech-recognition controller backed by `SFSpeechRecognizer` and
/// `AVAudioEngine`.
///
/// Usage pattern (push-to-talk):
/// 1. Call `requestPermissions()` once before the first recording session.
/// 2. Call `startRecording()` when the user taps the mic button.
/// 3. Call `stopRecording()` when the user taps the mic button again.
/// 4. Observe `isRecording` transitioning to `false` and read `transcript`
///    to populate the prompt text field for user review before sending.
@MainActor
public final class SpeechRecognitionController: ObservableObject, SpeechTranscribing {
  @Published public private(set) var transcript: String = ""
  @Published public private(set) var isRecording: Bool = false
  @Published public private(set) var recognitionState: SpeechRecognitionState = .idle

  private let speechRecognizer: SFSpeechRecognizer?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private let audioEngine = AVAudioEngine()

  public init(locale: Locale = .current) {
    speechRecognizer = SFSpeechRecognizer(locale: locale)
  }

  // MARK: - Permissions

  /// Request microphone and speech-recognition authorisation from the user.
  /// When authorisation has already been determined this returns immediately
  /// without showing any system dialog.
  public func requestPermissions() async {
    // Speech recognition authorisation
    let speechStatus: SFSpeechRecognizerAuthorizationStatus
    if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
      speechStatus = await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
          continuation.resume(returning: status)
        }
      }
    } else {
      speechStatus = SFSpeechRecognizer.authorizationStatus()
    }

    guard speechStatus == .authorized else {
      recognitionState = .permissionDenied
      return
    }

    // Microphone authorisation
    let micPermission = AVAudioApplication.shared.recordPermission
    if micPermission == .undetermined {
      let granted: Bool = await withCheckedContinuation { continuation in
        AVAudioApplication.shared.requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      }
      if !granted {
        recognitionState = .permissionDenied
      }
    } else if micPermission == .denied {
      recognitionState = .permissionDenied
    }
  }

  // MARK: - Recording

  /// Begin recording audio and transcribing speech.
  ///
  /// Pre-conditions checked before starting:
  /// - A speech recogniser is available for the current locale.
  /// - Speech recognition and microphone permissions have been granted.
  ///
  /// - Throws: Any error thrown by `AVAudioSession` or `AVAudioEngine.start()`.
  public func startRecording() throws {
    guard let recognizer = speechRecognizer, recognizer.isAvailable else {
      recognitionState = .unavailable
      return
    }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      recognitionState = .permissionDenied
      return
    }
    guard AVAudioApplication.shared.recordPermission == .granted else {
      recognitionState = .permissionDenied
      return
    }

    // Cancel any previous task before starting a fresh one.
    recognitionTask?.cancel()
    recognitionTask = nil

    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
    try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    recognitionRequest = request

    // Begin recognition; the task callback is dispatched back to the main
    // actor so all state mutations stay on the expected executor.
    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      Task { @MainActor [weak self] in
        guard let self else { return }
        if let result {
          self.transcript = result.bestTranscription.formattedString
        }
        if let error {
          self.recognitionState = .failed(error.localizedDescription)
          self.finishRecording()
        } else if result?.isFinal == true {
          self.finishRecording()
        }
      }
    }

    // Capture `request` (not `self`) in the audio tap so the closure is safe
    // to call from the real-time audio thread without crossing actor boundaries.
    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
    }

    audioEngine.prepare()
    try audioEngine.start()

    transcript = ""
    isRecording = true
    recognitionState = .recording
  }

  /// Stop recording and finalise the transcript.
  /// Calling this while not recording is a no-op.
  public func stopRecording() {
    guard isRecording else { return }
    finishRecording()
  }

  // MARK: - Private

  private func finishRecording() {
    guard isRecording else { return }
    isRecording = false

    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    recognitionRequest?.endAudio()
    recognitionRequest = nil
    recognitionTask = nil

    if recognitionState == .recording {
      recognitionState = .idle
    }

    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
#endif
