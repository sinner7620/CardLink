import React from "react"

export function ReviewStartButton({ disabled, onStart }) {
  return <button type="button" className="reviewStartButton" disabled={disabled} onClick={() => { if (!disabled) void onStart() }}>开始复习</button>
}
