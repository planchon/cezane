import AVFoundation
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

// MARK: - Helpers

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(Data("error: \(msg)\n".utf8))
    exit(1)
}

func say(_ s: String) {
    print(s)
    fflush(stdout)
}

let usage = """
usage:
  cezane-vision cutout <input.mp4> <output.webm> [--quality fast|balanced|accurate] [--fps N]
  cezane-vision mask-image <input.(jpg|png)> <output.png> [--quality fast|balanced|accurate]
"""

func parseQuality(_ s: String) -> VNGeneratePersonSegmentationRequest.QualityLevel {
    switch s {
    case "fast": return .fast
    case "balanced": return .balanced
    case "accurate": return .accurate
    default: fail("unknown quality '\(s)' (fast|balanced|accurate)")
    }
}

func makeRequest(_ q: VNGeneratePersonSegmentationRequest.QualityLevel) -> VNGeneratePersonSegmentationRequest {
    let r = VNGeneratePersonSegmentationRequest()
    r.qualityLevel = q
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return r
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
let ciContext = CIContext(options: [
    .workingColorSpace: sRGB,
    .outputColorSpace: sRGB,
    .cacheIntermediates: false,
])

/// Copy a OneComponent8 pixel buffer into a tight w*h byte array.
func readMask(_ pb: CVPixelBuffer, into out: inout [UInt8]) -> (Int, Int) {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    let bpr = CVPixelBufferGetBytesPerRow(pb)
    let base = CVPixelBufferGetBaseAddress(pb)!.assumingMemoryBound(to: UInt8.self)
    if out.count != w * h { out = [UInt8](repeating: 0, count: w * h) }
    out.withUnsafeMutableBufferPointer { dst in
        for y in 0..<h { memcpy(dst.baseAddress! + y * w, base + y * bpr, w) }
    }
    return (w, h)
}

/// Turn a low-res mask into a frame-sized, feathered CIImage; composite with the color image.
func composite(color: CIImage, mask: [UInt8], mw: Int, mh: Int, feather: Double) -> CIImage {
    let ext = color.extent
    let maskData = Data(mask)
    var m = CIImage(bitmapData: maskData, bytesPerRow: mw, size: CGSize(width: mw, height: mh),
                    format: .L8, colorSpace: nil)
    m = m.transformed(by: CGAffineTransform(scaleX: ext.width / CGFloat(mw), y: ext.height / CGFloat(mh)),
                      highQualityDownsample: true)
        .samplingLinear()
    // slight feather, then tighten contrast a touch so edges stay crisp but not jagged
    m = m.clampedToExtent().applyingGaussianBlur(sigma: feather).cropped(to: ext)
    let tighten = CIFilter(name: "CIColorMatrix", parameters: [
        kCIInputImageKey: m,
        "inputRVector": CIVector(x: 1.25, y: 0, z: 0, w: 0),
        "inputBiasVector": CIVector(x: -0.125, y: 0, z: 0, w: 0),
    ])!.outputImage!.applyingFilter("CIColorClamp")
    let clear = CIImage(color: .clear).cropped(to: ext)
    return color.applyingFilter("CIBlendWithMask", parameters: [
        kCIInputBackgroundImageKey: clear,
        kCIInputMaskImageKey: tighten,
    ]).unpremultiplyingAlpha()
}

// MARK: - cutout

func runCutout(_ args: [String]) async {
    var pos: [String] = []
    var quality = "balanced"
    var fpsOverride: Double? = nil
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--quality": i += 1; guard i < args.count else { fail("--quality needs a value") }; quality = args[i]
        case "--fps":
            i += 1
            guard i < args.count, let f = Double(args[i]), f > 0 else { fail("--fps needs a positive number") }
            fpsOverride = f
        default: pos.append(args[i])
        }
        i += 1
    }
    guard pos.count == 2 else { fail("cutout needs <input> <output>\n\(usage)") }
    let inURL = URL(fileURLWithPath: pos[0]), outPath = pos[1]
    guard FileManager.default.fileExists(atPath: pos[0]) else { fail("input not found: \(pos[0])") }
    let q = parseQuality(quality)

    let asset = AVURLAsset(url: inURL)
    guard let track = try? await asset.loadTracks(withMediaType: .video).first else { fail("no video track") }
    let nominal = (try? await track.load(.nominalFrameRate)) ?? 30
    let duration = ((try? await asset.load(.duration)) ?? .zero).seconds
    let srcFps = Double(nominal > 0 ? nominal : 30)
    let outFps = fpsOverride ?? srcFps

    // Video composition applies preferredTransform so rotated clips come out upright.
    let comp: AVMutableVideoComposition
    do { comp = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: asset) }
    catch { fail("video composition: \(error)") }
    let size = comp.renderSize
    let W = Int(size.width) & ~1, H = Int(size.height) & ~1  // even dims for yuv420

    guard let reader = try? AVAssetReader(asset: asset) else { fail("cannot open reader") }
    let output = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
    ])
    output.videoComposition = comp
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else { fail("reader failed: \(reader.error?.localizedDescription ?? "?")") }

    // ffmpeg
    let ff = Process()
    ff.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
    ff.arguments = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "\(W)x\(H)",
                    "-r", String(outFps), "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                    "-b:v", "0", "-crf", "30", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8",
                    "-auto-alt-ref", "0", outPath]
    let pipe = Pipe()
    ff.standardInput = pipe
    do { try ff.run() } catch { fail("cannot start ffmpeg: \(error)") }
    signal(SIGPIPE, SIG_IGN)
    let sink = pipe.fileHandleForWriting

    let request = makeRequest(q)
    let seq = VNSequenceRequestHandler()
    var prev: [UInt8] = []
    var cur: [UInt8] = []
    var rgba = [UInt8](repeating: 0, count: W * H * 4)
    let t0 = Date()
    var written = 0
    var nextOut = 0.0
    let step = 1.0 / outFps
    var lastProgress = -1.0
    let feather = max(1.0, Double(W) / 700.0)

    while let sb = output.copyNextSampleBuffer() {
        autoreleasepool {
            let pts = CMSampleBufferGetPresentationTimeStamp(sb).seconds
            // fps resampling by timestamp
            if fpsOverride != nil {
                if pts + 1e-4 < nextOut { return }
                nextOut += step
                if pts > nextOut + step { nextOut = pts + step }
            }
            guard let pb = CMSampleBufferGetImageBuffer(sb) else { return }
            do { try seq.perform([request], on: pb) } catch { fail("vision: \(error)") }
            guard let res = request.results?.first, let mpb = Optional(res.pixelBuffer) else { fail("no mask") }
            let (mw, mh) = readMask(mpb, into: &cur)
            if prev.count == cur.count {
                // EMA: 65% new, 35% previous
                for k in 0..<cur.count {
                    cur[k] = UInt8((Int(cur[k]) * 166 + Int(prev[k]) * 90 + 128) >> 8)
                }
            }
            prev = cur
            var color = CIImage(cvPixelBuffer: pb)
            color = color.cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
            let img = composite(color: color, mask: cur, mw: mw, mh: mh, feather: feather)
            rgba.withUnsafeMutableBytes { p in
                ciContext.render(img, toBitmap: p.baseAddress!, rowBytes: W * 4,
                                 bounds: CGRect(x: 0, y: 0, width: W, height: H),
                                 format: .RGBA8, colorSpace: sRGB)
            }
            do { try sink.write(contentsOf: rgba) } catch { fail("ffmpeg pipe closed") }
            written += 1
            let prog = duration > 0 ? min(1, pts / duration) : 0
            if prog - lastProgress >= 0.01 {
                lastProgress = prog
                say(String(format: "progress %.3f", prog))
            }
        }
    }
    if reader.status == .failed { fail("read error: \(reader.error?.localizedDescription ?? "?")") }
    try? sink.close()
    ff.waitUntilExit()
    guard ff.terminationStatus == 0 else { fail("ffmpeg exited with \(ff.terminationStatus)") }
    say("progress 1.000")
    say(String(format: "done %d %.2f", written, Date().timeIntervalSince(t0)))
}

