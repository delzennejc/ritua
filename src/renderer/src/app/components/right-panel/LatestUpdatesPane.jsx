import { CheckCircle, ClipboardText, Lightning } from '@phosphor-icons/react'

import { UtilityPaneToolbar } from './PaneChrome.jsx'
import { UtilityPaneHeading } from './PaneChrome.jsx'
const UPDATE_ICONS = {
  feature: Lightning,
  improvement: CheckCircle,
  announcement: ClipboardText,
}

const PRODUCT_UPDATES = []

export function LatestUpdatesPane({ toolbarContent }) {
  return (
    <div className="utility-pane updates-pane">
      <UtilityPaneToolbar>{toolbarContent}</UtilityPaneToolbar>
      <div className="utility-pane-content">
        <UtilityPaneHeading icon={Lightning} title="Latest Updates" />
        <p className="utility-pane-intro">What's new in Ritua</p>
        <ol className="latest-updates-list">
          {PRODUCT_UPDATES.map((update) => {
            const Icon = UPDATE_ICONS[update.type] || Lightning
            return (
              <li key={update.id}>
                <span className={`latest-update-icon ${update.type}`}>
                  <Icon size={15} />
                </span>
                <div>
                  <div className="latest-update-meta">
                    <span className={`latest-update-category ${update.type}`}>{update.category}</span>
                    <time dateTime={update.publishedAt}>{update.publishedLabel}</time>
                  </div>
                  <strong className="latest-update-title">{update.title}</strong>
                  <p>{update.detail}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
