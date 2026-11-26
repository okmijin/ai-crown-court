'use strict';

const $ = selector => document.querySelector(selector);
const replayOnly = document.body.dataset.replay === 'true';
const hashId = /^#[0-9a-f]{32}$/.test(location.hash) ? location.hash.slice(1) : null;
const linkedTrial = query.get('trial') ?? hashId;
const eventNames = ['status','clerk','opening','rebuttal','summing','juror','tally','lens','ask','answer','revote','verdict','done','error'];
const queue = [], transcript = [];
let previewRiseId, ritualTyping, witnessQuestion, awaitingAsk, answerPending = null;
const openingRise = {zh:'全体起立 · All rise。开庭。',en:'All rise. Court is in session.'};
let current, stream, playing = false, finishFrame, frozen = false;
let lastSpeech = () => t('法庭已经准备就绪。提交案由，或观看示范。','The court is ready. Submit a case or watch the demo.');
let activeActor = ['clerk',null,false], phaseName, stampText, session = 'preview', motion = '', problem;
let pending, lodging = false, lodgeLanguage, switching = false, playbackDone, legacyPass = '';
const polledEvents = new Set();
let skipBatch = 0;
let pollingId, historyRequest = 0, rejectedPollPass, retryPollAt = 0;
const isPrivateId = id => /^[0-9a-f]{32}$/.test(id);
const passPrompt = "请出示法庭通行令以查阅私人案卷。";
let soundOn = false, soundWanted = false, archive, transition, deliberated = false;
const SOUND_V='20261127f';
const soundLevel={type:.14,answer:.16,ask:.18,placard:.18,ruling:.18,gavel:.28,objection:.3,gavel3:.34,gasp:.22,uproar:.24,bed:.85,open:.95,close:.95,pass:.32,fail:.32,hung:.28};
const soundFile={gavel:'static/gavel.wav',type:'static/type.wav',objection:'static/objection.wav',gavel3:'static/gavel3.mp3',bed:'static/court-bed.mp3',gasp:'static/gasp.mp3',uproar:'static/uproar.mp3',pass:'static/verdict-pass.mp3',fail:'static/verdict-fail.mp3',hung:'static/verdict-hung.mp3',ask:'static/ask-pop.mp3',placard:'static/placard.mp3',ruling:'static/ruling.mp3',answer:'static/answer.mp3',open:'static/court-open.mp3',close:'static/court-close.mp3'};
const sounds={};
let soundCtx, duckTimer, lastPlacard=0, bedWanted=false, fastForward=false, closePlayed=false, bedTimer=0;

const buffers={};
/* court-sound-v5 */
let bedSource, bedGain, decoding;
const BED_DUCK_RATIO=0.35, OPEN_BED_CROSSFADE_MS=1800;
let masterGain, courtAnalyser, ctxHooked=false;
function hookCtx() {
  if (!soundCtx || ctxHooked) return;
  ctxHooked=true;
  soundCtx.addEventListener('statechange',()=>{
    if (soundCtx.state==='running' && soundOn && bedWanted && !frozen) startBed();
  });
}
function ensureMaster() {
  if (!soundCtx) return;
  hookCtx();
  if (masterGain) return;
  masterGain=soundCtx.createGain();
  masterGain.gain.value=1;
  masterGain.connect(soundCtx.destination);
  courtAnalyser=soundCtx.createAnalyser();
  courtAnalyser.fftSize=2048;
  courtAnalyser.smoothingTimeConstant=0;
  masterGain.connect(courtAnalyser);
}
function outputNode() {
  ensureMaster();
  return masterGain||soundCtx.destination;
}
function bedDuckLevel() {return soundLevel.bed*BED_DUCK_RATIO;}
function ensureAudioRunning() {
  if (!soundCtx) return Promise.resolve();
  if (soundCtx.state==='running') return Promise.resolve();
  return soundCtx.resume().catch(()=>{});
}
function onForeground() {
  if (typeof document!=='undefined' && document.hidden) return;
  const go=()=>{if (soundOn && bedWanted && !frozen) startBed();};
  if (!soundCtx) {go();return;}
  ensureAudioRunning().then(go);
}
function courtMeterTick() {
  if (!courtAnalyser || !window.__courtLevelLog) return;
  const n=courtAnalyser.fftSize, data=new Float32Array(n);
  courtAnalyser.getFloatTimeDomainData(data);
  let sum=0, peak=0;
  for (let i=0;i<n;i++) {const v=data[i], a=Math.abs(v); sum+=v*v; if(a>peak) peak=a;}
  const rms=Math.sqrt(sum/n);
  window.__courtLevelLog.push({
    t:Math.round(performance.now()),
    rms, peak,
    db:20*Math.log10(rms+1e-12),
    ctx:soundCtx&&soundCtx.state,
    bedGain:bedGain?bedGain.gain.value:null,
    open:openPlaying(),
    bedWanted, closePlayed
  });
}
window.__courtStartMeter=function(){
  window.__courtLevelLog=[];
  if (window.__courtMeterId) clearInterval(window.__courtMeterId);
  window.__courtMeterId=setInterval(courtMeterTick,100);
};
window.__courtStopMeter=function(){
  clearInterval(window.__courtMeterId);
  window.__courtMeterId=0;
  return window.__courtLevelLog||[];
};
window.__courtOnForeground=onForeground;

