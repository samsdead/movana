import React,{useState,useRef,useEffect} from 'react';
import { ArrowLeft, Play, Pause, Camera, CameraOff, Volume2, VolumeX, RotateCcw, Check, ShieldCheck, SlidersHorizontal, ArrowRight, ScanLine, AudioLines, Sparkles, Minus, Plus } from 'lucide-react';
import { Logo, Modal, Settings } from './App.jsx';
import Tutor from './Tutor.jsx';
import { DanceAudio } from './audio.js';
import { track } from './analytics.js';
import { features,calibrate,signal,MotionPeaks,RhythmScore,drawPose,clamp } from './motion.js';

const EMPTY={score:null,hits:0,observed:0,expected:0,coverage:0};
export default function Studio({lesson,settings,onSettings,onExit}){
  const [phase,setPhase]=useState('learn'),[playing,setPlaying]=useState(false),[demoing,setDemoing]=useState(false),[beat,setBeat]=useState(-4),[bpm,setBpm]=useState(lesson.bpm),[camera,setCamera]=useState('off'),[cameraMessage,setCameraMessage]=useState(''),[cameraError,setCameraError]=useState(''),[calibration,setCalibration]=useState(0),[stats,setStats]=useState(EMPTY),[feedback,setFeedback]=useState('Watch eight counts, then make the move your own.'),[showSettings,setShowSettings]=useState(false),[finished,setFinished]=useState(false),[offset,setOffset]=useState(0);
  const stage=useRef(null),video=useRef(null),canvas=useRef(null),audio=useRef(null),stream=useRef(null),detector=useRef(null),cameraGeneration=useRef(0),inferenceFrame=useRef(null),animation=useRef(null),base=useRef(null),samples=useRef([]),peaks=useRef(null),scorer=useRef(null),currentBeat=useRef(-4),playingRef=useRef(false),demoRef=useRef(false),pausedAt=useRef(-4),cameraRef=useRef('off'),metricRef=useRef('side'),settingsRef=useRef(settings),wakeLock=useRef(null),readyAt=useRef(null),mounted=useRef(true),startGeneration=useRef(0),startPending=useRef(false);
  if(!audio.current)audio.current=new DanceAudio();
  const mode=lesson.id==='seated'?'seated':settings.mode,metric=mode==='seated'?'sway':lesson.metric;
  const usage=useRef({started:false,finished:false}),usageBpm=useRef(bpm);
  usageBpm.current=bpm;
  function finishUsage(completed=false){
    if(!usage.current.started||usage.current.finished)return;
    usage.current.finished=true;
    const seconds=Math.min(600,Math.max(0,Math.round(Math.min(currentBeat.current,lesson.beats)*60/usageBpm.current)));
    track('session_finish',{lesson:lesson.id,seconds,completed});
  }
  metricRef.current=metric;settingsRef.current=settings;
  function cameraState(next){cameraRef.current=next;if(mounted.current)setCamera(next);}
  const activeBeat=Math.max(0,Math.floor(beat)),moving=playing||demoing,demoBpm=clamp(lesson.bpm-24,60,84);
  const guideCues=mode==='seated'?['Sway left','Centre','Sway right','Centre']:lesson.id==='house'?['Soften your knees','Rise gently']:lesson.cues;
  const cueIndex=Math.floor(Math.max(beat,0)*(lesson.id==='house'&&mode!=='seated'?2:1))%guideCues.length;
  const cue=guideCues[cueIndex],nextCue=guideCues[(cueIndex+1)%guideCues.length];
  const instructionIndex=lesson.id==='salsa'&&mode!=='seated'?(activeBeat%8<3?0:activeBeat%8===3?1:activeBeat%8<7?2:3):lesson.id==='house'&&mode!=='seated'?Math.floor(Math.max(beat,0)*2)%4:activeBeat%4;
  const remaining=Math.max(0,Math.ceil((lesson.beats-Math.max(beat,0))*60/bpm));
  useEffect(()=>{mounted.current=true;
    const onHidden=()=>{if(document.hidden){pauseSession();stopCamera();setFeedback('Session paused. Resume when you’re back.');}};document.addEventListener('visibilitychange',onHidden);
    return ()=>{mounted.current=false;stopAll();document.removeEventListener('visibilitychange',onHidden);};},[]);
  useEffect(()=>{audio.current.setMuted(!settings.sound);},[settings.sound]);
  useEffect(()=>{if(cameraRef.current==='ready'||cameraRef.current==='calibrating'){base.current=null;samples.current=[];readyAt.current=null;cameraState('calibrating');setCalibration(0);}peaks.current=new MotionPeaks({metric,range:settings.range});},[metric,settings.range]);
  function stopCamera(){cameraGeneration.current++;cancelAnimationFrame(inferenceFrame.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;try{detector.current?.close();}catch{}detector.current=null;base.current=null;samples.current=[];readyAt.current=null;cameraState('off');if(canvas.current)drawPose(canvas.current,null);}
  function stopAll(){finishUsage();startGeneration.current++;startPending.current=false;playingRef.current=false;demoRef.current=false;cancelAnimationFrame(animation.current);audio.current.close();stopCamera();wakeLock.current?.release().catch(()=>{});}
  function stopDemo(){if(!demoRef.current)return;startGeneration.current++;startPending.current=false;demoRef.current=false;cancelAnimationFrame(animation.current);audio.current.stop();if(mounted.current){setDemoing(false);setBeat(-4);}}
  function pauseSession(){stopDemo();startGeneration.current++;startPending.current=false;if(!playingRef.current)return;pausedAt.current=Math.max(-4,audio.current.currentBeat());currentBeat.current=pausedAt.current;playingRef.current=false;setPlaying(false);cancelAnimationFrame(animation.current);audio.current.stop();wakeLock.current?.release().catch(()=>{});wakeLock.current=null;}
  function showGuide(){if(window.matchMedia('(max-width:650px)').matches)stage.current?.scrollIntoView({block:'start',behavior:'instant'});}
  async function watchDemo(){
    if(demoRef.current){stopDemo();setFeedback('Ready when you are. Start with a comfortable pace.');return;}
    if(startPending.current||playingRef.current)return;
    showGuide();stopCamera();startPending.current=true;demoRef.current=true;setDemoing(true);const generation=++startGeneration.current;
    try{
      await audio.current.unlock();if(generation!==startGeneration.current||!mounted.current||document.hidden)return;
      audio.current.setMuted(!settingsRef.current.sound);audio.current.start(demoBpm,lesson.id,8,0);setBeat(0);setFeedback(`Watch one eight-count pattern at ${demoBpm} BPM. No camera needed.`);
      let lastUi=0;
      const tick=()=>{if(!demoRef.current)return;const value=audio.current.currentBeat(),now=performance.now();if(value>=8){stopDemo();setFeedback('Your turn. Start dancing, or choose a slower pace.');return;}if(now-lastUi>45){setBeat(Math.max(value,0));lastUi=now;}animation.current=requestAnimationFrame(tick);};
      animation.current=requestAnimationFrame(tick);
    }catch{stopDemo();setFeedback('Preview couldn’t start. Tap Watch the move again.');}finally{if(generation===startGeneration.current)startPending.current=false;}
  }
  async function enableCamera(){
    setCameraError('');setCameraMessage('Opening your front camera…');cameraState('loading');const generation=++cameraGeneration.current;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera needs a secure browser connection. Open Movana in Safari or Chrome.');
      const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}});
      if(generation!==cameraGeneration.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
      media.getVideoTracks()[0].addEventListener('ended',()=>{if(stream.current===media){pauseSession();stopCamera();setCameraError('Camera disconnected. Reconnect it and try again.');}});
      video.current.srcObject=media;await video.current.play();if(generation!==cameraGeneration.current)return;setCameraMessage('Preparing movement tracking. First use downloads about 20 MB.');
      // Let the first service worker take control before downloading tracking assets.
      // Camera use still works if private browsing or full storage prevents offline saving.
      if(import.meta.env.PROD&&'serviceWorker'in navigator&&!navigator.serviceWorker.controller){await new Promise(resolve=>{const start=performance.now();const check=()=>{if(navigator.serviceWorker.controller||generation!==cameraGeneration.current||performance.now()-start>8000)resolve();else setTimeout(check,100);};check();});}
      if(generation!==cameraGeneration.current)return;
      const {FilesetResolver,PoseLandmarker}=await import('@mediapipe/tasks-vision');const files=await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      if(generation!==cameraGeneration.current)return;
      let model;const options={baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task',delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6,outputSegmentationMasks:false};
      try{model=await PoseLandmarker.createFromOptions(files,options);}catch{model=await PoseLandmarker.createFromOptions(files,{...options,baseOptions:{...options.baseOptions,delegate:'CPU'}});}
      if(generation!==cameraGeneration.current){model.close();return;}detector.current=model;samples.current=[];base.current=null;readyAt.current=null;cameraState('calibrating');setCalibration(0);
      let lastVideo=-1,lastInference=0,lastUi=0;
      const frame=()=>{
        if(generation!==cameraGeneration.current)return;const now=performance.now();
        if(video.current?.readyState>=2&&video.current.currentTime!==lastVideo&&now-lastInference>(base.current&&!playingRef.current?250:75)){
          lastVideo=video.current.currentTime;lastInference=now;
          try{
            const result=model.detectForVideo(video.current,now),points=result.landmarks?.[0];if(canvas.current.width!==video.current.videoWidth)canvas.current.width=video.current.videoWidth;if(canvas.current.height!==video.current.videoHeight)canvas.current.height=video.current.videoHeight;drawPose(canvas.current,points);
            const sample=features(points,video.current.videoWidth/video.current.videoHeight,metricRef.current);
            if(sample){
              if(!base.current){if(!readyAt.current)readyAt.current=now;samples.current.push(sample);const progress=clamp((now-readyAt.current)/2200,0,1);if(now-lastUi>200){setCalibration(progress);setCameraMessage('Stay comfortably still while we find your starting position.');lastUi=now;}
                if(progress>=1){base.current=calibrate(samples.current);if(base.current){peaks.current=new MotionPeaks({metric:metricRef.current,range:settingsRef.current.range,jitter:base.current.jitter});cameraState('ready');setCameraMessage('You’re in frame. Ready when you are.');}}
              }else if(playingRef.current&&scorer.current){scorer.current.observe(now,true);const peak=peaks.current.update(signal(sample,base.current,metricRef.current),now);if(peak){const hit=scorer.current.event(peak.time);if(hit)setFeedback(hit.label);}}
              if(base.current&&now-lastUi>650){setCameraMessage('Movement tracking active');lastUi=now;}
            }else{peaks.current?.update(null,now);scorer.current?.observe(now,false);if(!base.current){readyAt.current=null;samples.current=[];setCalibration(0);}if(now-lastUi>650){setCameraMessage(metricRef.current==='sway'?'Move back so your shoulders and hips are in view.':'Move back so your shoulders, hips and feet are in view.');if(playingRef.current)setFeedback('Find your frame — scoring waits for you.');lastUi=now;}}
          }catch{pauseSession();stopCamera();setCameraError('Movement tracking stopped. Try the camera again, or follow the guide without it.');return;}
        }inferenceFrame.current=requestAnimationFrame(frame);
      };inferenceFrame.current=requestAnimationFrame(frame);
    }catch(error){if(generation!==cameraGeneration.current)return;stopCamera();setCameraError(error.name==='NotAllowedError'?'Camera access is off. Allow camera access in your browser settings, or dance with the guide.':error.name==='NotFoundError'?'No camera found. You can still dance with the guide.':error.name==='NotReadableError'?'Your camera is busy. Close any other app using it, then try again.':error.message||'Couldn’t start the camera. Try again or follow the guide.');}
  }
  async function startSession(){
    showGuide();stopDemo();
    if(startPending.current||playingRef.current)return;startPending.current=true;const generation=++startGeneration.current;
    try{
      await audio.current.unlock();if(generation!==startGeneration.current||!mounted.current||document.hidden)return;audio.current.setMuted(!settings.sound);setFinished(false);setPhase('practice');const start=audio.current.start(bpm,lesson.id,lesson.beats,pausedAt.current);currentBeat.current=pausedAt.current;
      if(!scorer.current)scorer.current=new RhythmScore({bpm,startMs:start,lessonId:lesson.id,metric:metricRef.current,totalBeats:lesson.beats,offsetMs:offset});else scorer.current.startMs=start;
      if(!usage.current.started){usage.current={started:true,finished:false};track('session_start',{lesson:lesson.id});}peaks.current?.reset();playingRef.current=true;setPlaying(true);setFeedback(cameraRef.current==='ready'?'Let the beat come to you.':'Follow the guide. Make it your own.');
      if('wakeLock'in navigator)navigator.wakeLock.request('screen').then(lock=>{if(playingRef.current)wakeLock.current=lock;else lock.release().catch(()=>{});}).catch(()=>{});
      let lastUi=0;
      const tick=()=>{if(!playingRef.current)return;const value=audio.current.currentBeat();currentBeat.current=value;const now=performance.now();if(value>=lesson.beats){finishSession();return;}if(now-lastUi>45){setBeat(value);if(scorer.current)setStats(scorer.current.summary(now));lastUi=now;}
        animation.current=requestAnimationFrame(tick);
      };animation.current=requestAnimationFrame(tick);
    }catch{if(mounted.current)setFeedback('Sound couldn’t start. Tap Start again, or check your browser’s audio settings.');}finally{if(generation===startGeneration.current)startPending.current=false;}
  }
  function finishSession(){const sessionBeat=playingRef.current?audio.current.currentBeat():pausedAt.current;currentBeat.current=sessionBeat;finishUsage(sessionBeat>=lesson.beats-.5);const sessionTime=scorer.current?scorer.current.startMs+sessionBeat*60000/bpm:performance.now();const result=scorer.current?.summary(sessionTime)||EMPTY;setStats(result);pauseSession();stopCamera();setFinished(true);setPhase('result');}
  function restart(){pauseSession();finishUsage();usage.current={started:false,finished:false};scorer.current=null;pausedAt.current=-4;currentBeat.current=-4;setBeat(-4);setStats(EMPTY);setFinished(false);setPhase('learn');setFeedback('A fresh start. Your pace.');}
  function leave(){stopAll();onExit();}
  function adjustTempo(value){if(playingRef.current)return;stopDemo();finishUsage();usage.current={started:false,finished:false};setBpm(clamp(value,60,132));setPhase('learn');scorer.current=null;pausedAt.current=-4;currentBeat.current=-4;setBeat(-4);setStats(EMPTY);}
  function recalibrate(){pauseSession();finishUsage();usage.current={started:false,finished:false};base.current=null;samples.current=[];readyAt.current=null;scorer.current=null;pausedAt.current=-4;setStats(EMPTY);setCalibration(0);cameraState('calibrating');}
  return <main className="studio"><header className="studio-header"><button className="icon-btn" aria-label="Back to lessons" onClick={leave}><ArrowLeft size={20}/></button><Logo/><span className="studio-private"><ShieldCheck size={15}/> Your private studio</span><button className="icon-btn studio-settings" aria-label="Studio preferences" disabled={moving} onClick={()=>setShowSettings(true)}><SlidersHorizontal size={19}/></button></header>
  {finished?<section className="result-card"><span className="result-symbol"><Sparkles size={40}/></span><span className="eyebrow">LOOK AT YOU, MOVING.</span><h1>That feeling?<br/><em>You made it.</em></h1><p>{lesson.title} · {Math.max(0,Math.round(Math.max(currentBeat.current,0)*60/bpm))} seconds of movement</p><div className="result-stats"><div><strong>{stats.score===null?'—':stats.score+'%'}</strong><span>Estimated rhythm</span></div><div><strong>{stats.hits}</strong><span>Moves on the beat</span></div><div><strong>{stats.coverage}%</strong><span>Tracking coverage</span></div></div><p className="muted">{stats.score===null?'No score this time. Camera feedback needs at least 8 clearly visible movement beats. Following along still counts as practice.':stats.coverage<60?'Only part of your session was clearly visible. This rhythm estimate covers those moments.':'An estimate of how often visible movement matched the beat. Keep the moves small and repeat when you feel ready.'}</p><p className="muted">Come back for two minutes tomorrow. Repeat until it feels easy, then try another rhythm.</p><p className="result-privacy"><ShieldCheck size={15}/> Your camera and score stay on this device.</p><button className="primary-btn wide" onClick={restart}><RotateCcw size={17}/> Dance it again</button><button className="text-btn" onClick={leave}>Find your next move <ArrowRight size={16}/></button></section>:<>
  <div className="studio-title"><div><span className="eyebrow">{lesson.style} <span> / </span> {mode==='seated'?'SEATED ADAPTATION':lesson.level}</span><h1>{lesson.title}<span>.</span></h1></div><span className="studio-duration">{Math.round(lesson.beats/bpm)} min <span>·</span> {bpm} BPM</span></div>
  <div className="studio-grid"><section className="practice-panel" aria-label="Live dance studio"><div ref={stage} className={'camera-stage '+(camera==='off'?'guide-mode':'camera-mode')}><div className="stage-top"><span className="pill glass"><span className={'status-dot '+(camera==='ready'?'on':'')}/>{demoing?'WATCH THE MOVE':camera==='off'?'MOVEMENT GUIDE':camera==='ready'?'LIVE · ON DEVICE':camera==='loading'?'OPENING CAMERA':'FIND YOUR FRAME'}</span><span className="time-pill">{demoing?`${demoBpm} BPM · 8 counts`:`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`}</span></div>
    <video className="camera-video" ref={video} muted playsInline aria-label="Your mirrored front camera" hidden={camera==='off'}/><canvas ref={canvas} className="pose-canvas" aria-hidden="true" hidden={camera==='off'}/>
    {camera==='off'?<div className="main-tutor"><div className="guide-grid"/><Tutor lesson={lesson} beat={Math.max(beat,0)} mode={mode}/><span className="guide-caption">Illustrated guide · your left is screen left</span></div>:camera==='ready'?<div className="tutor-inset"><Tutor lesson={lesson} beat={Math.max(beat,0)} mode={mode} small/><span>Mirror guide</span></div>:<div className="framing-overlay"><ScanLine size={54} strokeWidth={1}/><p>{camera==='loading'?cameraMessage:mode==='seated'?'Show your shoulders and hips':'Show your whole body'}</p>{camera==='calibrating'&&<><span>Set your phone down, step back, then hold still.</span><div className="calibration-track"><i style={{width:calibration*100+'%'}}/></div></>}</div>}
    {playing&&beat<0&&<div className="countdown"><strong>{Math.min(4,Math.ceil(-beat))}</strong><span>Find your starting position</span></div>}
    <div className="stage-bottom"><span className="step-label">{playing&&beat<0?'GET READY':`NOW · COUNT ${activeBeat%8+1}`}</span><strong>{playing&&beat<0?'Here we go…':cue}</strong><span className="tracking-message">Next · {playing&&beat<0?cue:nextCue}</span>{camera!=='off'&&<span className="tracking-message" role="status">{cameraMessage}</span>}</div></div>
    <div className="camera-toolbar"><button disabled={demoing} className={camera!=='off'?'camera-active':''} onClick={()=>{if(camera==='off'){pauseSession();enableCamera();}else{pauseSession();stopCamera();}}}>{camera==='off'?<Camera size={18}/>:<CameraOff size={18}/>}<span>{camera==='off'?'Enable camera':camera==='loading'?'Cancel camera':'Camera on'}</span></button><span className="toolbar-divider"/><button aria-label={settings.sound?'Mute beat':'Unmute beat'} aria-pressed={!settings.sound} onClick={()=>onSettings({sound:!settings.sound})}>{settings.sound?<Volume2 size={19}/>:<VolumeX size={19}/>}<span>{settings.sound?'Sound on':'Sound off'}</span></button><button className="toolbar-reset" aria-label="Restart lesson" onClick={restart}><RotateCcw size={18}/></button></div>
    {cameraError&&<div className="camera-error" role="alert"><CameraOff size={19}/><div>{cameraError}</div></div>}
    <div className="beat-strip" aria-label="Eight count rhythm">{Array.from({length:8},(_,i)=><span key={i} className={moving&&beat>=0&&activeBeat%8===i?'current':''} aria-current={moving&&beat>=0&&activeBeat%8===i?'step':undefined}>{i+1}</span>)}</div>
    {phase==='learn'&&<div className="session-controls" style={{marginBottom:12}}><button className="secondary-btn wide" onClick={watchDemo}>{demoing?<Pause size={17}/>:<Play size={17}/>} {demoing?'Stop preview':'Watch the move'} <span>· 8 counts</span></button></div>}
    <div className="session-controls"><button className="primary-btn play-session" disabled={camera==='loading'||camera==='calibrating'} onClick={playing?pauseSession:startSession}>{playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}{playing?'Pause':phase==='practice'?'Resume dancing':camera==='ready'?'Start with camera':'Start dancing'}</button>{phase==='practice'&&<button className="secondary-btn finish-btn" onClick={finishSession}>Finish</button>}</div><p className="session-feedback" role="status">{feedback}</p>
  </section>
  <aside className="lesson-panel"><div className="learn-heading"><span className="eyebrow">GET TO KNOW THE MOVE</span><span className="pill">01 / 01</span></div><h2>{lesson.description}</h2><div className="step-instructions">{(mode==='seated'?['Sway gently left','Return to centre','Sway gently right','Return to centre']:lesson.steps).map((text,i)=><div className={moving&&beat>=0&&instructionIndex===i?'step active':'step'} key={i}><span>{mode==='seated'?i+1:lesson.counts[i]}</span><p>{text}</p></div>)}</div><p className="coach-tip">{mode==='seated'?'Use a stable chair. Keep the sway comfortable and your shoulders relaxed. Footwork is replaced with upper-body rhythm practice.':lesson.tip}</p>
    <div className="tempo-control"><label htmlFor="tempo">Find your pace <strong>{bpm} <span>BPM</span></strong></label><div className="range-controls"><button aria-label="Slow down" disabled={moving||bpm<=60} onClick={()=>adjustTempo(bpm-4)}><Minus size={16}/></button><input id="tempo" type="range" min="60" max="132" step="4" value={bpm} disabled={moving} onChange={e=>adjustTempo(Number(e.target.value))}/><button aria-label="Speed up" disabled={moving||bpm>=132} onClick={()=>adjustTempo(bpm+4)}><Plus size={16}/></button></div><div className="tempo-labels"><span>Take it easy</span><span>Feel the energy</span></div><button className="text-btn" disabled={moving||bpm<=60} onClick={()=>{adjustTempo(bpm-16);setFeedback('A slower pace is ready. Take a small step on each count.');}}>Practice more slowly <ArrowRight size={15}/></button></div>
    <div className="live-feedback"><div><AudioLines size={17}/><span>Your rhythm</span><span className="estimate">ESTIMATE</span></div><div className="feedback-numbers"><strong>{stats.score===null?'—':stats.score+'%'}</strong><span>{camera==='off'?'Enable camera for live feedback':stats.observed<8?'Gathering visible movement beats':`${stats.hits} moves on the beat · ${stats.coverage}% visible`}</span></div><p>{lesson.id==='salsa'?'Timing of side accents on counts 1 and 5. Foot placement is not scored.':'Movement and timing, at your chosen range. No body ratings.'}</p></div>
    <details className="studio-details"><summary>Tips for better tracking</summary><p>Use the front camera in a well-lit space, with one person in view. Set your phone upright and show {mode==='seated'?'your shoulders and hips':'your whole body, including both feet'}. Keep the phone still after calibration.</p><p>Move without pain and keep space around you. Smaller steps are a good place to start. Phone speakers give more reliable timing than Bluetooth.</p>{camera==='ready'&&<button className="secondary-btn wide" onClick={recalibrate}>Recalibrate my position</button>}<label className="offset-label" htmlFor="timing-offset">Timing adjustment: {offset} ms</label><input id="timing-offset" type="range" min="-300" max="300" step="25" value={offset} disabled={playing} onChange={e=>{finishUsage();usage.current={started:false,finished:false};setOffset(Number(e.target.value));scorer.current=null;pausedAt.current=-4;currentBeat.current=-4;setBeat(-4);setStats(EMPTY);}}/><p className="fine-print">Positive values allow later movement. Adjust if your camera or audio has a noticeable delay.</p></details>
    <details className="studio-details"><summary>About this rhythm</summary><p>{lesson.origin}</p><p>Camera feedback estimates rhythm from body movement. It does not verify technique, weight transfer, or artistic quality.</p></details><p className="voice-note">Follow the music, the movement and the counts. No spoken interruptions.</p>
  </aside></div><div className="studio-bottom"><ShieldCheck size={16}/>Camera processed on your device. No recording. No account.</div></>}
  {showSettings&&<Modal title="Your studio, your way" onClose={()=>setShowSettings(false)}><Settings settings={settings} update={next=>{finishUsage();usage.current={started:false,finished:false};onSettings(next);scorer.current=null;pausedAt.current=-4;setBeat(-4);setStats(EMPTY);}}/><button className="primary-btn wide" onClick={()=>setShowSettings(false)}>Ready to move <Check size={17}/></button></Modal>}
  </main>;
}
