// THROWAWAY: deterministic simulated translations; no network calls or saved settings.
const examples = [
  {name:'Maya Chen',handle:'@maya · 12 分钟',en:'Good tools should help us understand more, without getting in the way of what we came to read.',zh:'好的工具应该帮助我们理解更多，而不妨碍我们原本想阅读的内容。'},
  {name:'Reading Notes',handle:'@notes · 28 分钟',en:'Small details matter. A translation should stay close to its original, so you never lose your place.',zh:'细节很重要。译文应该紧挨原文，让你始终知道自己读到了哪里。'},
  {name:'Alex Rivera',handle:'@alex · 1 小时',en:'I spent the morning reading about cities designed for people.\n\nThe most interesting part was not the technology, but the space it gave people to meet, walk, and feel at home.',zh:'我花了一上午阅读以人为本的城市设计。\n\n最有意思的不是技术本身，而是它为人们留出的空间：在这里相遇、散步，并找到归属感。'}
];
const variants={A:['紧凑双语','译文紧接原文，轻量标签与操作同处一行。阅读密度高，额外装饰最少。'],B:['独立译文卡片','背景与边框明确区分译文；操作放在卡片内。识别更清晰，但页面会更长。'],C:['可折叠译文','自动翻译后默认折叠，只显示展开入口。减少页面增高，但读译文需要多点一次。']};
const posts=document.getElementById('posts');
let variant=new URLSearchParams(location.search).get('variant')||'A';
if(!variants[variant]) variant='A';
let enabled=true,states=['success','loading','error'],folded=Array(3).fill(variant==='C'),timers=[];
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){
  document.body.classList.remove('variant-A','variant-B','variant-C');document.body.classList.add('variant-'+variant);
  document.getElementById('variant-label').textContent=variant+' · '+variants[variant][0];
  document.getElementById('variant-name').textContent=variants[variant][0];document.getElementById('variant-note').textContent=variants[variant][1];
  posts.innerHTML=examples.map((p,i)=>`<article class="post"><div class="author"><span class="avatar" aria-hidden="true">${p.name[0]}</span><strong>${p.name}</strong><span>${p.handle}</span></div><p class="source" lang="en">${esc(p.en)}</p>${i===0?'<a href="#" data-demo-link lang="en">Read the full story →</a>':''}${enabled?translation(i):''}<div class="actions" aria-label="原网页操作区示意"><span>评论 12</span><span>转发 8</span><span>喜欢 36</span></div></article>`).join('');
  document.getElementById('state').textContent=`方案：${variant}\n网站翻译：${enabled?'开启':'关闭'}\n`+states.map((s,i)=>`内容块 ${i+1}：${enabled?s+(folded[i]?' / 已折叠':''):'译文已移除'}`).join('\n')+'\n数据：预置演示 / 未联网';
}
function translation(i){const s=states[i];return `<section class="translation" aria-label="${examples[i].name} 的译文"><div class="translation-bar"><span>译文 · 简体中文</span>${s==='success'?`<button data-toggle="${i}" aria-expanded="${!folded[i]}" aria-controls="translation-${i}">${folded[i]?'展开译文':'收起译文'}</button>`:''}</div>${s==='loading'?`<p>正在翻译… <button data-finish="${i}">模拟完成</button></p>`:s==='error'?`<p class="error">翻译失败，原文不受影响。 <button data-retry="${i}">重试</button></p>`:`<p id="translation-${i}" class="translation-text" lang="zh-CN" ${folded[i]?'hidden':''}>${esc(examples[i].zh)}</p>`}</section>`;}
function clearTimers(){timers.forEach(clearTimeout);timers=[];}
function switchVariant(delta){variant=Object.keys(variants)[(Object.keys(variants).indexOf(variant)+delta+3)%3];folded=Array(3).fill(variant==='C');const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url);render();}
posts.addEventListener('click',event=>{const b=event.target.closest('button,a');if(!b)return;if(b.hasAttribute('data-demo-link')){event.preventDefault();return;}if(b.hasAttribute('data-toggle')){const i=Number(b.dataset.toggle);folded[i]=!folded[i];render();posts.querySelector(`[data-toggle="${i}"]`).focus();}else if(b.hasAttribute('data-finish')){states[Number(b.dataset.finish)]='success';render();}else if(b.hasAttribute('data-retry')){const i=Number(b.dataset.retry);states[i]='loading';render();timers.push(setTimeout(()=>{states[i]='success';render();},1000));}});
document.getElementById('enabled').addEventListener('change',e=>{enabled=e.target.checked;clearTimers();render();});
document.getElementById('theme').addEventListener('click',e=>{document.body.classList.toggle('light');e.target.textContent=document.body.classList.contains('light')?'切换深色':'切换浅色';});
document.getElementById('replay').addEventListener('click',()=>{clearTimers();states=['loading','loading','loading'];folded=[false,false,false];enabled=true;document.getElementById('enabled').checked=true;render();[900,1500,2100].forEach((delay,i)=>timers.push(setTimeout(()=>{states[i]=i===2?'error':'success';render();},delay)));});
document.getElementById('prev').onclick=()=>switchVariant(-1);document.getElementById('next').onclick=()=>switchVariant(1);
document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();switchVariant(e.key==='ArrowLeft'?-1:1);}});
render();
