import { Insets, Size } from "../common/types"
import { computeScale, Fit } from "../util/fit"
import { PageManager } from "./page-manager"
import { ViewportStringBuilder } from "../util/viewport"
import { AreaManager } from "./area-manager"
import { GesturesDetector } from "../common/gestures"
import { TapEvent } from "../common/events"

export class SingleAreaManager {
  private readonly metaViewport: HTMLMetaElement

  private readonly page: PageManager

  private fit: Fit = Fit.Contain

  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

  private viewport?: Size

  private scale: number = 1

  constructor(
    window: Window,
    iframe: HTMLIFrameElement,
    metaViewport: HTMLMetaElement,
    listener: AreaManager.Listener
  ) {
    const wrapperGesturesListener = {
      onTap: (event: MouseEvent) => {
        console.log(`metaViewport ${metaViewport.content}`)
        const docElement = window.document.documentElement
        console.log(
          `docElement ${docElement.scrollLeft} ${docElement.scrollTop}`
        )
        console.log(`scale ${window.visualViewport?.scale}`)
        console.log(
          `visualviewport ${window.visualViewport?.width} ${window.visualViewport?.height}`
        )

        const tapEvent = {
          x:
            (event.clientX * this.scale) /
            (window.visualViewport!.scale * this.scale),
          y:
            (event.clientY * this.scale) /
            (window.visualViewport!.scale * this.scale),
        }
        listener.onTap(tapEvent)
      },
    }
    new GesturesDetector(window, wrapperGesturesListener)

    this.metaViewport = metaViewport
    const pageListener = {
      onIframeLoaded: () => {
        this.onIframeLoaded()
      },
      onTap: (event: TapEvent) => {
        const docElement = window.document.documentElement
        console.log(
          `docElement ${docElement.scrollLeft} ${docElement.scrollTop}`
        )
        console.log(`scale ${window.visualViewport?.scale}`)
        console.log(
          `visualviewport ${window.visualViewport?.width} ${window.visualViewport?.height}`
        )
        const boundingRect = iframe.getBoundingClientRect()
        console.log(`boundingRect $} ${boundingRect.left} ${boundingRect.top}`)
        const tapEvent = {
          x:
            ((event.x + boundingRect.left) * this.scale) /
            (window.visualViewport!.scale * this.scale),
          y:
            ((event.y + boundingRect.top) * this.scale) /
            (window.visualViewport!.scale * this.scale),
        }
        listener.onTap(tapEvent)
      },
    }
    this.page = new PageManager(window, iframe, pageListener)
  }

  setViewport(viewport: Size, insets: Insets) {
    if (this.viewport == viewport && this.insets == insets) {
      return
    }

    this.viewport = viewport
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

  loadResource(url: string) {
    this.page.hide()
    this.page.loadPage(url)
  }

  private onIframeLoaded() {
    if (!this.page.size) {
      // FIXME: raise error
    } else {
      this.layout()
    }
  }

  private layout() {
    if (!this.page.size || !this.viewport) {
      return
    }

    const margins = {
      top: this.insets.top,
      right: this.insets.right,
      bottom: this.insets.bottom,
      left: this.insets.left,
    }
    this.page.setMargins(margins)

    const safeDrawingSize = {
      width: this.viewport.width - this.insets.left - this.insets.right,
      height: this.viewport.height - this.insets.top - this.insets.bottom,
    }
    const scale = computeScale(this.fit, this.page.size, safeDrawingSize)
    this.metaViewport.content = new ViewportStringBuilder()
      .setInitialScale(scale)
      .setMinimumScale(scale)
      .setWidth(this.page.size.width)
      .setHeight(this.page.size.height)
      .build()

    this.scale = scale

    this.page.show()
  }
}
