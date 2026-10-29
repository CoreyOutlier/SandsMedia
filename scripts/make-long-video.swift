import Foundation
import AVFoundation
import CoreVideo

// Synthetic one-frame-per-second footage. No existing image or patient data.
guard CommandLine.arguments.count == 3,
      let seconds = Int(CommandLine.arguments[2]), seconds > 180, seconds <= 7201 else {
    print("FIXTURE_ARGUMENTS_INVALID"); exit(1)
}
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let writer: AVAssetWriter
do { writer = try AVAssetWriter(outputURL: output, fileType: .mp4) }
catch { print("FIXTURE_CREATE_FAILED"); exit(1) }
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: 320, AVVideoHeightKey: 240,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 20000,
        AVVideoExpectedSourceFrameRateKey: 1, AVVideoMaxKeyFrameIntervalKey: 30]
])
let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
    sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 240])
writer.add(input)
guard writer.startWriting() else { print("FIXTURE_START_FAILED_\((writer.error as NSError?)?.code ?? 0)"); exit(1) }
writer.startSession(atSourceTime: .zero)
for n in 0..<seconds {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
    var buffer: CVPixelBuffer?
    guard CVPixelBufferCreate(nil, 320, 240, kCVPixelFormatType_32ARGB, nil, &buffer) == kCVReturnSuccess,
          let frame = buffer else { print("FIXTURE_BUFFER_FAILED"); exit(1) }
    CVPixelBufferLockBaseAddress(frame, [])
    memset(CVPixelBufferGetBaseAddress(frame), Int32(80 + (n % 60)), CVPixelBufferGetDataSize(frame))
    CVPixelBufferUnlockBaseAddress(frame, [])
    guard adapter.append(frame, withPresentationTime: CMTime(value: Int64(n), timescale: 1)) else {
        print("FIXTURE_WRITE_FAILED"); exit(1)
    }
}
writer.endSession(atSourceTime: CMTime(value: Int64(seconds), timescale: 1))
input.markAsFinished()
let group = DispatchGroup(); group.enter()
writer.finishWriting { group.leave() }; group.wait()
guard writer.status == .completed else { print("FIXTURE_FINISH_FAILED"); exit(1) }
let asset = AVURLAsset(url: output)
guard abs(CMTimeGetSeconds(asset.duration) - Double(seconds)) < 0.001 else {
    print("FIXTURE_DURATION_FAILED"); exit(1)
}
print("Synthetic long-video fixture ready; duration \(seconds) seconds.")
