#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// Plays TTS audio fetched from the gateway.  Owns a single AVAudioPlayer so
/// starting a new utterance automatically stops the previous one — important
/// for auto-speak so we don't stack overlapping playback when several
/// assistant messages arrive in quick succession.
@MainActor
public final class TTSController: NSObject, ObservableObject, AVAudioPlayerDelegate {
  @Published public private(set) var isSpeaking: Bool = false
  @Published public private(set) var lastError: String?

  private var player: AVAudioPlayer?

  public override init() {
    super.init()
  }

  /// Play a previously-synthesized audio buffer.  Stops any in-flight playback
  /// first so callers can fire-and-forget without worrying about overlap.
  public func play(audio: Data, contentType: String?) {
    stop()
    do {
      #if canImport(UIKit)
      // Best-effort: route to the speaker/default output without forcing a
      // category change that might fail in unit tests or extensions.
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
      try? AVAudioSession.sharedInstance().setActive(true)
      #endif

      let newPlayer = try AVAudioPlayer(data: audio)
      newPlayer.delegate = self
      newPlayer.prepareToPlay()
      newPlayer.play()
      player = newPlayer
      isSpeaking = true
      lastError = nil
    } catch {
      lastError = error.localizedDescription
      isSpeaking = false
    }
  }

  /// Stop any in-flight playback.  Safe to call when nothing is playing.
  public func stop() {
    player?.stop()
    player = nil
    isSpeaking = false
  }

  // MARK: - AVAudioPlayerDelegate

  nonisolated public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
    Task { @MainActor in
      self.isSpeaking = false
      self.player = nil
    }
  }

  nonisolated public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    Task { @MainActor in
      self.lastError = error?.localizedDescription ?? "Audio decode error"
      self.isSpeaking = false
      self.player = nil
    }
  }
}
#endif
