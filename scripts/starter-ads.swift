// Sample pre-roll ads for the Video platform starter (ADR 97), drawn here for made-up advertisers so
// there's nothing to license and nobody real seems to be advertising: a gradient, a shape that
// moves, the ad's words, and a soft chord. macOS only, since it uses Apple's own video tools.
//
//   swiftc -O scripts/starter-ads.swift -o /tmp/starter-ads
//   /tmp/starter-ads <out.mp4> <seconds> <top color> <bottom color> <shape color> <motion:shape> "<line/line>" <note in Hz> [width x height]
//
// The two in studies/starters/video-platform/media/posts:
//   ad-coffee  12 8b5a2b 2b1a10 f5deb3 rise:ball  "Hollowbean Coffee/slow mornings, bold cups"  196 640x360
//   ad-phone   10 1e3a8a 0f172a 60a5fa orbit:star "Zephyr Talk/unlimited calls, one flat price" 262 640x360
import AVFoundation
import CoreGraphics
import CoreText
import Foundation

let a = CommandLine.arguments
let out = URL(fileURLWithPath: a[1])
let seconds = Double(a[2])!
func color(_ hex: String) -> CGColor {
  let v = UInt32(hex, radix: 16)!
  return CGColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}
let top = color(a[3]), bottom = color(a[4])
let shapeColor = a[5], motion = a[6], caption = a[7]
let baseHz = Double(a[8])!
let size = a.count > 9 ? a[9].split(separator: "x").map { Int($0)! } : [720, 1280]
let width = size[0], height = size[1], fps = 24
try? FileManager.default.removeItem(at: out)

let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 450_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
])
writer.add(video)
let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
  AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000,
])
writer.add(audio)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func line(_ text: String, size: CGFloat, weight: CGFloat = 0.4) -> CTLine {
  let font = CTFontCreateWithName("Helvetica Neue" as CFString, size, nil)
  let bold = CTFontCreateCopyWithSymbolicTraits(font, size, nil, weight > 0.3 ? .traitBold : [], .traitBold) ?? font
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): bold,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 1),
  ]
  return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
}
// The figure: "ball", "sun", "drop", or "star", in the color given as the fifth argument.
let accent = color(shapeColor.count == 6 ? shapeColor : "ffd166")
let shape = motion.contains(":") ? String(motion.split(separator: ":")[1]) : "ball"
let move = String(motion.split(separator: ":")[0])
func figure(_ c: CGContext, _ r: CGFloat) {
  c.setFillColor(accent)
  switch shape {
  case "sun":
    for k in 0..<12 {
      c.saveGState(); c.rotate(by: CGFloat(k) * .pi / 6)
      c.fill(CGRect(x: -r * 0.08, y: r * 1.1, width: r * 0.16, height: r * 0.45)); c.restoreGState()
    }
    c.fillEllipse(in: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
  case "drop":
    c.move(to: CGPoint(x: 0, y: r * 1.4))
    c.addCurve(to: CGPoint(x: 0, y: -r), control1: CGPoint(x: r * 1.3, y: 0), control2: CGPoint(x: r, y: -r))
    c.addCurve(to: CGPoint(x: 0, y: r * 1.4), control1: CGPoint(x: -r, y: -r), control2: CGPoint(x: -r * 1.3, y: 0))
    c.fillPath()
  case "star":
    for k in 0..<10 {
      let rr = k % 2 == 0 ? r * 1.2 : r * 0.5
      let p = CGPoint(x: rr * sin(CGFloat(k) * .pi / 5), y: rr * cos(CGFloat(k) * .pi / 5))
      if k == 0 { c.move(to: p) } else { c.addLine(to: p) }
    }
    c.closePath(); c.fillPath()
  default:
    c.fillEllipse(in: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
    c.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.35))
    c.fillEllipse(in: CGRect(x: -r * 0.55, y: r * 0.15, width: r * 0.6, height: r * 0.4))
  }
}
// Sizes were set for 720 across; a smaller picture scales them down.
let unit = Double(min(width, height)) / 720
let words = caption.split(separator: "/").map { line(String($0), size: CGFloat(48 * unit)) }

