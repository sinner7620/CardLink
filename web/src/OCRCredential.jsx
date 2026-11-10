import React, { useEffect, useRef, useState } from 'react'
import { Pencil, Check, Eye, EyeOff, X, Trash2 } from 'lucide'

export function OCRCredential({provider,credentialRef,credential,send,onSaved,onError,Morph}) {
  const [editing,setEditing]=useState(false),[visible,setVisible]=useState(false),[value,setValue]=useState(''),[working,setWorking]=useState(false)
  const current=useRef(credentialRef),input=useRef(null),sequence=useRef(0)
  current.current=credentialRef
  useEffect(()=>{sequence.current++;setEditing(false);setVisible(false);setValue('');setWorking(false);return()=>{sequence.current++}},[credentialRef])
  useEffect(()=>{if(editing)input.current?.focus()},[editing])
  async function read(edit){
    const ref=credentialRef,seq=++sequence.current;setWorking(true)
    try{const result=await send('ocrReadCredential',{credentialRef:ref});if(current.current!==ref||seq!==sequence.current)return;setValue(result.value||'');setVisible(!edit);setEditing(edit)}catch(error){onError(error)}finally{if(current.current===ref&&seq===sequence.current)setWorking(false)}
  }
  function cancel(){sequence.current++;setEditing(false);setVisible(false);setValue('')}
  async function confirm(){
    const ref=credentialRef;setWorking(true)
    try{const text=value.trim();await send(text?'ocrSetCredential':'ocrClearCredential',{credentialRef:ref,...(text?{value:text}:{})});if(current.current===ref){cancel();await onSaved()}}catch(error){onError(error)}finally{if(current.current===ref)setWorking(false)}
  }
  const masked=credential?.configured?`••••••••${credential.maskedSuffix||''}`:''
  return <div className="credential-row"><label className="credential-title" htmlFor="ocr-reference-key">{provider} <span>{provider==='MinerU'?'API Token':'API Key'}</span></label>
    <div className="secret"><div className="ocrKeyField"><input ref={input} id="ocr-reference-key" aria-label={`${provider} 密钥`} type={editing&&!visible?'password':'text'} value={editing||visible?value:masked} readOnly={!editing} disabled={!credentialRef||working} placeholder="输入密钥" autoComplete="off" spellCheck={false} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&editing){e.preventDefault();void confirm()}if(e.key==='Escape'&&editing){e.preventDefault();cancel()}}}/>
      <button type="button" className="ocrKeyClear" aria-label="清空密钥" title="清空密钥" disabled={working||(!credential?.configured&&!value)} onClick={()=>{setValue('');setEditing(true);setVisible(false)}}><KeyGlyph icon={Trash2}/></button></div>
      <button type="button" className="btn btn-outline ocrKeyAction" aria-label={editing?'确认密钥':'编辑密钥'} title={editing?'确认':'编辑'} disabled={!credentialRef||working} onClick={()=>editing?confirm():read(true)}>{Morph?<Morph icon={Pencil} target={Check} active={editing}/>:<KeyGlyph icon={editing?Check:Pencil}/>}</button>
      <button type="button" className="btn btn-outline ocrKeyAction" aria-label={editing?'取消编辑密钥':visible?'隐藏密钥':'显示密钥'} title={editing?'取消':visible?'隐藏':'显示'} disabled={!credentialRef||working||(!editing&&!credential?.configured)} onClick={()=>{if(editing)cancel();else if(visible){setVisible(false);setValue('')}else void read(false)}}>{Morph?<Morph icon={Eye} target={editing?X:EyeOff} active={editing||visible}/>:<KeyGlyph icon={editing?X:visible?EyeOff:Eye}/>}</button>
    </div></div>
}
function KeyGlyph({icon}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon.map(([tag,attributes],i)=>React.createElement(tag,{...attributes,key:i}))}</svg>}
