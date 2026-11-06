import React from 'react';
// Targets follow the learner's left and right. Counts 4 and 8 stay still.
export function salsaPoseAt(beat){
  const poses=[[55,118,-18],[55,118,0],[82,118,0],[82,118,0],[82,145,18],[82,145,0],[82,118,0],[82,118,0]];
  const position=Math.max(beat,0)%8,index=Math.floor(position),fraction=Math.min((position-index)*4,1),mix=fraction*fraction*(3-2*fraction);
  const previous=poses[(index+7)%8],current=poses[index];
  return current.map((value,i)=>previous[i]+(value-previous[i])*mix);
}
export default function Tutor({beat=0,lesson,mode='standing',small=false}){
  const seated=mode==='seated'||lesson.id==='seated',phase=Math.max(beat,0)%4;
  const sway=-Math.cos(phase*Math.PI/2)*18,pulse=(1+Math.cos(Math.max(beat,0)*Math.PI*2))*5;
  const salsa=lesson.id==='salsa'?salsaPoseAt(beat):null;
  const offset=seated?sway*.7:salsa?salsa[2]:lesson.id==='house'?0:sway;
  const bounce=lesson.id==='house'&&!seated?pulse:0;
  const leftReach=lesson.id==='disco'?Math.max(0,Math.cos(phase*Math.PI/2)):0,rightReach=lesson.id==='disco'?Math.max(0,-Math.cos(phase*Math.PI/2)):0,hipY=seated?158:154+bounce;
  const p={head:[100+offset,43+bounce],neck:[100+offset,67+bounce],ls:[80+offset,78+bounce],rs:[120+offset,78+bounce],le:[64+offset-leftReach*9,115+bounce-leftReach*60],re:[136+offset+rightReach*9,115+bounce-rightReach*60],lw:[66+offset-leftReach*28,135+bounce-leftReach*111],rw:[134+offset+rightReach*28,135+bounce-rightReach*111],lh:[86+offset*.5,hipY],rh:[114+offset*.5,hipY],lk:[seated?69:77+offset*.6,seated?183:197+bounce*.4],rk:[seated?131:123+offset*.6,seated?183:197+bounce*.4],la:[seated?70:65+offset*.4,237-(lesson.id==='merengue'?Math.max(0,Math.cos(phase*Math.PI))*16:0)],ra:[seated?130:135+offset*.4,237-(lesson.id==='merengue'?Math.max(0,-Math.cos(phase*Math.PI))*16:0)]};
  if(!seated&&['step-touch','salsa'].includes(lesson.id)){
    const feet=[[48,124],[48,70],[76,152],[130,152]];
    const position=Math.max(beat,0)%feet.length,index=Math.floor(position),fraction=position-index,mix=fraction*fraction*(3-2*fraction);
    p.la[0]=salsa?salsa[0]:feet[index][0]+(feet[(index+1)%feet.length][0]-feet[index][0])*mix;
    p.ra[0]=salsa?salsa[1]:feet[index][1]+(feet[(index+1)%feet.length][1]-feet[index][1])*mix;
    p.lk[0]=(p.la[0]+p.lh[0])/2;p.rk[0]=(p.ra[0]+p.rh[0])/2;
  }
  const lines=[['neck','ls'],['neck','rs'],['ls','le'],['le','lw'],['rs','re'],['re','rw'],['ls','lh'],['rs','rh'],['lh','rh'],['lh','lk'],['lk','la'],['rh','rk'],['rk','ra']];
  return <svg className={'tutor '+(small?'small':'')} viewBox="0 0 200 275" role="img" aria-label={`${lesson.title} illustrated movement guide. ${seated?'Seated adaptation.':''}`}><ellipse cx="100" cy="252" rx="62" ry="6" fill="#001a5625"/>{seated&&<path d="M55 170H145M60 170V238M140 170V238" fill="none" stroke="#a9c8ff70" strokeWidth="5"/>}<path d={`M${p.ls} L${p.rs} L${p.rh} L${p.lh} Z`} fill="#a7cbff"/>{lines.map(([a,b])=><line key={a+b} x1={p[a][0]} y1={p[a][1]} x2={p[b][0]} y2={p[b][1]} stroke={a.includes('l')?'#e8f2ff':'#a7cbff'} strokeWidth="11" strokeLinecap="round"/>)}<circle cx={p.head[0]} cy={p.head[1]} r="17" fill="#e8f2ff"/><path d={`M${p.la[0]-8} ${p.la[1]+2}h17M${p.ra[0]-8} ${p.ra[1]+2}h17`} stroke="#ffd447" strokeWidth="10" strokeLinecap="round"/>{['lw','rw'].map(k=><circle key={k} cx={p[k][0]} cy={p[k][1]} r="6" fill="#ffd447"/>)}</svg>;
}
