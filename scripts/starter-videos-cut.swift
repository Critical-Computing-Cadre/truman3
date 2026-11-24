// Cuts the Short video starter's clips from NASA's videos (ADR 95): a stretch of each, made tall
// for a phone, with the original sound replaced by a soft chord this script writes. NASA's
// footage is public domain, but its videos sometimes use licensed music, so none of theirs is kept.
// macOS only, since it uses Apple's own video tools. To remake one:
//
//   swiftc -O scripts/starter-videos-cut.swift -o /tmp/cut
//   /tmp/cut <in.mp4> <out.mp4> <start s> <end s> <crop:x | fit> <note in Hz> [width x height]
//
// `crop:0.5` takes a tall slice centred halfway across, `crop:0.3` one further left, and
// `crop:0.5:0.9` the same zoomed out a little. `fit` keeps the whole picture, on black.
// The size is 540x960 unless given. Where each one came from is in each starter's CREDITS.md:
// studies/starters/short-video and studies/starters/video-platform.
import AVFoundation
import CoreGraphics
import Foundation

let a = CommandLine.arguments
let input = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let out = URL(fileURLWithPath: a[2])
let start = Double(a[3])!, end = Double(a[4])!
let mode = a[5]
let baseHz = Double(a[6])!
// Tall for a phone unless a size is given, such as 640x360 for the Video platform sample.
let size = a.count > 7 ? a[7].split(separator: "x").map { Int($0)! } : [540, 960]
let width = size[0], height = size[1], fps = 30
try? FileManager.default.removeItem(at: out)

let source = input.tracks(withMediaType: .video)[0]
let natural = source.naturalSize.applying(source.preferredTransform)
let w = abs(natural.width), h = abs(natural.height)

// Where the picture goes in the tall frame.
var transform = source.preferredTransform
if mode == "fit" {
  let scale = CGFloat(width) / w
  transform = transform.concatenating(CGAffineTransform(scaleX: scale, y: scale))
    .concatenating(CGAffineTransform(translationX: 0, y: (CGFloat(height) - h * scale) / 2))
} else {
  let parts = mode.split(separator: ":")
  let x = CGFloat(Double(parts[1])!)
  // A third part zooms out from filling the height, so a whole planet fits, with black above and below.
  let zoom = parts.count > 2 ? CGFloat(Double(parts[2])!) : 1
  let scale = CGFloat(height) / h * zoom
  let shown = CGFloat(width) / scale
  let left = min(max(x * w - shown / 2, 0), w - shown)
  transform = transform.concatenating(CGAffineTransform(translationX: -left, y: 0))
    .concatenating(CGAffineTransform(scaleX: scale, y: scale))
    .concatenating(CGAffineTransform(translationX: 0, y: (CGFloat(height) - h * scale) / 2))
}

let composition = AVMutableVideoComposition()
composition.renderSize = CGSize(width: width, height: height)
composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
let instruction = AVMutableVideoCompositionInstruction()
instruction.timeRange = CMTimeRange(start: .zero, duration: input.duration)
instruction.backgroundColor = CGColor(red: 0, green: 0, blue: 0, alpha: 1)
let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: source)
layer.setTransform(transform, at: .zero)
instruction.layerInstructions = [layer]
composition.instructions = [instruction]

let reader = try! AVAssetReader(asset: input)
let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600),
  end: CMTime(seconds: end, preferredTimescale: 600))
reader.timeRange = range
let frames = AVAssetReaderVideoCompositionOutput(videoTracks: [source], videoSettings: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
])
frames.videoComposition = composition
reader.add(frames)
reader.startReading()

let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: width > height ? 450_000 : 750_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
  ],
])
let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
  AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1,
  AVEncoderBitRateKey: 64000,
])
writer.add(video)
writer.add(audio)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let seconds = end - start
let rate = 44100.0
let ratios: [[Double]] = [[1, 1.25, 1.5], [0.8909, 1.1225, 1.3348], [0.75, 0.9439, 1.1225], [0.8409, 1.0, 1.2599]]
var format = AudioStreamBasicDescription(mSampleRate: rate, mFormatID: kAudioFormatLinearPCM,
  mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, mBytesPerPacket: 2,
  mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
var description: CMAudioFormatDescription?
CMAudioFormatDescriptionCreate(allocator: nil, asbd: &format, layoutSize: 0, layout: nil, magicCookieSize: 0,
  magicCookie: nil, extensions: nil, formatDescriptionOut: &description)
let totalSamples = Int(seconds * rate)
var written = 0
var videoDone = false, audioDone = false
while !videoDone || !audioDone {
  var progressed = false
  if !videoDone && video.isReadyForMoreMediaData {
    if let sample = frames.copyNextSampleBuffer() {
      let time = CMTimeSubtract(CMSampleBufferGetPresentationTimeStamp(sample), range.start)
      var timing = CMSampleTimingInfo(duration: CMSampleBufferGetDuration(sample), presentationTimeStamp: time,
        decodeTimeStamp: .invalid)
      var shifted: CMSampleBuffer?
      CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: 1,
        sampleTimingArray: &timing, sampleBufferOut: &shifted)
      video.append(shifted!)
    } else {
      video.markAsFinished()
      videoDone = true
    }
    progressed = true
  }
  if !audioDone && audio.isReadyForMoreMediaData {
    let count = min(4410, totalSamples - written)
    var samples = [Int16](repeating: 0, count: count)
    for i in 0..<count {
      let s = Double(written + i) / rate
      let chord = ratios[Int(s / 3) % ratios.count]
      let swell = 0.6 + 0.4 * sin(.pi * s / 3)
      let fade = min(1, s / 0.5, (seconds - s) / 0.8)
      var v = 0.0
      for r in chord { v += sin(2 * .pi * baseHz * r * s) + 0.3 * sin(4 * .pi * baseHz * r * s) }
      samples[i] = Int16(max(-1, min(1, v / 4 * 0.3 * swell * fade)) * 32767)
    }
    var block: CMBlockBuffer?
    CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: count * 2, blockAllocator: nil,
      customBlockSource: nil, offsetToData: 0, dataLength: count * 2, flags: kCMBlockBufferAssureMemoryNowFlag,
      blockBufferOut: &block)
    samples.withUnsafeBytes {
      CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0,
        dataLength: count * 2)
    }
    var sample: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block!,
      formatDescription: description!, sampleCount: count,
      presentationTimeStamp: CMTime(value: CMTimeValue(written), timescale: CMTimeScale(rate)),
      packetDescriptions: nil, sampleBufferOut: &sample)
    audio.append(sample!)
    written += count
    if written >= totalSamples { audio.markAsFinished(); audioDone = true }
    progressed = true
  }
  if writer.status == .failed || reader.status == .failed {
    print("failed: \(String(describing: writer.error ?? reader.error))")
    exit(1)
  }
  if !progressed { usleep(1000) }
}
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print("wrote \(out.lastPathComponent)")
