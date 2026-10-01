export function ReviewCheckVisual({ children }) {
  return (
    <>
      <span className="review-check-ring" aria-hidden="true" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <span
          key={angle}
          className="review-check-spark"
          aria-hidden="true"
          style={{
            '--burst-x': `${Math.cos((angle * Math.PI) / 180) * 22}px`,
            '--burst-y': `${Math.sin((angle * Math.PI) / 180) * 22}px`,
          }}
        />
      ))}
      <span className="review-check-icon" aria-hidden="true">
        {children}
      </span>
    </>
  )
}
