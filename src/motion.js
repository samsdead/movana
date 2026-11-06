// This coach measures visible rhythm cues, not dance technique or weight transfer.
export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const mid=(points,a,b)=>({x:(points[a].x+points[b].x)/2,y:(points[a].y+points[b].y)/2});

export function features(points,aspect=1,metric='side'){
  const required=[11,12,23,24,...(metric==='reach'?[15,16]:[]),...(['side','march','bounce'].includes(metric)?[25,26,27,28]:[])];
  if(!points||required.some(i=>!points[i]||(points[i].visibility??0)<.65||points[i].x<.025||points[i].x>.975||points[i].y<.025||points[i].y>.975))return null;
  const shoulders=mid(points,11,12),hips=mid(points,23,24);
  const torso=Math.hypot((shoulders.x-hips.x)*aspect,shoulders.y-hips.y);
  if(torso<.08)return null;
  return {hipX:hips.x*aspect,hipY:hips.y,torso,
    sway:(shoulders.x-hips.x)*aspect/torso,
    reach:(points[16].y-points[15].y)/torso,
    march:((points[28]?.y??0)-(points[27]?.y??0))/torso};
}

export function calibrate(samples){
  if(samples.length<15)return null;
  const result={};for(const key of ['hipX','hipY','torso','sway','reach','march'])result[key]=median(samples.map(s=>s[key]));
  result.jitter=median(samples.map(s=>Math.abs(s.hipX-result.hipX)/result.torso));
  return result;
}

export function signal(sample,base,metric){
  if(!sample||!base)return null;
  if(metric==='side')return (sample.hipX-base.hipX)/base.torso;
  if(metric==='bounce')return (sample.hipY-base.hipY)/base.torso;
  return sample[metric]-base[metric];
}

export class MotionPeaks {
  constructor({metric='side',range='comfortable',jitter=0}={}){
    this.threshold=Math.max(({gentle:.045,comfortable:.075,expressive:.12}[range]||.075)*(metric==='reach'?3:1),jitter*4);
    this.metric=metric;this.reset();
  }
  reset(){this.previous=null;this.extreme=null;this.direction=0;this.lastEvent=-Infinity;this.lastTime=null;this.filtered=null;}
  update(value,time){
    if(value===null||!Number.isFinite(value)){this.reset();return null;}
    if(this.lastTime!==null&&time-this.lastTime>400)this.reset();
    const dt=this.lastTime===null?70:time-this.lastTime;this.lastTime=time;
    const alpha=1-Math.exp(-dt/70);this.filtered=this.filtered===null?value:this.filtered+alpha*(value-this.filtered);
    const current={value:this.filtered,time};let event=null;
    if(!this.extreme)this.extreme=current;
    if(!this.direction){if(Math.abs(current.value-this.extreme.value)>this.threshold)this.direction=Math.sign(current.value-this.extreme.value);}
    else if((current.value-this.extreme.value)*this.direction>1e-6){this.extreme=current;}
    else if(Math.abs(current.value-this.extreme.value)>this.threshold){
      // One extremum per deliberate reversal; tiny resting jitter earns no hits.
      if(this.extreme.time-this.lastEvent>260&&(this.metric!=='bounce'||this.direction===1)){
        event={time:this.extreme.time,direction:this.direction,amplitude:Math.abs(this.extreme.value)};this.lastEvent=event.time;
      }
      this.direction*=-1;this.extreme=current;
    }
    this.previous=current;return event;
  }
}

export function expectedBeat(beat,lessonId,metric){
  if(beat<0)return false;
  if(metric==='sway')return beat%2===0;
  if(lessonId==='salsa')return beat%4===0;
  if(lessonId==='step-touch'||metric==='reach')return beat%2===0;
  return true;
}

export class RhythmScore {
  constructor({bpm,startMs,lessonId,metric,totalBeats,offsetMs=0}){Object.assign(this,{bpm,startMs,lessonId,metric,totalBeats,offsetMs});this.observed=new Set();this.hits=new Map();this.lastObserved=null;}
  beatAt(time){return (time-this.startMs-this.offsetMs)/(60000/this.bpm);}
  observe(time,confident){
    const beat=this.beatAt(time),nearest=Math.round(beat);
    if(confident&&Math.abs(beat-nearest)<.3&&nearest<this.totalBeats&&expectedBeat(nearest,this.lessonId,this.metric))this.observed.add(nearest);
  }
  event(time){
    const beat=this.beatAt(time),nearest=Math.round(beat);
    const error=Math.abs(beat-nearest)*(60000/this.bpm);
    const tolerance=Math.min(210,(60000/this.bpm)*.32);
    if(nearest>=this.totalBeats||!this.observed.has(nearest)||this.hits.has(nearest)||!expectedBeat(nearest,this.lessonId,this.metric)||error>tolerance)return null;
    this.hits.set(nearest,error);return {beat:nearest,error,label:error<90?'Right on the beat':'Finding the beat'};
  }
  summary(time){
    const finished=Math.min(this.totalBeats-1,Math.floor(this.beatAt(time)-.5));
    const observed=[...this.observed].filter(b=>b<=finished);const hits=[...this.hits].filter(([b])=>b<=finished);
    let expected=0;for(let b=0;b<=finished;b++)if(expectedBeat(b,this.lessonId,this.metric))expected++;
    return {score:observed.length>=8?Math.round(hits.length/observed.length*100):null,hits:hits.length,observed:observed.length,expected,coverage:expected?Math.round(observed.length/expected*100):0};
  }
}

export const CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
export function drawPose(canvas,landmarks){
  const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);if(!landmarks)return;
  context.strokeStyle='#ffd447';context.lineWidth=3;context.lineCap='round';
  for(const [a,b] of CONNECTIONS){const p=landmarks[a],q=landmarks[b];if(p.visibility<.65||q.visibility<.65)continue;context.beginPath();context.moveTo(p.x*canvas.width,p.y*canvas.height);context.lineTo(q.x*canvas.width,q.y*canvas.height);context.stroke();}
  context.fillStyle='#f9fbff';for(const i of [11,12,13,14,15,16,23,24,25,26,27,28]){const p=landmarks[i];if(p.visibility<.65)continue;context.beginPath();context.arc(p.x*canvas.width,p.y*canvas.height,4,0,Math.PI*2);context.fill();}
}
