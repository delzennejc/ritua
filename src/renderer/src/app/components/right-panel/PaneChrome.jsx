export function UtilityPaneToolbar({ children }) {
  return (
    <div className="utility-pane-toolbar day-summary-header" aria-hidden={children ? undefined : true}>
      {children}
    </div>
  )
}

export function UtilityPaneHeading({ icon: Icon, title, children }) {
  return (
    <header className="utility-pane-heading">
      <span className="utility-pane-heading-title">
        {Icon ? <Icon size={20} /> : null}
        <h2>{title}</h2>
      </span>
      {children}
    </header>
  )
}