// Music: a soft chord that changes every two seconds, with a gentle pulse.
let rate = 44100.0
let ratios: [[Double]] = [[1, 1.25, 1.5], [0.8909, 1.1225, 1.3348], [0.75, 0.9439, 1.1225], [0.8409, 1.0, 1.2599]]
var format = AudioStreamBasicDescription(mSampleRate: rate, mFormatID: kAudioFormatLinearPCM,
  mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, mBytesPerPacket: 2,
  mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
var description: CMAudioFormatDescription?
CMAudioFormatDescriptionCreate(allocator: nil, asbd: &format, layoutSize: 0, layout: nil, magicCookieSize: 0,
  magicCookie: nil, extensions: nil, formatDescriptionOut: &description)

let frames = Int(seconds * Double(fps))
let totalSamples = Int(seconds * rate)
var frame = 0, written = 0
var videoDone = false, audioDone = false
while !videoDone || !audioDone {
  var progressed = false
  if !videoDone && video.isReadyForMoreMediaData {
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    CVPixelBufferLockBaseAddress(buffer!, [])
    let c = CGContext(data: CVPixelBufferGetBaseAddress(buffer!), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer!), space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    let t = Double(frame) / Double(fps)
    let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [bottom, top] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: height), options: [])
    // Drifting small copies in the background.
    c.saveGState()
    c.setAlpha(0.25)
    for i in 0..<9 {
      let x = Double((i * 233) % width) + 30 * sin(t * 0.7 + Double(i))
      let y = (Double(i) * 160 + t * 60).truncatingRemainder(dividingBy: Double(height + 100)) - 50
      c.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
      c.fillEllipse(in: CGRect(x: x, y: y, width: 26 * unit, height: 26 * unit))
    }
    c.restoreGState()
    // The main figure.
    var x = Double(width) / 2, y = Double(height) * 0.5, angle = 0.0, scale = 1.0
    switch move {
    case "bounce": y += abs(sin(t * 3)) * 220 - 60
    case "orbit": x += cos(t * 1.6) * 170; y += sin(t * 1.6) * 170
    case "rise": y = Double(height) * 0.25 + (t / seconds) * Double(height) * 0.45
    case "sway": angle = sin(t * 2) * 0.35; x += sin(t * 2) * 60
    case "spin": angle = t * 1.4
    default: scale = 1 + 0.15 * sin(t * 4)
    }
    c.saveGState()
    c.translateBy(x: x, y: y)
    c.rotate(by: angle)
    c.scaleBy(x: scale, y: scale)
    figure(c, CGFloat(120 * unit))
    c.restoreGState()
    // The caption, as people put on short videos: white bold lines on a dark band.
    let shown = min(words.count, 1 + Int(t / 1.2))
    for (i, w) in words.prefix(shown).enumerated() {
      let b = CTLineGetBoundsWithOptions(w, [])
      let ly = Double(height) * 0.8 - Double(i) * 70 * unit
      c.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 0.55))
      c.fill(CGRect(x: (Double(width) - b.width) / 2 - 18 * unit, y: ly - 16 * unit, width: b.width + 36 * unit, height: 66 * unit))
      c.textPosition = CGPoint(x: (Double(width) - b.width) / 2, y: ly)
      CTLineDraw(w, c)
    }
    CVPixelBufferUnlockBaseAddress(buffer!, [])
    adaptor.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(fps)))
    frame += 1
    if frame >= frames { video.markAsFinished(); videoDone = true }
    progressed = true
  }
  if !audioDone && audio.isReadyForMoreMediaData {
    let count = min(4410, totalSamples - written)
    var samples = [Int16](repeating: 0, count: count)
    for i in 0..<count {
      let s = Double(written + i) / rate
      let chord = ratios[Int(s / 2) % ratios.count]
      let pulse = 0.55 + 0.45 * pow(sin(.pi * (s * 2).truncatingRemainder(dividingBy: 1)), 2)
      let fade = min(1, s / 0.3, (seconds - s) / 0.5)
      var v = 0.0
      for r in chord { v += sin(2 * .pi * baseHz * r * s) }
      samples[i] = Int16(max(-1, min(1, v / 3 * 0.32 * pulse * fade)) * 32767)
    }
    var block: CMBlockBuffer?
    CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: count * 2, blockAllocator: nil,
      customBlockSource: nil, offsetToData: 0, dataLength: count * 2, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
    samples.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: count * 2) }
    var sample: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block!, formatDescription: description!,
      sampleCount: count, presentationTimeStamp: CMTime(value: CMTimeValue(written), timescale: CMTimeScale(rate)),
      packetDescriptions: nil, sampleBufferOut: &sample)
    audio.append(sample!)
    written += count
    if written >= totalSamples { audio.markAsFinished(); audioDone = true }
    progressed = true
  }
  if writer.status == .failed { print("failed: \(String(describing: writer.error))"); exit(1) }
  if !progressed { usleep(1000) }
}
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print("wrote \(out.lastPathComponent)")
