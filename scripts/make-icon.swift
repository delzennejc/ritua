import AppKit
import Foundation
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
  for factor in [1, 2] {
    let pixels = size * factor
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let transform = NSAffineTransform(); transform.scale(by: CGFloat(pixels) / 1024); transform.concat()
    NSColor(red: 141/255, green: 106/255, blue: 232/255, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 200, yRadius: 200).fill()
    NSColor.white.setStroke()
    let path = NSBezierPath(); path.lineWidth = 88; path.lineCapStyle = .round; path.lineJoinStyle = .round
    path.move(to: NSPoint(x: 350, y: 260)); path.line(to: NSPoint(x: 350, y: 760)); path.line(to: NSPoint(x: 510, y: 760))
    path.curve(to: NSPoint(x: 510, y: 510), controlPoint1: NSPoint(x: 725, y: 760), controlPoint2: NSPoint(x: 725, y: 510)); path.line(to: NSPoint(x: 350, y: 510))
    path.move(to: NSPoint(x: 510, y: 510)); path.line(to: NSPoint(x: 700, y: 260)); path.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let suffix = factor == 2 ? "@2x" : ""
    try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
  }
}
