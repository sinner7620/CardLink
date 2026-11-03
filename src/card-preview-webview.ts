import { mountCardPreview } from "./card-preview"
import Panzoom from "@panzoom/panzoom"

declare const window: any
window.__mnMountCardPreview = () => mountCardPreview(window, Panzoom)
if (window.document.querySelector(".card")) window.__mnMountCardPreview()
