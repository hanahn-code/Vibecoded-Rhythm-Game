const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const views = ['#homeView','#analyzeView','#setupView','#gameView','#resultsView'];
const keys = ['d','f','j','k','l'];
const keyToLane = {d:0,f:1,j:2,k:3,l:4};
const state = {
  file:null, buffer:null, audioCtx:null, masterGain:null, source:null, startedAt:0, pausedAt:0,
  bpm:120, offset:0, speed:7, difficulty:'normal', failOnZero:false, notes:[], playing:false,
  score:0, combo:0, maxCombo:0, life:100, results:{perfect:0,great:0,good:0,miss:0},
  raf:null, muted:false, countdown:false
};

function showView(id){ views.forEach(v=>$(v).classList.toggle('hidden',v!==id)); }
function formatTime(sec){ sec=Math.max(0,sec||0); return `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`; }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(el.timer); el.timer=setTimeout(()=>el.classList.remove('show'),2200); }

$('#chooseBtn').onclick=()=>$('#fileInput').click();
$('#dropZone').onclick=(e)=>{ if(e.target.closest('button')) return; $('#fileInput').click(); };
$('#fileInput').onchange=(e)=>e.target.files[0]&&loadFile(e.target.files[0]);
['dragenter','dragover'].forEach(type=>$('#dropZone').addEventListener(type,e=>{e.preventDefault();$('#dropZone').classList.add('dragging')}));
['dragleave','drop'].forEach(type=>$('#dropZone').addEventListener(type,e=>{e.preventDefault();$('#dropZone').classList.remove('dragging')}));
$('#dropZone').addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)loadFile(f)});
$('#helpBtn').onclick=()=>$('#helpModal').classList.remove('hidden');
$('#closeHelp').onclick=()=>$('#helpModal').classList.add('hidden');
$('#helpModal').onclick=e=>{if(e.target===$('#helpModal'))$('#helpModal').classList.add('hidden')};
$('#soundBtn').onclick=()=>{state.muted=!state.muted;if(state.masterGain)state.masterGain.gain.setTargetAtTime(state.muted?0:1,state.audioCtx.currentTime,.01);$('#soundBtn').style.color=state.muted?'#ff3f8c':'';toast(state.muted?'Audio muted':'Audio on')};
$('#brandHome').onclick=e=>{e.preventDefault();stopGame();showView('#homeView');$('#fileInput').value=''};

async function loadFile(file){
  if(!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)){toast('Please choose an audio file.');return;}
  state.file=file; showView('#analyzeView'); setProgress(8,'Reading audio file','Loading waveform…');
  try{
    const arr=await file.arrayBuffer(); setProgress(25,'Decoding track','Finding the pulse…');
    state.audioCtx=state.audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    if(!state.masterGain){state.masterGain=state.audioCtx.createGain();state.masterGain.connect(state.audioCtx.destination)}
    state.buffer=await state.audioCtx.decodeAudioData(arr.slice(0)); setProgress(53,'Detecting transients','Finding the pulse…');
    await delay(120); state.bpm=detectBPM(state.buffer); setProgress(78,'Quantizing beat grid','Building your chart…');
    await delay(160); createChart(); setProgress(100,'Chart complete','Ready to play');
    await delay(360); populateSetup(); showView('#setupView');
  }catch(err){ console.error(err); showView('#homeView'); toast('This audio format could not be decoded. Try MP3 or WAV.'); }
}
function setProgress(n,step,title){$('#analysisProgress').style.width=n+'%';$('#analysisPercent').textContent=n+'%';$('#analysisStep').textContent=step;$('#analysisTitle').textContent=title}
const delay=ms=>new Promise(r=>setTimeout(r,ms));

