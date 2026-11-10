import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCardHtml } from '../src/card-html'

const note = {noteId:'q',noteTitle:'题目',excerptPic:{paint:'base',drawing:'overlay'},comments:[
 {type:'TextNote',text:'文字子评论'},
 {type:'PaintNote',paint:'comment-image',drawing:'comment-ink'},
 {type:'LinkNote',q_hpic:{paint:'linked-image',drawing:'linked-ink'}},
 {type:'TextNote',text:'marginnote4app://note/linked'}
],childNotes:[{noteId:'child',noteTitle:'子卡',excerptText:'子卡正文',comments:[{type:'PaintNote',drawing:'child-ink'}]}]}
function render(handwriting: boolean, comments: boolean) {
 const reads: string[]=[]
 const html=renderCardHtml(note,'原题',()=>({noteId:'linked',excerptPic:{drawing:'resolved-ink'}}),hash=>'iVBOR-'+hash,hash=>{reads.push(hash);return 'INK-'+hash},true,true,false,{handwriting,comments})
 return {body:html.split('<body>')[1],reads}
}

test('默认导出选项关闭：保留摘录底图和子卡正文，不读取手写或渲染子评论',()=>{
 const {body,reads}=render(false,false)
 assert.match(body,/data-media-id="base"/)
 assert.match(body,/子卡正文/)
 assert.doesNotMatch(body,/<canvas|文字子评论|comment-image|linked-image|未读取到手写/)
 assert.deepEqual(reads,[])
})
test('只开启评论：评论文字和图片保留，所有评论及底图笔迹都不读取',()=>{
 const {body,reads}=render(false,true)
 assert.match(body,/文字子评论/)
 assert.match(body,/data-media-id="comment-image"/)
 assert.match(body,/data-media-id="linked-image"/)
 assert.doesNotMatch(body,/<canvas|未读取到手写/)
 assert.deepEqual(reads,[])
})
test('只开启书写：保留摘录上的叠加笔迹，子评论仍排除',()=>{
 const {body,reads}=render(true,false)
 assert.match(body,/data-drawing-overlay="true"/)
 assert.doesNotMatch(body,/文字子评论|comment-image|child-ink/)
 assert.deepEqual(reads,['overlay'])
})
test('同时开启：折叠评论、合并卡片及子卡评论均按选择导出书写',()=>{
 const {body,reads}=render(true,true)
 assert.match(body,/文字子评论/)
 assert.ok(reads.includes('comment-ink'))
 assert.ok(reads.includes('linked-ink'))
 assert.ok(reads.includes('resolved-ink'))
 assert.ok(reads.includes('child-ink'))
})
test('普通卡片预览保持原有默认行为',()=>{
 const html=renderCardHtml(note,'原题',()=>undefined,()=> 'iVBOR',()=> 'INK',false,true,false)
 assert.match(html,/<details class="card-comment"[^>]* open>/)
 assert.match(html,/<canvas/)
})
