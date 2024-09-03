
import { Size, Insets } from "../common/types"
import { computeScale, Fit } from "../util/fit"
import { PageManager } from "./page-manager"
import { ViewportStringBuilder } from "../util/viewport"

export class DoubleAreaManager {

  private readonly metaViewport: HTMLMetaElement

  private readonly leftPage: PageManager

  private readonly rightPage: PageManager

  private fit: Fit = Fit.Contain

  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

  private viewport?: Size

  constructor(
    leftIframe: HTMLIFrameElement,
    rightIframe: HTMLIFrameElement,
    metaViewport: HTMLMetaElement
  ) {
    const listener = { onIframeLoaded: () => { this.layout() } }
    this.leftPage = new PageManager(leftIframe, listener)
    this.rightPage = new PageManager(rightIframe, listener)
    this.metaViewport = metaViewport
  }

  loadSpread(spread: { left?: string, right?: string }) {
    this.leftPage.hide()
    this.rightPage.hide()

    if (spread.left) {
      this.leftPage.loadPage(spread.left)
    }
    if (spread.right) {
      this.rightPage.loadPage(spread.right)
    }
  }

  setViewport(size: Size, insets: Insets) {
    if (this.viewport == size && this.insets == insets) {
      return
    }

    this.viewport = size
    this.insets = insets
    this.layout()
  }

  setFit(fit: Fit) {
    if (this.fit == fit) {
      return
    }

    this.fit = fit
    this.layout()
  }

  private layout() {
    if (!this.viewport || (!this.leftPage.size && !this.rightPage.size)) {
      return
    }

    const leftMargins = { top: this.insets.top, right: 0, bottom: this.insets.bottom, left: this.insets.left }
    this.leftPage.setMargins(leftMargins)
    const rightMargins = { top: this.insets.top, right: this.insets.right, bottom: this.insets.bottom, left: 0 }
    this.rightPage.setMargins(rightMargins)

    const contentWidth = (this.leftPage.size?.width ?? 0) + (this.rightPage.size?.width ?? 0)
    const contentHeight = Math.max(this.leftPage.size?.height ?? 0, this.rightPage.size?.height ?? 0)
    const contentSize = { width: contentWidth, height: contentHeight }
    const scale = computeScale(this.fit, contentSize, this.viewport)

    this.metaViewport.content = new ViewportStringBuilder()
      .setInitialScale(scale)
      .setMinimumScale(scale)
      .setWidth(contentWidth)
      .setHeight(contentHeight)
      .build()

    this.leftPage.show()
    this.rightPage.show()
  }
}