function loadSound(name) {
  if (sounds[name]) return sounds[name];
  const node=new Audio(soundFile[name]+'?v='+SOUND_V);
  node.preload='auto';
  node.volume=soundLevel[name]??.24;
  if (name==='bed') node.loop=true;
  sounds[name]=node;
  return node;
}
function loadAllSounds() {
  Object.keys(soundFile).forEach(loadSound);
}
function decodeAll() {
  if (decoding || !soundCtx) return decoding;
  decoding=Promise.all(Object.entries(soundFile).map(([name,file])=>
    fetch(file+'?v='+SOUND_V).then(r=>r.arrayBuffer())
      .then(data=>new Promise((ok,no)=>soundCtx.decodeAudioData(data,ok,no)))
      .then(buffer=>{buffers[name]=name==='bed'?prepareBedBuffer(buffer):buffer;}).catch(()=>{})));
  return decoding;
}
function prepareBedBuffer(buffer) {
  // Recross the last 40 ms into the start so MP3 padding cannot click on loop.
  if (!soundCtx || !buffer || buffer.length<2) return buffer;
  const fade=Math.min(Math.floor(.04*buffer.sampleRate), Math.floor(buffer.length/8));
  if (fade<16) return buffer;
  const out=soundCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c=0;c<buffer.numberOfChannels;c++) {
    const src=buffer.getChannelData(c), dst=out.getChannelData(c);
    dst.set(src);
    const n=src.length;
    for (let i=0;i<fade;i++) {
      const w=Math.sin(.5*Math.PI*i/fade), u=Math.cos(.5*Math.PI*i/fade);
      dst[n-fade+i]=src[n-fade+i]*u+src[i]*w;
    }
  }
  return out;
}
function webAudioReady(name) {
  return soundCtx && soundCtx.state==='running' && buffers[name];
}
function fadeBed(target, step=.03) {
  if (bedGain && soundCtx) {
    const now=soundCtx.currentTime, span=Math.max(.05,Math.abs(bedGain.gain.value-target)/step/60);
    bedGain.gain.cancelScheduledValues(now);
    bedGain.gain.setValueAtTime(bedGain.gain.value,now);
    bedGain.gain.linearRampToValueAtTime(Math.max(0,target),now+span);
    if (target<=0) {
      const source=bedSource;
      bedSource=bedGain=null;
      setTimeout(()=>{try{source?.stop();}catch{}},span*1000+60);
    }
    return;
  }
  const bed=sounds.bed;
  if (!bed) return;
  const tick=()=>{
    const cur=bed.volume;
    const dir=target>cur?step:-step;
    const next=cur+dir;
    if (Math.abs(next-target)<=step || (dir>0 && next>=target) || (dir<0 && next<=target)) {
      bed.volume=Math.max(0,target);
      if (target<=0) {bed.pause();bed.currentTime=0;}
      return;
    }
    bed.volume=Math.max(0,next);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function startBed() {
  bedWanted=true;
  if (!soundOn || frozen) return;
  if (openPlaying()) {
    // Keep hall air under the opening so the Court! / All rise! pauses are not silence,
    // then crossfade up to full bed in the last 1.8 s of the sting.
    startBedNow(.04, bedDuckLevel());
    clearTimeout(bedTimer);
    const remain=openUntil-performance.now();
    const wait=Math.max(0, remain-OPEN_BED_CROSSFADE_MS);
    bedTimer=setTimeout(()=>{if(bedWanted) startBedNow(.008);},wait);
    return;
  }
  startBedNow();
}
function startBedNow(fadeStep, target) {
  if (!bedWanted || !soundOn || frozen) return;
  ensureMaster();
  const level=(target==null?soundLevel.bed:target);
  if (webAudioReady('bed')) {
    if (sounds.bed && !sounds.bed.paused) {try{sounds.bed.pause();}catch{}}
    if (!bedSource) {
      bedGain=soundCtx.createGain();
      bedGain.gain.value=0;
      bedGain.connect(outputNode());
      bedSource=soundCtx.createBufferSource();
      bedSource.buffer=buffers.bed;
      bedSource.loop=true;
      bedSource.loopStart=0;
      bedSource.loopEnd=buffers.bed.duration;
      bedSource.connect(bedGain);
      bedSource.start();
    }
    fadeBed(level, fadeStep||.015);
    return;
  }
  const bed=loadSound('bed');
  if (bed.paused) {bed.volume=0;bed.play().catch(()=>{});}
  fadeBed(level, fadeStep||.015);
  // Retry Web Audio once the buffer arrives so the loop uses the seamless buffer, not the MP3 element.
  if (decoding) decoding.then(()=>{if(bedWanted&&soundOn&&!frozen&&!bedSource) startBedNow(fadeStep, target);});
}
function stopBed() {
  bedWanted=false;
  clearTimeout(bedTimer);
  if (bedSource) fadeBed(0,.025);
  const bed=sounds.bed;
  if (bed && !bed.paused) {
    const saved=bedGain;
    bedGain=null;
    fadeBed(0,.025);
    bedGain=saved;
  }
}
function duckBed() {
  if (!bedWanted || !soundOn) return;
  const ducked=bedDuckLevel();
  if (bedGain && soundCtx) {
    const now=soundCtx.currentTime, cur=bedGain.gain.value;
    if (bedGain.gain.cancelAndHoldAtTime) bedGain.gain.cancelAndHoldAtTime(now);
    else {
      bedGain.gain.cancelScheduledValues(now);
      bedGain.gain.setValueAtTime(cur,now);
    }
    bedGain.gain.linearRampToValueAtTime(ducked,now+.05);
  } else {
    const bed=sounds.bed;
    if (!bed || bed.paused) return;
    bed.volume=Math.max(ducked, Math.min(bed.volume, ducked));
    bed.volume=ducked;
  }
  clearTimeout(duckTimer);
  duckTimer=setTimeout(()=>{if(bedWanted&&soundOn&&!frozen) fadeBed(soundLevel.bed,.015);},500);
}
const sessions = {preview:['法庭预览','Court preview'],live:['实时庭审','Live trial'],fixture:['示范庭审','Demo trial'],
  lodged:['候审中','Awaiting Trial'],filed:['开庭','Court in Session'],replay:['案卷重播','Case replay'],freeze:['庭审定格','Freeze frame']};
const motions = {running:['庭审进行中','Trial in progress'],done:['庭审结束','Trial complete'],
  frozen:['画面已定格','Frame frozen'],error:['庭审中断','Trial interrupted'],
  reconnect:['正在重连书记员记录…','Reconnecting to the clerk’s record…'],
  waiting:['书记员请双方准备…','The clerk asks the parties to stand by…']};
const shortPhases = {opening:['开场','Opening'],rebuttal:['质询','Cross'],summing:['总结','Summing-up'],
  jury:['陪审团','Jury'],judge:['宣判','Verdict']};

const lodgedSpeech=()=>t('书记官已受理立案。首份案卷发布后即开始重播。','The clerk has accepted your filing. The replay will start as soon as the first record appears.');
const CLERK='https://ai-court-clerk.okmijin.workers.dev';
const privateCase=/持仓|仓位|账户|资金|现金|净值|NAV|成交|订单|买入力|buying power|position|portfolio|holdings|account|balance|acc_id|trd_|moomoo|身份证|护照|银行卡|密码|password|token|api[_ -]?key|手机号|邮箱|@gmail/i;

function element(tag,text,parent) {
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  parent?.append(node);
  return node;
}
function urlFor(id,freeze) {
  const params=new URLSearchParams({lang});
  if(id) params.set('trial',id);
  if(freeze) params.set('freeze',freeze);
  return './?'+params;
}
async function api(url,options) {
  const response=await fetch(url,options).catch(()=>{throw new Error('法庭暂时无法响应。');});
  if(!response.ok) {
    const value=await response.json().catch(()=>({}));
    throw new Error(value.error || '找不到该案。');
  }
  return response.json();
}
let openUntil=0, openStop=null;
function openPlaying() {return performance.now()<openUntil;}
function stopOpen() {
  openUntil=0;
  try {openStop?.();} catch {}
  openStop=null;
}
function tone(name, force) {
  if (!soundOn || frozen) return;
  if (!force && fastForward) return;
  // The opening cue owns the room: nothing else may cut across it.
  if (!force && openPlaying()) return;
  if (name==='bed' || name==='murmur') {startBed();return;}
  if (name!=='open' && name!=='close') duckBed();
  window.__courtTones=(window.__courtTones||0)+1;
  if (webAudioReady(name)) {
    try {
      const gain=soundCtx.createGain();
      gain.gain.value=soundLevel[name]??.24;
      gain.connect(outputNode());
      const source=soundCtx.createBufferSource();
      source.buffer=buffers[name];
      source.connect(gain);
      source.start();
      if (name==='open') {
        openUntil=performance.now()+buffers[name].duration*1000;
        openStop=()=>{try{source.stop();}catch{}};
        source.onended=()=>{openUntil=0;openStop=null;if(bedWanted) startBed();};
      }
      return;
    } catch {}
  }
  const src=loadSound(name);
  try {
    const node=src.cloneNode();
    node.volume=soundLevel[name]??.24;
    if (name==='open') {
      openUntil=performance.now()+(Number.isFinite(src.duration)&&src.duration>0?src.duration:9)*1000;
      openStop=()=>{try{node.pause();}catch{}};
      node.addEventListener('ended',()=>{openUntil=0;openStop=null;if(bedWanted) startBed();},{once:true});
    }
    node.play().catch(()=>{if(name==='open'){openUntil=0;openStop=null;}src.currentTime=0;src.play().catch(()=>{});});
  } catch {
    src.currentTime=0;
    src.play().catch(()=>{});
  }
}
function playClose() {
  if (frozen) {stopOpen();stopBed();return;}
  if (closePlayed) {stopOpen();stopBed();return;}
  closePlayed=true;
  stopOpen();
  stopBed();
  if (soundOn) tone('close', true);
}
function tickPlacard() {
  const now=performance.now();
  if (now-lastPlacard<80) return;
  lastPlacard=now;
  tone('placard');
}
function verdictCue() {
  const key=voteKey(current?.tally?.finding);
  return key==='无罪'?'pass':key==='有罪'?'fail':'hung';
}
let hintTimer;
function soundHint(show) {
  let hint=$('#sound-hint');
  if (!hint) {
    hint=element('p',undefined,document.body);
    hint.id='sound-hint';
    hint.setAttribute('role','status');
  }
  hint.textContent=t('若无声，请关闭手机侧边静音键','No sound? Turn off the phone’s silent switch');
  hint.hidden=!show;
  clearTimeout(hintTimer);
  if (show) hintTimer=setTimeout(()=>{hint.hidden=true;},6000);
}
function paintSound() {
  const button=$('#sound');
  if (!button) return;
  button.textContent=soundOn?t('声音开启','Sound on'):t('声音关闭','Sound off');
  button.setAttribute('aria-pressed',String(soundOn));
}
function readSoundPref() {
  try {return localStorage.getItem('court-sound')==='on';} catch {return false;}
}
function writeSoundPref(on) {
  try {localStorage.setItem('court-sound',on?'on':'off');} catch {}
}
function makeSoundCtx() {
  const Ctx=window.AudioContext||window.webkitAudioContext;
  return Ctx ? new Ctx() : undefined;
}
function warmSoundCtx() {
  // Building an AudioContext costs ~30 ms; do it while the finger is still down so the tap itself stays fast.
  if (soundCtx) return;
  try {if (navigator.audioSession) navigator.audioSession.type='playback';} catch {}
  try {soundCtx=makeSoundCtx();} catch {}
}
function unlockSound() {
  // Runs synchronously inside the tap so iOS Safari keeps the user gesture.
  try {if (navigator.audioSession) navigator.audioSession.type='playback';} catch {}
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if (Ctx) {
    try {
      soundCtx=soundCtx||makeSoundCtx();
      if (soundCtx.state!=='running') soundCtx.resume().catch(()=>{});
      ensureMaster();
      const buf=soundCtx.createBuffer(1,1,22050);
      const src=soundCtx.createBufferSource();
      src.buffer=buf;
      src.connect(soundCtx.destination);
      src.start(0);
    } catch {}
  }
  loadAllSounds();
  for (const [name,node] of Object.entries(sounds)) {
    if (name==='bed' && bedWanted) continue;
    try {
      node.muted=true;
      const played=node.play();
      const reset=()=>{node.pause();node.currentTime=0;node.muted=false;node.volume=soundLevel[name]??.24;};
      if (played?.then) played.then(reset,()=>{node.muted=false;}); else reset();
    } catch {node.muted=false;}
  }
  decodeAll();
}
function setSound(on) {
  if (on) {
    unlockSound();
    soundOn=true;
    soundWanted=true;
    writeSoundPref(true);
    paintSound();
    soundHint(true);
    if (bedWanted) startBed();
    return true;
  }
  soundOn=false;
  soundWanted=false;
  writeSoundPref(false);
  soundHint(false);
  stopOpen();
  stopBed();
  Object.values(sounds).forEach(node=>{try{node.pause();node.currentTime=0;}catch{}});
  paintSound();
  return false;
}
function setMotion(key) {
  motion=key;
  $('#motion-status').textContent=key ? t(...motions[key]) : '';
}
function phase(name) {
  phaseName=name;
  $('#phase-label').textContent=name==='error'?t(...motions.error):name?t(...phases[name]):t('候审','Ready');
  document.querySelectorAll('#steps span').forEach(step=>step.classList.toggle('current',step.dataset.phase===name));
}
function refreshSession() {
  $('#session-label').textContent=t(...sessions[session])+(current?' · '+t(...modes[current.mode]):'')+
    (current?.round>1?' · '+roundLabel(current.round):'');
}
const MAX_ROUNDS=3;
function roundLabel(round) {
  return t('第 '+round+'/'+MAX_ROUNDS+' 次审理','Hearing '+round+' of '+MAX_ROUNDS)+(round>=MAX_ROUNDS?t(' · 终审',' · Final'):'');
}
function originalCharge(trial) {
  return [...String(trial.case||'').split('\n\n')[0].trim()].slice(0,200).join('');
}
function continuationDesk(page) {
  const round=current.round||1;
  const box=element('section',undefined,page);box.className='continuation';
  element('h3',roundLabel(round),box);
  if(!replayOnly || !isPrivateId(current.id) || current.state==='running') return;
  if(round>=MAX_ROUNDS) {
    element('p',t('本案已终审结案，不再接受续审。','This was the final hearing. The case is closed.'),box);
    return;
  }
  const open=element('button',t('补充案情 · 续审 ▸','Add facts · Rehear ▸'),box);
  open.type='button';open.className='continue-open';
  const form=element('div',undefined,box);form.hidden=true;form.className='continue-form';
  const label=element('label',t('修改原案，或补充新的条件（第 '+(round+1)+'/'+MAX_ROUNDS+' 次审理'+(round+1>=MAX_ROUNDS?'，即终审':'')+'）',
    'Amend the case or add new conditions (hearing '+(round+1)+' of '+MAX_ROUNDS+')'),form);
  label.htmlFor='amendment';
  const field=element('textarea',undefined,form);field.id='amendment';field.maxLength=1000;field.rows=4;
  element('p',t('法庭会带着前几次的案由和判决摘要重新开庭。','The court reopens with the earlier charge and verdicts as background.'),form).className='field-note';
  const send=element('button',t('提交续审 ▸','File the rehearing ▸'),form);
  send.type='button';send.className='primary continue-send';
  open.addEventListener('click',()=>{form.hidden=false;open.hidden=true;field.focus();});
  send.addEventListener('click',async()=>{
    const amendment=field.value.trim();
    if(!amendment || [...field.value].length>1000) return showError('补充案情请写 1 至 1000 字。');
    send.disabled=true;
    try {
      await lodge({charge:originalCharge(current),amendment,round:round+1,parent_case_id:current.id,lang:current.lang});
    } finally {send.disabled=false;}
  });
}
function stageView(trial,view) {
  current={...trial,jury:[],tally:null,verdict:null,lens:null};
  session=view;
  document.body.classList.add('live');
  $('#petition').hidden=true;
  $('#transcript').hidden=false;
  $('#steps [data-phase=summing]').hidden=trial.mode!=='uk';
  $('#steps').classList.toggle('legacy-steps',trial.mode!=='uk');
  stage.state.seats=new Set(trial.seats);
  refreshSession();
  refreshRecordHeader();
  stage.refreshTags();
}
function actor(name,active,ceremony=false) {
  activeActor=[name,active,ceremony];
  $('#speaker').textContent=typeof name==='string'?t(...(name==='clerk'&&session==='lodged'?['书记官','Clerk of the Court']:roles[name])):jurorName(name);
  $('#speaker-en').textContent=typeof name==='object'&&lang==='zh'?name.english:'';
  if (stage.state.active!==active) stage.state.hasSpeech=false;
  stage.state.active=active;
  $('#stage-world').classList.toggle('witness-active',active==='dock');
  stage.state.ceremony=ceremony;
  stage.refreshTags();
}
async function order(key) {
  if (transition===key) return;
  transition=key;
  if (frozen) return;
  const now=performance.now();
  stage.state.strike=now+460;
  stage.state.shake=now+330;
  tone(key==='rise'?'open':key==='verdict'?'gavel3':'gavel');
  if (key==='rise' && !frozen) startBed();
  showStamp('order');
  await hold(stage.reduced.matches ? 280 : 540);
  showStamp(null);
}
function react(text, emotion) {
  const roles = ['judge','defense','prosecution','clerk','dock',...stage.state.seats];
  stage.state.reactions=new Map(roles.map(role=>[role,
    emotions.includes(emotion) ? emotion : inferEmotion(text,role)]));
  stage.state.reactionUntil=performance.now()+1350;
}
async function deliberate() {
  if (deliberated) return;
  deliberated=true;
  stage.state.whisper=!frozen ? !stage.reduced.matches : query.get('freeze')==='jury';
  if (!frozen && !fastForward) startBed();
  actor('clerk',null);
  showSpeech(()=>t('陪审团正在评议…','The jury is deliberating…'));
  if (!frozen) {
    await hold(stage.reduced.matches ? 300 : 1750);
    stage.state.whisper=false;
  }
}
function pointText(p,kind) {
  if(kind==='opening') {
    const fact=p.kind==='fact'||p.kind==='事实';
    const tag=fact?t('事实','Fact'):t('推断','Inference');
    const text=p.text?local(p.text):[local(p.quote),local(p.argument),local(p.basis),local(p.impact)].filter(Boolean).join(' ');
    return p.number+'. '+tag+' · '+(fact&&p.text?'“'+text+'”':text);
  }
  return p.number+'. '+(p.survives?t('成立','Survives'):t('不成立','Does not survive'))+' · '+local(p.response);
}
function refId(kind,side,number) {
  return kind+'-'+side+'-'+number;
}
function refLink(parent,cite) {
  const side=({控方:'prosecution',辩方:'defense'})[cite.side] || cite.side;
  const id=refId(cite.phase,side,cite.point);
  const label=t(side==='prosecution'?'控方':'辩方',side==='prosecution'?'Crown':'Defence');
  const link=element('a',label+t((cite.phase==='opening'?'开场':'反驳')+'第 '+cite.point+' 点',
    (cite.phase==='opening'?' opening point ':' cross point ')+cite.point),parent);
  link.href='#'+id;
  link.addEventListener('click',event=>{
    const target=document.getElementById(id);
    if(!target) return;
    event.preventDefault();
    $('#transcript').classList.add('show-reference');
    target.closest('details').open=true;
    document.querySelectorAll('.referenced').forEach(item=>item.classList.remove('referenced'));
    target.classList.add('referenced');
    target.tabIndex=-1;
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'center',behavior:stage.reduced.matches?'instant':'smooth'});
  });
}
function record(title,event,paragraphs) {
  const entry={title,event,paragraphs};
  transcript.push(entry);
  drawEntry(entry);
}
function drawEntry({title,event,paragraphs}) {
  const entries=$('#entries');
  const detail=element('details',undefined,entries);
  detail.className='entry';
  element('summary',title(),detail);
  if(event.time) element('time',new Date(event.time).toLocaleTimeString(lang==='zh'?'zh-CN':'en-GB'),detail);
  for(const {text,id} of paragraphs()) {
    const line=element('p',text,detail);
    if(id) line.id=id;
  }
}
function showSpeech(getText) {
  lastSpeech=getText;
  $('#speech').textContent=getText();
}
function liveQuestions() {
  return ['live','filed','lodged'].includes(session);
}
function liveQuestionQueued() {
  return liveQuestions() && queue.some(event=>event.type==='ask');
}
function type(getText, max=9400, {emotion, reactionText, cues=[]}={}) {
  lastSpeech=getText;
  const started=performance.now();
  stage.state.speechStart=started;
  stage.state.hasSpeech=true;
  const still=frozen || switching || fastForward || stage.reduced.matches || liveQuestionQueued();
  const initialCue=still ? cues.at(-1) : cues[0];
  react(initialCue?.text ?? reactionText ?? getText(),initialCue?.emotion ?? emotion);
  const speech=$('#speech'), button=$('#skip');
  speech.scrollTop=0;
  const text=getText();
  if(still){
    speech.textContent=lastSpeech();
    return Promise.resolve();
  }
  const chars=[...text];
  const duration=Math.min(max,Math.max(380,chars.length*19));
  stage.state.typing=true;
  return new Promise(resolve=>{
    let frame,lastLength=-1,lastSound=0,cueIndex=0;
    const finish=()=>{
      cancelAnimationFrame(frame);
      stage.state.typing=false;
      speech.textContent=lastSpeech();
      speech.scrollTop=0;
      finishFrame=null;
      resolve();
    };
    finishFrame=finish;
    function step(now) {
      if (stage.reduced.matches) return finish();
      const elapsed=now-started;
      const length=Math.min(chars.length,Math.floor(elapsed/duration*chars.length)+1);
      if(length!==lastLength) {
        let nextCue=cueIndex;
        while (cues[nextCue+1]?.offset < length) nextCue++;
        if (nextCue!==cueIndex) {
          cueIndex=nextCue;
          react(cues[cueIndex].text,cues[cueIndex].emotion ?? emotion);
        }
        speech.textContent=chars.slice(0,length).join('');
        speech.scrollTop=speech.scrollHeight;
        lastLength=length;
        if(now-lastSound>100) {tone('type');lastSound=now;}
      }
      if(elapsed>=duration+320) finish();
      else frame=requestAnimationFrame(step);
    }
    frame=requestAnimationFrame(step);
  });
}
const stamps={order:['肃静！','Order!'],objection:['异议！','Objection!'],sustained:['异议成立','Objection sustained'],overruled:['异议驳回','Objection overruled']};
function showStamp(key) {
  stampText=key;
  $('#objection').hidden=!key;
  if(key) $('#objection').textContent=t(...stamps[key]);
}
function objection(key,show) {
  if(!show||frozen||fastForward) return Promise.resolve();
  if(stage.reduced.matches) {
    if(key==='objection') {tone('objection');setTimeout(()=>tone('gasp'),110);} else tone('ruling');
    return Promise.resolve();
  }
  showStamp(key);
  if(key==='objection') {stage.state.shake=performance.now()+265;tone('objection');setTimeout(()=>tone('gasp'),110);}
  else tone('ruling');
  return hold(460).then(()=>showStamp(null));
}
function hold(duration) {
  if(switching || fastForward || liveQuestionQueued()) return Promise.resolve();
  return new Promise(resolve=>{
    const finish=()=>{
      clearTimeout(timer);
      finishFrame=null;
      resolve();
    };
    const timer=setTimeout(finish,duration);
    finishFrame=finish;
  });
}
function score(tally) {
  return tally.guilty+'–'+tally.acquitted;
}
function renderVerdict(verdict) {
  const page=$('#verdict'), tally=current.tally;
  page.replaceChildren();
  const header=element('header',undefined,page);header.className='document-head';
  element('div',t('判决书','Verdict'),header).className='eyebrow';
  element('h2',finding(tally.finding)+' · '+score(tally),header);
  if(!replayOnly) {
    const download=element('a',t('下载 VERDICT.md','Download VERDICT.md'),header);
    download.href='/api/trials/'+current.id+'/verdict.md';
    download.download='VERDICT.md';
  }
  element('p',t('案由 · ','Case · ')+local(current.case_display||current.case),page);
  element('p',t('指控 · ','Charge · ')+charge(),page);
  if(verdict.recommendation) {
    element('h3',t(...beats.recommendation),page);
    element('p',verdict.recommendation+' · '+local(verdict.recommendation_reason),page);
  }
  element('h3',t('陪审团如何表决','How the jury voted'),page);
  if(tally.abstained) element('p',t(tally.abstained+' 人未表决。',tally.abstained+' abstained.'),page);
  const table=element('table',undefined,page);
  const head=element('tr',undefined,element('thead',undefined,table));
  for(const label of [t('陪审员','Juror'),t('表决','Vote'),t('理由','Reason')]) element('th',label,head).scope='col';
  const body=element('tbody',undefined,table);
  for(const ballot of current.jury) {
    const row=element('tr',undefined,body);
    element('td',jurorName(ballot),row);
    element('td',finding(ballot.vote)+(ballot.changed?' · '+t(...beats.changed):''),row);
    const cell=element('td',courtLine(ballot.reason),row);
    for(const cite of ballot.cites) {
      cell.append(' ');
      refLink(cell,cite);
    }
  }
  const sections=verdict.basis?[[t('裁决依据','Basis for the verdict'),verdict.basis]]:
    [[t('站得住的指控','Charges that held up'),verdict.charges],[t('辩方说对的地方','Points in the Defence’s favour'),verdict.defense]];
  for(const [heading,items] of sections) {
    element('h3',heading,page);
    const list=element('ul',undefined,page);
    for(const item of items) {
      const li=element('li',local(item.text)+' ',list);
      refLink(li,item.cite);
      if(item.jurors!==undefined) li.append(' · '+t(item.jurors+' 位陪审员引用',item.jurors+' jurors cited this'));
    }
  }
  element('h3',t('翻案或重审条件','Conditions for overturning or retrial'),page);
  const actions=element('ol',undefined,page);
  verdict.conditions.forEach(item=>element('li',local(item),actions));
  element('h3',t('判词','Judge’s remarks'),page);
  element('p',local(verdict.sentence),page);
  continuationDesk(page);
  element('small',disclaimer(),page);
  element('a','/court skill by Alex Chen (@nocodealex) (MIT)',element('small',credit(),page)).href='https://github.com/alexyc9381/court-skill';
  page.hidden=false;
}