// MARK: - mask-image

func runMaskImage(_ args: [String]) {
    var pos: [String] = []
    var quality = "accurate"
    var i = 0
    while i < args.count {
        if args[i] == "--quality" { i += 1; guard i < args.count else { fail("--quality needs a value") }; quality = args[i] }
        else { pos.append(args[i]) }
        i += 1
    }
    guard pos.count == 2 else { fail("mask-image needs <input> <output>\n\(usage)") }
    let inURL = URL(fileURLWithPath: pos[0]), outURL = URL(fileURLWithPath: pos[1])
    guard let src = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true]) else {
        fail("cannot read image \(pos[0])")
    }
    let ext = src.extent.integral
    let color = src.transformed(by: CGAffineTransform(translationX: -ext.minX, y: -ext.minY))
    let request = makeRequest(parseQuality(quality))
    let handler = VNImageRequestHandler(ciImage: color, options: [:])
    do { try handler.perform([request]) } catch { fail("vision: \(error)") }
    guard let res = request.results?.first else { fail("no mask") }
    var m: [UInt8] = []
    let (mw, mh) = readMask(res.pixelBuffer, into: &m)
    let img = composite(color: color, mask: m, mw: mw, mh: mh, feather: max(1.0, Double(ext.width) / 700.0))
    do {
        try ciContext.writePNGRepresentation(of: img, to: outURL, format: .RGBA8, colorSpace: sRGB)
    } catch { fail("write png: \(error)") }
    say("done 1 0")
}

// MARK: - main

let argv = Array(CommandLine.arguments.dropFirst())
guard let cmd = argv.first else { fail(usage) }
switch cmd {
case "cutout": await runCutout(Array(argv.dropFirst()))
case "mask-image": runMaskImage(Array(argv.dropFirst()))
default: fail("unknown command '\(cmd)'\n\(usage)")
}
