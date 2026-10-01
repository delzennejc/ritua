/** Shared by Yesterday's review handoff and Home's reversible review checks. */
export function animateReviewCheck(root) {
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return []
  const animations = []
  const animate = (element, frames, duration, delay = 0) => {
    if (!element) return
    animations.push(
      element.animate(frames, {
        duration,
        delay,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      }),
    )
  }
  animate(
    root.querySelector('.review-check-icon'),
    [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(.8) rotate(-8deg)', offset: 0.15 },
      { transform: 'scale(1.3) rotate(5deg)', offset: 0.48 },
      { transform: 'scale(.96) rotate(0deg)', offset: 0.78 },
      { transform: 'scale(1) rotate(0deg)' },
    ],
    460,
  )
  animate(
    root.querySelector('.review-check-ring'),
    [
      { opacity: 0, transform: 'scale(.8)' },
      { opacity: 0.45, offset: 0.2 },
      { opacity: 0, transform: 'scale(1.9)' },
    ],
    380,
    70,
  )
  root.querySelectorAll('.review-check-spark').forEach((spark) => {
    animate(
      spark,
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0)' },
        { opacity: 0.8, offset: 0.25 },
        {
          opacity: 0,
          transform: 'translate(calc(-50% + var(--burst-x)), calc(-50% + var(--burst-y))) scale(1)',
        },
      ],
      340,
      100,
    )
  })
  return animations
}