function previewRise(trial, view) {
  stageView(trial,view);
  previewRiseId=trial.id;
  enqueue({type:'clerk',preview:true,data:{phase:'opening',text:openingRise,ceremony:true}});
}

function lensParagraphs(lens) {
  return [
    {text:local(lens.core_decision)},
    ...['stated_facts','assumptions','unknowns'].flatMap(key => [
      {text:t(...beats[key])+ ' · '+(lens[key].map(local).join(' / ')||'—')},
    ]),
    ...lens.key_disputes.map(dispute=>({text:[local(dispute.issue),t(...roles.prosecution)+' · '+local(dispute.crown),
      t(...roles.defense)+' · '+local(dispute.defence)].join('\n')})),
  ];
}
function witnessOptions() {
  const panel=$('#witness');
  panel.replaceChildren();
  panel.hidden=!witnessQuestion;
  if(!witnessQuestion) return;
  const question=witnessQuestion;
  const answered=event=>event.type==='answer' && event.data.ask.id===question.id;
  const live=liveQuestions() && awaitingAsk===question.id &&
    !['done','error'].includes(current.state) &&
    !current.events?.some(answered) && !queue.some(answered);
  for(const option of question.options) {
    const label=local(option.label);
    const selected=answerPending===option.id;
    const item=element(live?'button':'span',selected?label+t(' · 等待确认',' · Pending'):label,panel);
    if(!live) continue;
    item.type='button';
    item.disabled=answerPending!==null;
    item.setAttribute('aria-pressed',String(selected));
    item.addEventListener('click',async()=>{
      if(witnessQuestion!==question || answerPending!==null) return;
      answerPending=option.id;
      witnessOptions();
      try {
        if(replayOnly) {
          await privateData('/answer',{id:current.case_id||current.id,ask_id:question.id,option:option.id});
        } else {
          await api('/api/trials/'+current.id+'/answer',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:question.id,option:option.id}),
          });
        }
      } catch(error) {
        if(witnessQuestion===question) {
          answerPending=null;
          witnessOptions();
          showError(clerkErrors[error.message] || error.message);
        }
      }
    });
  }
}
function answerLabel(answer) {
  return local(answer.ask.options.find(option=>option.id===answer.option)?.label) || t(...beats.unknown);
}
async function speakBallot(ballot,max=1550) {
  actor(ballot,ballot.seat);
  tickPlacard();
  await type(()=>finding(ballot.vote)+' · '+courtLine(ballot.reason),max,
    {emotion:ballot.emotion,reactionText:ballot.reason});
}