function detectBPM(buffer){
  const data=buffer.getChannelData(0), rate=buffer.sampleRate, hop=1024;
  const envelope=[]; let prev=0;
  for(let i=0;i<data.length;i+=hop){let sum=0,end=Math.min(i+hop,data.length);for(let j=i;j<end;j++){const v=data[j];sum+=v*v}const rms=Math.sqrt(sum/(end-i));envelope.push(Math.max(0,rms-prev*.82));prev=rms}
  const envRate=rate/hop, minLag=Math.floor(envRate*60/190), maxLag=Math.ceil(envRate*60/65);
  let bestLag=Math.round(envRate*.5),best=-Infinity;
  for(let lag=minLag;lag<=maxLag;lag++){let score=0;for(let i=lag;i<envelope.length;i++)score+=envelope[i]*envelope[i-lag];score/=Math.max(1,envelope.length-lag);if(score>best){best=score;bestLag=lag}}
  let bpm=60*envRate/bestLag; while(bpm<75)bpm*=2;while(bpm>180)bpm/=2; return Math.round(bpm);
}

function energyAt(time){
  if(!state.buffer)return 0;const data=state.buffer.getChannelData(0),rate=state.buffer.sampleRate,start=Math.floor(time*rate),len=Math.floor(rate*.035);let sum=0;
  for(let i=start;i<Math.min(start+len,data.length);i+=6)sum+=Math.abs(data[i]);return sum/Math.max(1,len/6);
}
function seeded(i){const x=Math.sin(i*9283.17+state.bpm*17.3)*43758.5453;return x-Math.floor(x)}
function createChart(){
  const configs={easy:{division:1,threshold:.025,chord:0},normal:{division:2,threshold:.018,chord:.06},hard:{division:2,threshold:.011,chord:.18},expert:{division:4,threshold:.007,chord:.28}};
  const c=configs[state.difficulty],beat=60/state.bpm,step=beat/c.division,duration=Math.max(5,state.buffer.duration-1);let notes=[],lastLane=2;
  for(let t=Math.max(.8,beat*2),i=0;t<duration;t+=step,i++){
    const energy=energyAt(t),keep=state.difficulty==='easy'?(i%2===0||energy>c.threshold*2):(energy>c.threshold||i%c.division===0);
    if(!keep)continue;let lane=Math.floor(seeded(i)*5);if(lane===lastLane&&seeded(i+44)>.35)lane=(lane+1+Math.floor(seeded(i+7)*3))%5;lastLane=lane;
    notes.push({time:t,lane,hit:false,missed:false});
    if(c.chord&&seeded(i+90)<c.chord&&t>2)notes.push({time:t,lane:(lane+2+Math.floor(seeded(i+4)*2))%5,hit:false,missed:false});
  }
  state.notes=notes.sort((a,b)=>a.time-b.time);
}
function populateSetup(){
  const name=state.file.name.replace(/\.[^.]+$/,'');$('#trackName').textContent=name;$('#hudTitle').textContent=name;$('#resultTitle').textContent=name;
  $('#trackInfo').textContent=`${formatTime(state.buffer.duration)} · ${state.file.type.split('/')[1]?.toUpperCase()||'AUDIO'}`;$('#bpmValue').textContent=state.bpm;$('#lengthValue').textContent=formatTime(state.buffer.duration);$('#gameDuration').textContent=formatTime(state.buffer.duration);updateChartStats();
}
function updateChartStats(){createChart();$('#noteCount').textContent=state.notes.length;$('#densityValue').textContent=(state.notes.length/state.buffer.duration).toFixed(1)+'/s'}
$('#difficultyTabs').onclick=e=>{const b=e.target.closest('button');if(!b)return;$$('#difficultyTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.difficulty=b.dataset.level;updateChartStats()};
$('#offsetRange').oninput=e=>{state.offset=+e.target.value/1000;$('#offsetLabel').textContent=`${e.target.value>0?'+':''}${e.target.value} ms`};
$('#failOnZero').onchange=e=>{state.failOnZero=e.target.checked;toast(state.failOnZero?'Life failure enabled':'Life failure disabled')};
$('#speedDown').onclick=()=>setSpeed(state.speed-.5);$('#speedUp').onclick=()=>setSpeed(state.speed+.5);
function setSpeed(v){state.speed=Math.max(4,Math.min(11,v));$('#speedValue').textContent=state.speed.toFixed(1)}
$('#newTrackBtn').onclick=()=>{stopGame();showView('#homeView');$('#fileInput').value=''};
$('#playBtn').onclick=startGame;$('#retryBtn').onclick=startGame;$('#backSetupBtn').onclick=()=>{stopGame();showView('#setupView')};

async function startGame(){
  if(!state.buffer)return; stopGame(); resetRun(); showView('#gameView');resizeCanvas();
  state.countdown=true;$('#countdown').classList.remove('hidden');
  for(const v of ['3','2','1','GO!']){$('#countdown').textContent=v;await delay(v==='GO!'?450:650)}
  $('#countdown').classList.add('hidden');state.countdown=false;
  if(state.audioCtx.state==='suspended'&&!state.muted)await state.audioCtx.resume();
  state.source=state.audioCtx.createBufferSource();state.source.buffer=state.buffer;state.source.connect(state.masterGain);state.masterGain.gain.value=state.muted?0:1;state.startedAt=state.audioCtx.currentTime;state.source.start();state.playing=true;state.source.onended=()=>{if(state.playing)finishGame()};state.raf=requestAnimationFrame(gameLoop);
}
function resetRun(){state.score=0;state.combo=0;state.maxCombo=0;state.life=100;state.results={perfect:0,great:0,good:0,miss:0};state.notes.forEach(n=>{n.hit=false;n.missed=false});updateHud()}
function stopGame(){state.playing=false;cancelAnimationFrame(state.raf);if(state.source){try{state.source.onended=null;state.source.stop()}catch{}state.source=null}}
function currentTime(){return state.playing?state.audioCtx.currentTime-state.startedAt:0}

function gameLoop(){
  if(!state.playing)return;const now=currentTime()+state.offset;
  for(const n of state.notes){if(!n.hit&&!n.missed&&now-n.time>.18){n.missed=true;register('miss');if(!state.playing)return}}
  draw(now);$('#songProgress').style.width=Math.min(100,now/state.buffer.duration*100)+'%';$('#gameCurrent').textContent=formatTime(now);state.raf=requestAnimationFrame(gameLoop);
}
function hitLane(lane){
  if(!state.playing||state.countdown)return;const now=currentTime()+state.offset;let best=null,bestDiff=.2;
  for(const n of state.notes){if(n.lane!==lane||n.hit||n.missed)continue;const d=Math.abs(n.time-now);if(d<bestDiff){best=n;bestDiff=d}if(n.time>now+.22)break}
  pulseKey(lane);if(!best)return;best.hit=true;if(bestDiff<=.055)register('perfect');else if(bestDiff<=.105)register('great');else register('good');
}
function register(kind){
  state.results[kind]++;const values={perfect:1000,great:700,good:350,miss:0};if(kind==='miss'){state.combo=0;state.life=Math.max(0,state.life-5)}else{state.combo++;state.maxCombo=Math.max(state.maxCombo,state.combo);state.life=Math.min(100,state.life+(kind==='perfect'?1:.5));state.score+=values[kind]+state.combo*4}
  const j=$('#judgement');j.textContent=kind.toUpperCase();j.style.color={perfect:'#36d8ff',great:'#d9ff43',good:'#ffc14a',miss:'#ff3f8c'}[kind];j.classList.remove('show');void j.offsetWidth;j.classList.add('show');updateHud();if(kind==='miss'&&state.failOnZero&&state.life<=0)finishGame(true);
}
function updateHud(){$('#scoreValue').textContent=String(state.score).padStart(7,'0');$('#comboDisplay strong').textContent=state.combo;$('#comboDisplay').style.opacity=state.combo?'1':'.25';$('#lifeFill').style.width=state.life+'%'}
function pulseKey(lane){const el=$$('#laneKeys kbd')[lane];el.classList.add('active');setTimeout(()=>el.classList.remove('active'),90)}
window.addEventListener('keydown',e=>{if(e.repeat)return;const k=e.key.toLowerCase();if(keyToLane[k]!==undefined){e.preventDefault();hitLane(keyToLane[k])}if(e.key==='Enter'&&!$('#setupView').classList.contains('hidden'))startGame();if(e.key==='Escape'&&state.playing)pauseGame()});
$('#laneKeys').addEventListener('pointerdown',e=>{const k=e.target.closest('kbd');if(k){e.stopPropagation();hitLane([...k.parentNode.children].indexOf(k))}});
$('#gameStage').addEventListener('pointerdown',e=>{const r=e.currentTarget.getBoundingClientRect(),lane=Math.max(0,Math.min(4,Math.floor((e.clientX-r.left)/r.width*5)));hitLane(lane)});
$('#pauseBtn').onclick=pauseGame;
function pauseGame(){if(!state.playing)return;stopGame();showView('#setupView');toast('Run paused — chart reset')}

function resizeCanvas(){const c=$('#gameCanvas'),r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),playfieldWidth=Math.min(720,r.width*.82);c.width=r.width*d;c.height=r.height*d;c.dataset.d=d;$('#laneKeys').style.width=playfieldWidth+'px'}
window.addEventListener('resize',()=>{if(!$('#gameView').classList.contains('hidden'))resizeCanvas()});
function draw(now){
  const c=$('#gameCanvas'),ctx=c.getContext('2d'),d=+c.dataset.d||1,w=c.width/d,h=c.height/d;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
  const topY=-10,bottomY=h-54,topW=Math.min(190,w*.24),bottomW=Math.min(720,w*.82),cx=w/2;
  const xAt=(lane,y)=>{const p=(y-topY)/(bottomY-topY),width=topW+(bottomW-topW)*p;return cx-width/2+width*lane/5};
  const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'rgba(21,22,42,.1)');grad.addColorStop(1,'rgba(29,20,55,.78)');ctx.fillStyle=grad;ctx.beginPath();ctx.moveTo(cx-topW/2,topY);ctx.lineTo(cx+topW/2,topY);ctx.lineTo(cx+bottomW/2,bottomY);ctx.lineTo(cx-bottomW/2,bottomY);ctx.closePath();ctx.fill();
  for(let i=0;i<=5;i++){ctx.strokeStyle=i===0||i===5?'rgba(217,255,67,.25)':'rgba(255,255,255,.11)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xAt(i,topY),topY);ctx.lineTo(xAt(i,bottomY),bottomY);ctx.stroke()}
  ctx.strokeStyle='#d9ff43';ctx.shadowColor='#d9ff43';ctx.shadowBlur=12;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx-bottomW/2,bottomY);ctx.lineTo(cx+bottomW/2,bottomY);ctx.stroke();ctx.shadowBlur=0;
  const travel=1.15-(state.speed-4)*.07;
  for(const n of state.notes){if(n.hit||n.missed)continue;const delta=n.time-now;if(delta>travel||delta<-.22)continue;const p=1-delta/travel,y=topY+(bottomY-topY)*p*p;const left=xAt(n.lane,y),right=xAt(n.lane+1,y),pad=(right-left)*.13;const nh=10+22*p;
    const g=ctx.createLinearGradient(left,y,right,y);g.addColorStop(0,'#8c5bff');g.addColorStop(.5,'#ffffff');g.addColorStop(1,'#36d8ff');ctx.fillStyle=g;ctx.shadowColor='#36d8ff';ctx.shadowBlur=16*p;ctx.beginPath();ctx.roundRect(left+pad,y-nh/2,right-left-pad*2,nh,4);ctx.fill();ctx.shadowBlur=0;
  }
}
function finishGame(failed=false){
  stopGame();const judged=state.results.perfect+state.results.great+state.results.good+state.results.miss,total=failed?judged:state.notes.length,weighted=state.results.perfect+state.results.great*.8+state.results.good*.5,accuracy=total?weighted/total*100:0;let grade=failed?'F':accuracy>=95?'S':accuracy>=88?'A':accuracy>=75?'B':accuracy>=60?'C':'D';
  $('#resultStatus').textContent=failed?'GAME OVER':'SET COMPLETE';$('#resultStatus').classList.toggle('failed',failed);$('#gradeValue').textContent=grade;$('#finalScore').textContent=String(state.score).padStart(7,'0');$('#perfectCount').textContent=state.results.perfect;$('#greatCount').textContent=state.results.great;$('#goodCount').textContent=state.results.good;$('#missCount').textContent=state.results.miss;$('#maxCombo').textContent=state.maxCombo;$('#accuracyValue').textContent=accuracy.toFixed(1)+'%';$('#resultSubtitle').textContent=failed?'Your life reached zero. Try the chart again.':grade==='S'?'A flawless pulse. Incredible set.':grade==='A'?'A brilliant performance.':'Keep the rhythm going.';showView('#resultsView');
}
