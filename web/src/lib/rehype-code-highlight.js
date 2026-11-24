import { toText } from "hast-util-to-text"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import python from "highlight.js/lib/languages/python"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import { createLowlight } from "lowlight"
import { visit } from "unist-util-visit"

const highlighter = createLowlight({ bash, c, cpp, java, javascript, json, python, typescript, xml })

export default function rehypeCodeHighlight() {
  return tree => {
    visit(tree, "element", (node, _index, parent) => {
      if (node.tagName !== "code" || parent?.tagName !== "pre") return
      const classes = node.properties.className || []
      if (classes.includes("no-highlight") || classes.includes("nohighlight")) return
      const language = classes.find(name => /^(?:lang|language)-/.test(name))?.replace(/^(?:lang|language)-/, "")
      if (!language || !highlighter.registered(language)) return

      node.children = highlighter.highlight(language, toText(node, { whitespace: "pre" })).children
      node.properties.className = ["hljs", ...classes]
    })
  }
}