async function perform(event) {
  const {type:kind,data:d}=event;
  if(kind!=='status') showStamp(null);
  if(kind==='status') {
    phase(d.phase==='juror'?'jury':d.phase);
    actor('clerk',null);
    setMotion('waiting');
    showSpeech(()=>courtLine(d.text));
  } else if(kind==='clerk') {
    phase(d.phase);
    const ceremony=d.ceremony ?? (typeof d.text==='string'&&d.text.startsWith('全体起立'));
    actor('clerk','clerk',ceremony);
    if(!event.preview) record(()=>t(...roles.clerk)+' · '+t(...phases[d.phase]),event,()=>[{text:courtLine(d.text)}]);
    if(!event.preview && ceremony && d.phase==='opening' && previewRiseId===current.id) {
      previewRiseId=null;
      return;
    }
    if(ceremony) {
      showSpeech(()=>d.phase==='opening' ? local(openingRise) : courtLine(d.text));
      await order(d.phase==='judge'?'verdict':'rise');
    } else {
      if(d.phase==='rebuttal') await order('cross');
      if(d.phase==='jury' && current.mode==='uk') await order('summing-end');
      if(!queue.some(next=>next.type==='opening') || d.phase!=='opening') {
        ritualTyping=d.phase==='opening';
        await type(()=>courtLine(d.text),750);
        ritualTyping=false;
      }
    }
    if(d.phase==='jury' && !deliberated) await deliberate();
  } else if(kind==='lens') {
    current.lens=d;
    awaitingAsk=d.ask?.id;
    record(()=>t(...beats.lens),event,()=>lensParagraphs(d));
    if(!frozen && !d.ask && !queue.some(next=>next.type==='opening')) showSpeech(()=>local(d.core_decision));
  } else if(kind==='ask') {
    witnessQuestion=d;
    awaitingAsk=d.id;
    answerPending=null;
    actor('dock','dock');
    tone('ask');
    showSpeech(()=>local(d.question));
    witnessOptions();
    record(()=>t(...beats.witness),event,()=>[
      {text:local(d.question)},{text:d.options.map(option=>local(option.label)).join(' / ')},
      {text:local(d.why_it_matters)},
    ]);
    if(!liveQuestions() && !frozen) await hold(700);
  } else if(kind==='answer') {
    awaitingAsk=undefined;
    witnessQuestion=null;
    answerPending=null;
    witnessOptions();
    actor('dock','dock');
    tone('answer');
    const text=()=>t(...beats.answer)+' · '+answerLabel(d);
    showSpeech(text);
    record(()=>t(...beats.witness),event,()=>[{text:text()}]);
    if(!frozen) await hold(liveQuestions()?320:600);
  } else if(kind==='opening'||kind==='rebuttal') {
    phase(kind);
    actor(d.side,d.side);
    const paragraphs=()=>{
      const points=d.points.map(p=>({text:pointText(p,kind),id:refId(kind,d.side,p.number)}));
      if(d.speech) points.unshift({text:local(d.speech)});
      if(d.objection) points.push({text:local(d.objection.claim)+' · '+t(...stamps[d.objection.ruling])});
      const extra=local(kind==='opening'?d.concession:d.issue||d.key_point);
      if(extra) points.push({text:(kind==='opening'?t('承认 · ','Concession · '):t('关键点 · ','Issue · '))+extra});
      return points;
    };
    record(()=>t(...roles[d.side])+' · '+t(...phases[kind]),event,paragraphs);
    if(kind==='rebuttal') {
      await order('cross');
      if(d.objection) {
        actor(d.objection.by,d.objection.by);
        await objection('objection',true);
        await type(()=>local(d.objection.claim),1250);
        if(frozen) showStamp(d.objection.ruling);
        else await objection(d.objection.ruling,true);
      }
    }
    const cues=[];
    if (kind==='rebuttal') {
      let offset=0;
      for (const point of d.points) {
        cues.push({offset,text:point.survives ? point.response : pointText(point,kind),emotion:point.emotion});
        offset += [...pointText(point,kind)].length+1;
      }
    }
    await type(()=>paragraphs().map(p=>p.text).join('\n'),kind==='opening'?6500:4900,{emotion:d.emotion,cues});
  } else if(kind==='summing') {
    phase(kind);
    actor('judge','judge');
    record(()=>t(...phases.summing),event,()=>[{text:local(d.speech)}]);
    await type(()=>local(d.speech),4900,{emotion:d.emotion,reactionText:d.speech});
    await order('summing-end');
  } else if(kind==='juror') {
    await deliberate();
    current.jury.push(d);
    stage.state.votes.set(d.seat,d.vote);
    phase('jury');
    record(()=>jurorName(d)+' · '+finding(d.vote),event,()=>[
      {text:courtLine(d.reason)},
      {text:t('决定性事实 · ','Deciding fact · ')+(local(d.deciding_fact)||'—')},
      {text:t('翻票条件 · ','Would flip if · ')+(local(d.would_flip_if)||'—')},
    ]);
    if(current.mode==='uk') {stage.refreshTags();tickPlacard();}
    else await speakBallot(d,2400);
  } else if(kind==='revote') {
    current.jury=d.ballots;
    for(const ballot of d.ballots) stage.state.votes.set(ballot.seat,ballot.vote);
    stage.refreshTags();
    tickPlacard();
    if((d.ballots||[]).filter(ballot=>ballot.changed).length>=2) tone('gasp');
    record(()=>t(...beats.revote),event,()=>d.ballots.map(ballot=>({text:jurorName(ballot)+' · '+
      finding(ballot.vote)+(ballot.changed?' · '+t(...beats.changed):'')+' · '+local(ballot.reason)+
      (ballot.change_basis?' · '+local(ballot.change_basis):'')})));
  } else if(kind==='tally') {
    current.tally=d;
    if(current.mode==='uk' && (!frozen || query.get('freeze')==='jury')) {
      if(!frozen) await hold(400);
      const focus=d.focus||current.jury.slice(0,2).map(ballot=>ballot.seat);
      for(const seat of frozen?focus.slice(0,1):focus) {
        const ballot=current.jury.find(item=>item.seat===seat);
        if(ballot) await speakBallot(ballot);
      }
    }
    if(!(frozen && query.get('freeze')==='jury')) actor('clerk','clerk');
    const text=()=>t('计票结果 · ','Tally · ')+finding(d.finding)+' · '+score(d)+
      (d.abstained?t(' · '+d.abstained+' 人未表决',' · '+d.abstained+' abstained'):'');
    record(()=>t('书记员 · 唱票结束','Clerk · Tally complete'),event,()=>[{text:text()}]);
    if(!(frozen && query.get('freeze')==='jury')) {tickPlacard();await type(text,1100);}
  } else if(kind==='verdict') {
    phase('judge');
    actor('judge','judge');
    await order('verdict');
    if(soundOn && !frozen) await hold(stage.reduced.matches ? 200 : 1260);
    tone(verdictCue());
    const text=()=>t('本庭宣判 · ','Verdict · ')+finding(current.tally.finding)+'\n'+local(d.sentence);
    record(()=>t(...phases.judge),event,()=>[{text:text()},...(d.recommendation?[
      {text:t(...beats.recommendation)+' · '+d.recommendation+' · '+local(d.recommendation_reason)},
    ]:[])]);
    await type(text,5200,{emotion:d.emotion,reactionText:d.sentence});
    current.verdict=d;
    if(frozen) renderVerdict(d);
    else playClose();
  } else if(kind==='done') {
    setMotion('done');
    stage.state.active=null;
    stage.state.ceremony=false;
    stage.refreshTags();
    if(current.verdict&&!frozen) {playClose();renderVerdict(current.verdict);}
    refreshHistory(true);
  } else if(kind==='error') {
    awaitingAsk=undefined;
    witnessQuestion=null;
    answerPending=null;
    witnessOptions();
    phase('error');
    actor('clerk',null);
    setMotion('error');
    stopBed();
    tone('ruling');
    showSpeech(()=>errorText(d.text));
    record(()=>t(...motions.error),event,()=>[{text:errorText(d.text)}]);
    refreshHistory(true);
  }
}
function nextPlayable(events) {
  const next=events[0];
  if(!next) return -1;
  const needsLens=next.type==='opening' && next.data.await_lens && !current.lens;
  if(needsLens || (awaitingAsk && !['ask','answer','error'].includes(next.type))) {
    return events.findIndex(event=>['lens','ask','answer','error'].includes(event.type));
  }
  return 0;
}
async function enqueue(event) {
  queue.push(event);
  if((event.type==='opening' && ritualTyping) || (event.type==='ask' && liveQuestions())) finishFrame?.();
  if(playing) return;
  playing=true;
  paintSkip();
  for(let index=nextPlayable(queue);index>=0;index=nextPlayable(queue)) {
    const [next]=queue.splice(index,1);
    if(next.type==='error') queue.length=0;
    if(!['status','done','error'].includes(next.type)) setMotion('running');
    await perform(next);
    // While skipping, yield now and then so taps and paints are not starved.
    if(fastForward && ++skipBatch%6===0) await new Promise(resolve=>setTimeout(resolve,0));
    if(!queue.length&&!witnessQuestion&&!['done','error'].includes(next.type)) {
      stage.state.active=null;
      stage.state.ceremony=false;
      stage.refreshTags();
    }
  }
  playing=false;
  paintSkip();
  if(fastForward && current?.verdict) {
    fastForward=false;
    if(!frozen) {renderVerdict(current.verdict);$('#verdict').scrollIntoView({block:'start'});}
  }
  playbackDone?.();
  playbackDone=null;
}
function watch(id,cursor=0) {
  stream=new EventSource('/api/trials/'+id+'/events'+(cursor?'?after='+cursor:''));
  for(const name of eventNames) stream.addEventListener(name,event=>{
    if(!event.data) {
      setMotion('reconnect');
      return;
    }
    if(+event.lastEventId<=cursor) return;
    if(name==='done'||name==='error') stream.close();
    enqueue({type:name,time:event.timeStamp?new Date().toISOString():null,data:JSON.parse(event.data)});
  });
}
function courtPass() {
  const field=$('#court-pass');
  if(field?.value) return field.value;
  return legacyPass || '';
}
function courtSession() {
  try {return localStorage.getItem('court-session') || '';} catch {return '';}
}
function hasCourtAuth() {return !!(courtPass() || courtSession());}
function clearStoredPass() {
  try {localStorage.removeItem('court-pass');localStorage.removeItem('court-seal-key');} catch {}
}
function saveSession(session) {
  if(typeof session!=='string' || !/^[0-9a-f]{48}$/.test(session)) return;
  legacyPass='';
  try {
    if($('#remember-pass')?.checked) localStorage.setItem('court-session',session);
    else localStorage.removeItem('court-session');
    clearStoredPass();
  } catch {}
}
function paintPassField() {
  const field=$('#court-pass');
  if(!field) return;
  field.placeholder=courtSession()?t('已在此设备记住，无需再输入','Remembered on this device'):'';
}
function clearSession() {
  legacyPass='';
  try {localStorage.removeItem('court-session');clearStoredPass();} catch {}
}
async function privateData(path,body) {
  const pass=courtPass(), session=!pass && courtSession();
  const payload={...body};
  if(pass) payload.pass=pass;
  else if(session) payload.session=session;
  const result=await api(CLERK+path,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
    body:JSON.stringify(payload)});
  if(result.session) saveSession(result.session);
  return result;
}
async function trialData(id) {
  if(!replayOnly) return api('/api/trials/'+encodeURIComponent(id));
  if(id==='sample_trial') return api('data/sample_trial.json');
  if(!isPrivateId(id)) throw new Error('找不到该案。');
  if(!hasCourtAuth()) {
    $('#court-pass').focus();
    throw new Error(passPrompt);
  }
  try {
    return (await privateData('/case',{id})).trial;
  } catch(error) {
    if(error.message==='pass' || error.message==='locked') {
      clearSession();
      throw new Error(clerkErrors[error.message]);
    }
    throw new Error('找不到该案。');
  }
}
function replayLink(link,id,freeze) {
  link.href=urlFor(id,freeze);
  if(!replayOnly || !isPrivateId(id)) return;
  link.addEventListener('click',async event=>{
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      await replay(id,freeze,false,undefined,true);
      history.replaceState(null,'',urlFor(id,freeze));
    } catch(error) {showError(error.message);}
  });
}
async function refreshHistory(reload=false) {
  const list=$('#history-list');
  const request=++historyRequest;
  const authed=replayOnly && hasCourtAuth();
  let privateUnavailable=false;
  try {
    if(replayOnly) {
      const demo=await api('data/index.json').catch(()=>[]);
      const records=authed ? await privateData('/archive',{}).catch(error=>{
        if(error.message==='pass'||error.message==='locked') clearSession();
        privateUnavailable=true;
        return {trials:[]};
      }) : {trials:[]};
      if(request!==historyRequest || authed!==hasCourtAuth()) return;
      archive=[...records.trials.filter(trial=>isPrivateId(trial.id)),
        ...demo.filter(trial=>trial.id==='sample_trial')];
    } else if(!archive || reload) {
      archive=await api('/api/trials');
    }
    list.replaceChildren();
    if(!archive.length && !replayOnly) list.textContent=t('暂无案卷。','No cases yet.');
    for(const trial of archive) {
      const row=element('div',undefined,list);row.className='history-row';
      replayLink(element('a',local(trial.summary),row),trial.id);
      const text=trial.finding?finding(trial.finding)+' · '+trial.score.join('–'):t(...motions[trial.state==='error'?'error':'running']);
      const meta=element('span',t(...modes[trial.mode])+(trial.round>1?' · '+roundLabel(trial.round):'')+' · '+text,row);
      meta.title=new Date(trial.time).toLocaleString(lang==='zh'?'zh-CN':'en-GB');
    }
    if(replayOnly && !authed) element('p',errorText(passPrompt),list);
    if(privateUnavailable) element('p',t('暂时无法读取私人案卷。','Could not load the private archive.'),list);
  } catch {
    list.textContent=t('暂时无法读取案卷。','Could not load the archive.');
  }
}
function showError(value) {
  problem=value;
  $('#form-error').textContent=errorText(value);
  $('#form-error').hidden=false;
}
async function submit(fixture) {
  if(replayOnly) {
    location.href=urlFor('sample_trial');
    return;
  }
  const form=$('#case-form'), buttons=form.querySelectorAll('button');
  $('#form-error').hidden=true;
  buttons.forEach(button=>{button.disabled=true;});
  try {
    const data=new FormData(form);
    const {id}=await api('/api/trials'+(fixture?'/fixture':''), {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(fixture?{lang}:{case:data.get('case'),mode:data.get('mode'),lang}),
    });
    const mode=fixture?'uk':data.get('mode')||'uk';
    const trial={id,mode,case:fixture?'':data.get('case'),seats:Array.from({length:12},(_,seat)=>seat)};
    history.replaceState(null,'',urlFor(id));
    if(mode==='uk') previewRise(trial,fixture?'fixture':'live');
    else stageView(trial,'live');
    watch(id);
    if(fixture) {
      trialData(id).then(record=>{
        if(current?.id!==id) return;
        current.case=record.case;
        current.case_display=record.case_display;
        refreshRecordHeader();
      }).catch(()=>{});
    }
    refreshHistory(true);
  } catch(error) {
    showError(error.message);
  } finally {
    buttons.forEach(button=>{button.disabled=false;});
  }
}
function waitingDesk(onStage) {
  const status=$('#lodged-status');
  status.hidden=false;
  $('#lodge-case').disabled=true;
  if(!onStage) return;
  session='lodged';
  refreshSession();
  phase('lodged');
  actor('clerk','clerk');
  showSpeech(lodgedSpeech);
  type(lodgedSpeech);
  status.scrollIntoView({block:'center',behavior:stage.reduced.matches?'instant':'smooth'});
}
function schedulePoll() {
  setTimeout(pollLodge,3000);
}
async function pollLodge() {
  if(!pending) return;
  const caseId=pending.case_id, pass=courtPass(), session=courtSession();
  try {
    if((!pass && !session) || (pass && rejectedPollPass===pass && Date.now()<retryPollAt)) {
      schedulePoll();
      return;
    }
    const {trial}=await privateData('/case',{id:caseId});
    if(trial?.events?.length && (trial.id===caseId || trial.case_id===caseId)) {
      await initial.catch(()=>{});
      if(pollingId!==trial.id) {
        polledEvents.clear();
        await replay(trial.id,undefined,true,trial);
        trial.events.forEach(event=>polledEvents.add(event.id));
        history.replaceState(null,'',urlFor(trial.id));
        pollingId=trial.id;
      } else if(!frozen) {
        current.state=trial.state;
        current.events=trial.events;
        for(const event of trial.events) {
          if(polledEvents.has(event.id)) continue;
          polledEvents.add(event.id);
          enqueue(event);
        }
      }
      if(trial.state==='done' || trial.state==='error') {
        pending=null;
        try {localStorage.removeItem('court-pending-case');} catch {}
        $('#lodged-status').hidden=true;
        $('#lodge-case').disabled=false;
        await refreshHistory(true);
        return;
      }
    }
  } catch(error) {
    if(error.message==='pass' || error.message==='locked') {
      rejectedPollPass=pass;
      retryPollAt=error.message==='locked' ? Date.now()+15*60*1000 : Infinity;
      if(!pass) clearSession();
      showError(clerkErrors[error.message]);
    }
  }
  schedulePoll();
}
const clerkErrors={pass:'法庭通行令不正确。',locked:'通行令错误次数过多，请十五分钟后再试。',config:'书记官尚未就位，请稍后再试。',
  day_cap:'今日立案名额已满，请明日再试。',forward:'书记官无法联系法庭，请稍后再试。',charge:'请输入 1 至 200 字案由。',background:'案情陈述最多 4000 字。',
  rate:'提交过于频繁，请稍后再试。',round:'续审次数已用完，或上一次审理尚未结束。',amendment:'补充案情请写 1 至 1000 字。',answered:'这个问题已经作答。',ask:'找不到该证人问题。',option:'请选择有效选项。',missing:'找不到该案。'};
