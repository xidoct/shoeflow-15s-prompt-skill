import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../core/compile.mjs';
import {server} from '../server.mjs';
import {promises as fs} from 'node:fs';
const board={globalStyle:'居家手机拍摄',scenes:[8,7,8].map((duration,i)=>({duration,voiceText:`口播${i}`,visualPrompt:'举鞋',referenceStrategy:'avatar_and_product'}))};
test('15 second groups contain full text, correct references and strict tail semantics',()=>{const t=compile(board,{productCount:1,mode:'first_frame'});assert.deepEqual(t.batches.map(b=>b.duration),[15,8]);assert.equal(t.batches[0].references.length,2);assert.equal(t.batches[1].references.length,1);assert.match(t.batches[1].prompt,/图片1.*真实尾帧/);assert.match(t.batches[0].prompt,/口播0/);assert.match(t.batches[0].prompt,/口播1/);assert.match(t.batches[0].prompt,/不强制三连动作/);assert.match(t.batches[0].prompt,/避免大幅转头、遮嘴和快速运镜/);assert.doesNotMatch(t.batches[1].prompt,/口播0/);assert.throws(()=>compile({scenes:[{duration:16}]}),/超过/);});
test('tasks save and reload without LLM credentials or video calls',async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let id;try{const base=`http://127.0.0.1:${server.address().port}`;const response=await fetch(base+'/api/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({script:'测试',board,options:{productCount:1},llm:{key:'NEVER-SAVE-KEY'}})});assert.equal(response.status,200);const task=await response.json();id=task.id;const restored=await(await fetch(base+'/api/tasks/'+id)).json();assert.deepEqual(restored,task);assert.ok((await(await fetch(base+'/api/tasks')).json()).some(t=>t.id===id));assert.doesNotMatch(JSON.stringify(restored),/NEVER-SAVE-KEY/);assert.equal((await fetch(base+'/api/render',{method:'POST'})).status,404);}finally{if(id)await fs.rm(new URL('../tasks/'+id+'.json',import.meta.url),{force:true});await new Promise(resolve=>server.close(resolve));}});


test('vision request includes labeled images and visual grounding rules',async()=>{
 const {LlmStoryboardProvider}=await import('../core/llm-provider.mjs');
 const {references}=await import('../core/references.mjs');
 const {storyboardNaturalPerformanceContract}=await import('../core/storyboard-prompts.mjs');
 const data='data:image/png;base64,aGVsbG8=';
 const refs=references({products:[data],avatar:data});let sent;
 const provider=new LlmStoryboardProvider({endpoint:'https://example.test/v1',model:'vision',key:'test'}, {fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(board)}}]}),{headers:{'content-type':'application/json'}});}});
 await provider.createStoryboard('原文',`基础规则\n\n${storyboardNaturalPerformanceContract}`,refs);
 assert.equal(sent.messages[1].content.filter(x=>x.type==='image_url').length,2);
 assert.match(sent.messages[0].content,/不从外观推断材质/);
 assert.match(sent.messages[0].content,/不强制三个动作/);
 assert.match(sent.messages[0].content,/非剧情的商品展示与自然口播/);
 assert.match(sent.messages[1].content[1].text,/人物参考/);
 assert.match(sent.messages[1].content[3].text,/商品参考1/);
 assert.throws(()=>references({products:['https://example.test/a.png']}),/参考图须/);
});
