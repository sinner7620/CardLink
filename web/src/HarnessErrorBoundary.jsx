import React from "react"

/**
 * Harness 面板错误边界（b16 修复）：
 * Harness 页面新增的组件（工具渲染/证据/设置）一旦在渲染期抛错，React 会卸载整棵树导致整页白屏
 * （b4/b5 同类事故）。此边界只包住 Harness 面板，失败时显示可读错误并保留其他页签可用。
 */
export class HarnessErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: "" }
  }

  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error) {
    // 只记录到控制台，便于真机日志导出；不吞掉错误信息。
    console.error("Harness 面板渲染失败:", error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="harness-ui">
          <div className="harnessCrash" role="alert">
            <strong>该面板渲染失败</strong>
            <p>错误：{this.state.error}</p>
            <p>可切换到其他页签继续使用；重新打开面板会重置该错误状态。</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