async function lodge(continuation) {
  if(lodging) return;
  if(pending) return showError('上一件案子还在审理，请等它结束后再续审。');
  $('#form-error').hidden=true;
  const rawCharge=continuation?continuation.charge:$('#charge').value, rawBackground=continuation?'':$('#background').value,
    pass=$('#court-pass').value.trim().toLowerCase();
  if(continuation && privateCase.test(continuation.amendment)) return showError('案由触发隐私门禁。请删除敏感信息后再开庭。');
  const charge=rawCharge.trim(), background=rawBackground.trim();
  if(!charge || [...rawCharge].length>200) return showError('请输入 1 至 200 字案由。');
  if([...rawBackground].length>4000) return showError('案情陈述最多 4000 字。');
  if(privateCase.test(charge) || privateCase.test(background)) {
    return showError('案由触发隐私门禁。请删除敏感信息后再开庭。');
  }
  const savedSession=!pass && courtSession();
  if(!pass && !savedSession) return showError('请出示法庭通行令。');
  const language=continuation?.lang==='en'||continuation?.lang==='zh'?continuation.lang:lodgeLanguage || lang;
  const extra=continuation?{parent_case_id:continuation.parent_case_id,round:continuation.round,amendment:continuation.amendment}:{};
  lodging=true;
  $('#lodge-case').disabled=true;
  try {
    const case_id=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const submittedAt=new Date().toISOString();
    let response, result={};
    try {
      response=await fetch(CLERK,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
        body:JSON.stringify({charge,background,lang:language,case_id,...extra,...(pass?{pass}:{session:savedSession})})});
      result=await response.json().catch(()=>({}));
    } catch {
      return showError('书记官未能立案，请重试。');
    }
    if(!response.ok || !result.ok) {
      if(response.status===401) {
        $('#court-pass').value='';
        clearSession();
        paintPassField();
        refreshHistory();
        if(savedSession) return showError('记住的登录已失效，请重新输入法庭通行令。');
      }
      return showError(clerkErrors[result.error] || '书记官未能立案，请重试。');
    }
    if(result.session) saveSession(result.session);
    else clearStoredPass();
    $('#court-pass').value='';
    paintPassField();
    pending={case_id:result.case_id||case_id,submittedAt};
    try {localStorage.setItem('court-pending-case',JSON.stringify(pending));} catch {}
    waitingDesk(false);
    if(continuation) {
      $('#verdict').hidden=true;
      transcript.length=0;
      $('#entries').replaceChildren();
      stage.state.votes.clear();
      transition=null;
      deliberated=false;
    }
    previewRise({id:pending.case_id,mode:'uk',case:charge,round:continuation?.round,seats:Array.from({length:12},(_,seat)=>seat)},'lodged');
    if(continuation) {history.replaceState(null,'',urlFor(pending.case_id));scrollTo({top:0});}
    refreshHistory(true);
    schedulePoll();
  } finally {
    lodging=false;
    $('#lodge-case').disabled=!!pending;
  }
}
async function replay(id,freeze,filed=false,trial,reset=false) {
  trial ??= await trialData(id);
  if(filed || reset) {
    switching=true;
    queue.length=0;
    finishFrame?.();
    if(playing) await new Promise(resolve=>{playbackDone=resolve;});
    switching=false;
    transcript.length=0;
    $('#entries').replaceChildren();
    $('#verdict').hidden=true;
    $('#form-error').hidden=true;
    $('.layout').after($('#form-error'),$('#verdict'));
    document.body.classList.toggle('frozen',false);
    document.body.classList.toggle('freeze-verdict',false);
    stage.state.votes.clear();
    Object.assign(stage.state,{whisper:false,strike:0,shake:0,reactionUntil:0,hasSpeech:false});
    transition=null;
    deliberated=false;
    fastForward=false;
    closePlayed=false;
    stopOpen();
    stopBed();
    awaitingAsk=undefined;
    witnessQuestion=null;
    answerPending=null;
    witnessOptions();
  }
  frozen=['opening','rebuttal','jury','verdict'].includes(freeze);
  stage.state.frozen=frozen;
  const ownFiling=replayOnly && pending && [id,trial.case_id].includes(pending.case_id);
  stageView(trial,frozen?'freeze':filed||ownFiling?'filed':!replayOnly&&trial.state==='running'?'live':'replay');
  if(ownFiling && !filed) {
    pollingId=trial.id;
    trial.events.forEach(event=>polledEvents.add(event.id));
  }
  if(frozen) {
    const targets={opening:'opening',rebuttal:'rebuttal',jury:'juror',verdict:'verdict'};
    document.body.classList.add('frozen');
    const juryFrames=trial.events.flatMap((event,index)=>event.type==='juror'?[index]:[]);
    const firstTally=trial.events.findIndex(event=>event.type==='tally');
    let end=freeze==='jury' ? (trial.mode==='uk' && firstTally>=0 ? firstTally :
      (juryFrames[Math.min(4,Math.floor(juryFrames.length/2))] ?? -1))
      : trial.events.map(event=>event.type).lastIndexOf(targets[freeze]);
    if(end<0) {
      showSpeech(()=>t('这场庭审尚未到达所选阶段。','This trial has yet to reach that phase.'));
      return;
    }
    if(freeze==='opening') {
      const cross=trial.events.findIndex(event=>event.type==='clerk' && event.data.phase==='rebuttal');
      const witnessEnd=trial.events.findIndex((event,index)=>event.type==='answer' && (cross<0 || index<cross));
      end=Math.max(end,witnessEnd);
    }
    const frames=trial.events.slice(0,end+1);
    for(let index=nextPlayable(frames);index>=0;index=nextPlayable(frames)) {
      const [event]=frames.splice(index,1);
      await perform(event);
    }
    if(freeze==='verdict') {
      document.body.classList.add('freeze-verdict');
      $('.layout').insertBefore($('#verdict'),$('#transcript'));
    }
    setMotion('frozen');
    return;
  }
  trial.events.forEach(enqueue);
  if(!replayOnly&&trial.state==='running') watch(id,trial.events.at(-1)?.id||0);
}
function refreshRecordHeader() {
  if(!current) return;
  $('#case-text').textContent=local(current.case_display||current.case);
  const list=$('#freeze-links');
  list.replaceChildren();
  replayLink(element('a',t('从头重播','Replay'),list),current.id);
  for(const [key,name] of Object.entries({opening:'opening',rebuttal:'rebuttal',jury:'jury',verdict:'judge'})) {
    replayLink(element('a',t(...shortPhases[name]),list),current.id,key);
  }
}
function updateCase() {
  const field=$('#case'), length=[...field.value].length;
  $('#count').textContent=length+' / 2000';
  field.setCustomValidity(length>2000?t('案由最多 2000 字。','Limit the case to 2,000 characters.'):
    field.validity.valueMissing?t('请输入案由。','Enter a case.'):'');
}
function localize() {
  document.documentElement.lang=t('zh-CN','en-GB');
  document.title=t('AI 法庭','The Courtroom');
  const strings={
    '.brand span:last-child': [t('AI 法庭','The Courtroom')],
    '.petition .eyebrow':[replayOnly?'COURT OFFICE':t('立案','Case intake')],
    'h1':[replayOnly?t('立案','File a Case'):t('提交案由','Submit a case')],
    '.intro':[replayOnly?t('出示法庭通行令，书记官即受理立案。','Present your court pass and the clerk will lodge the case.'):
      t('让控辩双方交锋，由陪审团裁决。','Hear both sides and watch the jury decide.')],
    'label[for=case]':[t('案由','Case')],'.field-note span:first-child':[t('请勿写入敏感信息','Keep sensitive information out')],
    '#live-mode legend':[t('审理方式','Trial mode')],
    '#start-trial':[t('开庭 ▸','Start trial ▸')],
    '#clerk-title':[t('书记官','Clerk of the Court')],
    'label[for=charge]':[t('案由','Charge')],
    'label[for=background]':[t('案情陈述','Statement of Case')],
    '#lodge-language':[t('庭审语言','Trial language')],
    '#lodge-case':[t('提交立案','Lodge the Case')],
    '#pass-label':[t('法庭通行令','Court pass')],
    '#remember-label':[t('在此设备保持登录（30 天）','Stay signed in on this device (30 days)')],
    '#lodged-status':[lodgedSpeech()],
    '#fixture':[t('观看示范','Watch demo')],
    '#skip':[t('跳过动画 · 直接看判决 ⏭','Skip to the verdict ⏭')],
    '#sound':[soundOn?t('声音开启','Sound on'):t('声音关闭','Sound off')],
    '.mast a[href="#history"], #history h2':[t('历史案卷','Archive')],
    '#history .eyebrow':[t('案卷','Saved cases')],
    '#transcript .eyebrow':[t('庭审记录','Court record')],
    '#transcript h2':[t('书记员记录','Clerk’s record')],
    '.record-footer > a':[replayOnly?t('返回案卷 ↗','Back to cases ↗'):t('新一场庭审 ↗','New trial ↗')],
    '.footer span:first-child':[disclaimer()],
  };
  for(const [selector,[value]] of Object.entries(strings)) {
    document.querySelectorAll(selector).forEach(node=>{node.textContent=value;});
  }
  const footer=$('.footer span:last-child');
  footer.firstChild.textContent=credit();
  footer.querySelector('a').textContent=t('Alex Chen 的 /court skill（MIT）','Alex Chen’s /court skill (MIT)');
  $('.mast nav').ariaLabel=t('法庭工具','Court controls');
  $('.theater').ariaLabel=t('像素法庭','Pixel courtroom');
  $('#stage').ariaLabel=t('英国刑事法院：法官、被告席、控辩双方和十二席陪审团',
    'Crown Court with a judge, dock, barristers and twelve jury seats');
  $('#transcript').ariaLabel=t('书记员记录','Clerk’s record');
  $('#steps').ariaLabel=t('庭审阶段','Trial phases');
  $('#case').placeholder=t('写下一个想法，以及你打算怎么推进…','Describe an idea and how you plan to pursue it…');
  for(const [mode,detail] of Object.entries({
    uk:t('12 人 · 9 次调用 · 10–2 多数门槛','12 jurors · 9 calls · 10–2 majority'),
    full:t('12 人 · 17 次调用 · 简单多数','12 jurors · 17 calls · simple majority'),
  })) {
    const span=$('input[value='+mode+']').nextElementSibling;
    span.firstChild.textContent=t(...modes[mode]);
    span.querySelector('small').textContent=detail;
  }
  document.querySelectorAll('#steps [data-phase]').forEach(node=>{node.textContent=t(...shortPhases[node.dataset.phase]);});
  $('.brand').href=$('.record-footer > a').href=urlFor();
  $('#language').ariaLabel=t('切换为英语','Switch to Chinese');
  if(replayOnly) $('input[name=lodge-lang][value='+(lodgeLanguage||lang)+']').checked=true;
  updateCase();
  refreshSession();
  refreshRecordHeader();
  phase(phaseName);
  setMotion(motion);
  actor(activeActor[0],stage.state.active,stage.state.ceremony);
  showStamp(stampText);
  $('#speech').textContent=lastSpeech();
  witnessOptions();
  const opened=[...$('#entries').children].map(node=>node.open);
  $('#entries').replaceChildren();
  transcript.forEach((entry,index)=>{drawEntry(entry);$('#entries').lastElementChild.open=opened[index]||false;});
  if(!$('#verdict').hidden) renderVerdict(current.verdict);
  if(!$('#form-error').hidden) showError(problem);
  refreshHistory();
}

