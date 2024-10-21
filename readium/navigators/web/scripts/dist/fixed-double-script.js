!function(){"use strict";class t{constructor(t,e,i){if(this.margins={top:0,right:0,bottom:0,left:0},this.channel=new MessageChannel,!e.contentWindow)throw Error("Iframe argument must have been attached to DOM.");this.listener=i,this.iframe=e,this.iframe.addEventListener("load",(()=>{this.onIframeLoaded()}))}show(){this.iframe.style.display="unset"}hide(){this.iframe.style.display="none"}setMargins(t){this.margins!=t&&(this.iframe.style.marginTop=this.margins.top+"px",this.iframe.style.marginLeft=this.margins.left+"px",this.iframe.style.marginBottom=this.margins.bottom+"px",this.iframe.style.marginRight=this.margins.right+"px")}loadPage(t){this.iframe.src=t}setPlaceholder(t){this.iframe.style.width=t.width+"px",this.iframe.style.height=t.height+"px",this.size=t}onIframeLoaded(){const t=this.iframe.contentWindow.document.querySelector("meta[name=viewport]");if(!t||t instanceof HTMLMetaElement)return;const e=this.parsePageSize(t);e&&(this.iframe.style.width=e.width+"px",this.iframe.style.height=e.height+"px",this.size=e,this.channel.port1.onmessage=t=>{console.log(`onmessage ${t}`),this.onMessageFromIframe(t)},this.iframe.contentWindow.postMessage("Init","*",[this.channel.port2]),this.listener.onIframeLoaded())}onMessageFromIframe(t){t.data.x&&t.data.y?this.listener.onTap({x:t.data.x,y:t.data.y}):t.data.href&&this.listener.onLinkActivated(t.data.href)}parsePageSize(t){const e=/(\w+) *= *([^\s,]+)/g,i=new Map;let s;for(;s=e.exec(t.content);)null!=s&&i.set(s[1],s[2]);const n=parseFloat(i.get("width")),h=parseFloat(i.get("height"));return n&&h?{width:n,height:h}:void 0}}class e{setInitialScale(t){return this.initialScale=t,this}setMinimumScale(t){return this.minimumScale=t,this}setWidth(t){return this.width=t,this}setHeight(t){return this.height=t,this}build(){const t=[];return this.initialScale&&t.push("initial-scale="+this.initialScale),this.minimumScale&&t.push("minimum-scale="+this.minimumScale),this.width&&t.push("width="+this.width),this.height&&t.push("height="+this.height),t.join(", ")}}class i{constructor(t,e){console.log(`Constructing Gesturesdetector for window ${t}`),this.window=t,this.listener=e,document.addEventListener("click",(t=>{console.log("onClick"),this.onClick(t)}),!1)}onClick(t){if(t.defaultPrevented)return;const e=this.window.getSelection();if(e&&"Range"==e.type)return;let i;i=t.target instanceof HTMLElement?this.nearestInteractiveElement(t.target):null,i?i instanceof HTMLAnchorElement&&this.listener.onLinkActivated(i.href):(console.log("tap detected"),this.listener.onTap(t)),t.stopPropagation(),t.preventDefault()}nearestInteractiveElement(t){return null==t?null:-1!=["a","audio","button","canvas","details","input","label","option","select","submit","textarea","video"].indexOf(t.nodeName.toLowerCase())||t.hasAttribute("contenteditable")&&"false"!=t.getAttribute("contenteditable").toLowerCase()?t:t.parentElement?this.nearestInteractiveElement(t.parentElement):null}}class s{constructor(e,s,n,h,a){this.fit="contain",this.insets={top:0,right:0,bottom:0,left:0},new i(e,{onTap:t=>{a.onTap({x:t.clientX,y:t.clientY})},onLinkActivated:t=>{throw Error("No interactive element in the root document.")}});const o={onIframeLoaded:()=>{this.layout()},onTap:t=>{a.onTap(t)},onLinkActivated:t=>{a.onLinkActivated(t)}};this.leftPage=new t(e,s,o),this.rightPage=new t(e,n,o),this.metaViewport=h}loadSpread(t){this.leftPage.hide(),this.rightPage.hide(),this.spread=t,t.left&&this.leftPage.loadPage(t.left),t.right&&this.rightPage.loadPage(t.right)}setViewport(t,e){this.viewport==t&&this.insets==e||(this.viewport=t,this.insets=e,this.layout())}setFit(t){this.fit!=t&&(this.fit=t,this.layout())}layout(){if(!this.viewport||!this.leftPage.size&&this.spread.left||!this.rightPage.size&&this.spread.right)return;const t={top:this.insets.top,right:0,bottom:this.insets.bottom,left:this.insets.left};this.leftPage.setMargins(t);const i={top:this.insets.top,right:this.insets.right,bottom:this.insets.bottom,left:0};this.rightPage.setMargins(i),this.spread.right?this.spread.left||this.leftPage.setPlaceholder(this.rightPage.size):this.rightPage.setPlaceholder(this.leftPage.size);const s=this.leftPage.size.width+this.rightPage.size.width,n=Math.max(this.leftPage.size.height,this.rightPage.size.height),h={width:s,height:n},a={width:this.viewport.width-this.insets.left-this.insets.right,height:this.viewport.height-this.insets.top-this.insets.bottom},o=function(t,e,i){switch(t){case"contain":return function(t,e){const i=e.width/t.width,s=e.height/t.height;return Math.min(i,s)}(e,i);case"width":return function(t,e){return e.width/t.width}(e,i);case"height":return function(t,e){return e.height/t.height}(e,i)}}(this.fit,h,a);this.metaViewport.content=(new e).setInitialScale(o).setMinimumScale(o).setWidth(s).setHeight(n).build(),this.leftPage.show(),this.rightPage.show()}}class n{constructor(t){this.nativeApi=t}onTap(t){this.nativeApi.onTap(JSON.stringify(t))}onLinkActivated(t){this.nativeApi.onLinkActivated(t)}}const h=document.getElementById("page-left"),a=document.getElementById("page-right"),o=document.querySelector("meta[name=viewport]");Window.prototype.doubleArea=new class{constructor(t,e,i,h,a){const o=new n(a);this.manager=new s(t,e,i,h,o)}loadSpread(t){this.manager.loadSpread(t)}setViewport(t,e,i,s,n,h){const a={width:t,height:e},o={top:i,left:h,bottom:n,right:s};this.manager.setViewport(a,o)}setFit(t){if("contain"!=t&&"width"!=t&&"height"!=t)throw Error(`Invalid fit value: ${t}`);this.manager.setFit(t)}}(window,h,a,o,window.gestures)}();
//# sourceMappingURL=fixed-double-script.js.map