import test from 'node:test';
import assert from 'node:assert/strict';
import {features,calibrate,signal,MotionPeaks,RhythmScore,expectedBeat} from '../src/motion.js';
import {DanceAudio} from '../src/audio.js';

function pose(){const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:.99}));for(const [i,x,y] of [[11,.4,.25],[12,.6,.25],[23,.43,.55],[24,.57,.55],[25,.43,.72],[26,.57,.72],[27,.42,.9],[28,.58,.9],[15,.35,.45],[16,.65,.45]])Object.assign(points[i],{x,y});return points;}
test('movement normalized to the person’s torso is invariant to position and scale',()=>{
  const initial=pose(),moved=initial.map(p=>({...p,x:p.x+.025}));const first=features(initial,1.3),sample=features(moved,1.3);
  const transform=points=>points.map(p=>({...p,x:p.x*.75+.1,y:p.y*.75+.05}));
  const scaled=features(transform(initial),1.3),scaledSample=features(transform(moved),1.3);
  assert.ok(Math.abs(signal(sample,first,'side')-signal(scaledSample,scaled,'side'))<1e-10);
});
test('hidden feet disable footwork scoring but allow seated tracking',()=>{
  const p=pose();p[27].visibility=.1;assert.equal(features(p,1,'side'),null);assert.ok(features(p,1,'sway'));p[11].visibility=.2;assert.equal(features(p,1,'sway'),null);
});
test('calibration uses robust medians and requires enough visible frames',()=>{
  const f=features(pose());assert.equal(calibrate([f]),null);const list=Array.from({length:30},()=>({...f}));list[0].hipX=100;assert.equal(calibrate(list).hipX,f.hipX);
});
test('resting noise and tracking gaps cannot invent movement',()=>{
  const peaks=new MotionPeaks();for(let t=0;t<10000;t+=75)assert.equal(peaks.update(Math.sin(t)*.005,t),null);
  peaks.update(null,11000);assert.equal(peaks.update(.8,12000),null);
});
test('one movement can score at most one visible, eligible beat',()=>{
  const score=new RhythmScore({bpm:100,startMs:1000,lessonId:'step-touch',metric:'side',totalBeats:32});
  score.observe(2200,true);assert.ok(score.event(2280));assert.equal(score.event(2280),null);assert.equal(score.event(3400),null);score.observe(2800,true);assert.equal(score.event(2800),null);
});
test('stillness produces zero, unobservable motion produces no score',()=>{
  const score=new RhythmScore({bpm:100,startMs:0,lessonId:'house',metric:'bounce',totalBeats:32});for(let b=0;b<16;b++)score.observe(b*600,true);assert.equal(score.summary(10000).score,0);
  const missing=new RhythmScore({bpm:100,startMs:0,lessonId:'house',metric:'bounce',totalBeats:32});for(let b=0;b<16;b++)missing.observe(b*600,false);assert.equal(missing.summary(10000).score,null);assert.equal(missing.summary(10000).coverage,0);
});
test('salsa feedback counts only observable side accents, never holds',()=>{
  assert.deepEqual(Array.from({length:8},(_,i)=>expectedBeat(i,'salsa','side')),[true,false,false,false,true,false,false,false]);
});
test('movement on the beat scores above 80%; late movement scores less',()=>{
  function run(delay){const bpm=96,score=new RhythmScore({bpm,startMs:0,lessonId:'step-touch',metric:'side',totalBeats:48}),peaks=new MotionPeaks();for(let t=0;t<29000;t+=50){score.observe(t,true);const value=Math.cos((t-delay)/(60000/bpm)*Math.PI/2)*.3;const event=peaks.update(value,t);if(event)score.event(event.time);}return score.summary(29000).score;}
  assert.ok(run(0)>=80);assert.ok(run(300)<run(0));
});
test('resuming between beats retains the integer percussion grid',()=>{
  const audio=new DanceAudio();audio.context={currentTime:100};audio.stop=()=>{};audio.playStep=()=>{};audio.tone=()=>{};audio.start(96,'step-touch',192,3.37);assert.ok(Number.isInteger(audio.nextHalf));clearInterval(audio.timer);
});