$('#language').addEventListener('click',()=>{
  finishFrame?.();
  lang=t('en','zh');
  try {localStorage.setItem('court-language',lang);} catch {}
  const url=new URL(location.href);
  url.searchParams.set('lang',lang);
  history.replaceState(null,'',url);
  localize();
});
soundWanted=readSoundPref();
paintSound();
if (soundWanted) {
  const arm=event=>{
    if (event.target?.closest?.('#sound')) return;
    document.removeEventListener('pointerdown',arm,true);
    document.removeEventListener('keydown',arm,true);
    if (soundWanted && !soundOn) setSound(true);
  };
  document.addEventListener('pointerdown',arm,true);
  document.addEventListener('keydown',arm,true);
}
$('#sound').addEventListener('click',event=>{
  event.preventDefault();
  setSound(!soundOn);
});
document.addEventListener('visibilitychange', onForeground);
window.addEventListener('pageshow', onForeground);

function paintSkip() {
  const button=$('#skip');
  if(button) button.hidden=!playing || frozen;
}
let skipQueued=false;
$('#skip').addEventListener('click',()=>{
  if(skipQueued) return;
  fastForward=true;
  // Audio stays inside the tap so iOS keeps the user gesture.
  stopOpen();
  playClose();
  stage.state.whisper=false;
  stage.state.speechStart=-Infinity;
  stage.state.reactionUntil=stage.state.strike=stage.state.shake=0;
  showStamp(null);
  const button=$('#skip');
  button.classList.add('busy');
  skipQueued=true;
  // Paint the press first, then fast-forward the remaining records.
  requestAnimationFrame(()=>setTimeout(()=>{
    skipQueued=false;
    button.classList.remove('busy');
    finishFrame?.();
    if(!playing && current?.verdict && !frozen) {fastForward=false;renderVerdict(current.verdict);$('#verdict').scrollIntoView({block:'start'});}
  },0));
});
// Instant pressed state on touch: iOS only applies :active when a touch listener exists.
document.addEventListener('touchstart',()=>{},{passive:true});
document.addEventListener('pointerdown',event=>{
  if (event.target?.closest?.('#sound') && !soundOn) warmSoundCtx();
  const target=event.target?.closest?.('button,a,summary,label');
  if(!target || target.disabled) return;
  target.classList.add('pressing');
  const release=()=>{
    setTimeout(()=>target.classList.remove('pressing'),90);
    document.removeEventListener('pointerup',release,true);
    document.removeEventListener('pointercancel',release,true);
  };
  document.addEventListener('pointerup',release,true);
  document.addEventListener('pointercancel',release,true);
},{capture:true,passive:true});
$('#case').addEventListener('input',updateCase);
$('#case-form').addEventListener('submit',event=>{event.preventDefault();if(replayOnly) lodge();else submit(false);});
$('#fixture').addEventListener('click',()=>submit(true));
if(replayOnly) {
  lastSpeech=()=>t('可向书记官立案、查阅历史案卷或观看示范。','File with the clerk, browse the archive, or watch the demo.');
  for(const selector of ['label[for=case]','#case','.field-note','#live-mode','#start-trial']) $(selector).hidden=true;
  $('#case-form').noValidate=true;
  $('#case').disabled=true;
  $('#charge').disabled=false;
  $('#lodge-desk').hidden=$('#lodge-case').hidden=false;
  document.querySelectorAll('input[name=lodge-lang]').forEach(input=>{
    input.addEventListener('change',()=>{lodgeLanguage=input.value;});
  });
  try {
    legacyPass=localStorage.getItem('court-pass') || '';
    clearStoredPass();
    $('#remember-pass').checked=true;
    paintPassField();
  } catch {legacyPass='';}
  $('#court-pass').addEventListener('change',()=>{
    rejectedPollPass=undefined;
    refreshHistory(true);
    if(linkedTrial && isPrivateId(linkedTrial) && !current && hasCourtAuth()) {
      replay(linkedTrial,query.get('freeze'),false,undefined,true).catch(error=>showError(error.message));
    }
  });
  try {
    const saved=JSON.parse(localStorage.getItem('court-pending-case'));
    if(saved && /^[0-9a-f]{32}$/.test(saved.case_id) && Number.isFinite(Date.parse(saved.submittedAt))) pending=saved;
  } catch {}
}
try {localStorage.setItem('court-language',lang);} catch {}
stage.refreshTags();
localize();
const initial=linkedTrial!==null?replay(linkedTrial,query.get('freeze')):Promise.resolve();
if(pending) {
  waitingDesk(linkedTrial===null);
  if(!hasCourtAuth()) {
    $('#court-pass').focus();
    showError(passPrompt);
  }
  schedulePoll();
}
initial.catch(error=>showError(error.message)).finally(()=>{
  requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__courtReady=true;}));
});
