import { shell } from 'electron'

// One indirection so automated runs can intercept link opening instead of
// launching the user's browser.
let opener: (url: string) => Promise<unknown> = (url) => shell.openExternal(url)

export function openExternalUrl(url: string) {
  return opener(url)
}

export function setExternalOpener(next: (url: string) => Promise<unknown>) {
  opener = next
}
