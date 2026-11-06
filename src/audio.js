export class DanceAudio {
  constructor(){this.context=null;this.timer=null;this.master=null;this.nodes=new Set();this.muted=false;}
  async unlock(){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Audio is not supported in this browser.');if(!this.context)this.context=new Audio({latencyHint:'interactive'});await this.context.resume();if(!this.master){this.master=this.context.createGain();this.master.gain.value=.48;this.master.connect(this.context.destination);}}
  setMuted(value){this.muted=value;if(this.master)this.master.gain.setTargetAtTime(value?0:.48,this.context.currentTime,.025);}
  tone(frequency,time,length,type='sine',volume=.4,endFrequency){
    const osc=this.context.createOscillator(),gain=this.context.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,time);if(endFrequency)osc.frequency.exponentialRampToValueAtTime(endFrequency,time+length);
    gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(volume,time+.006);gain.gain.exponentialRampToValueAtTime(.0001,time+length);osc.connect(gain);gain.connect(this.master);osc.start(time);osc.stop(time+length+.025);this.nodes.add(osc);osc.onended=()=>{osc.disconnect();gain.disconnect();this.nodes.delete(osc);};
  }
  noise(time,length,volume,frequency){
    const buffer=this.context.createBuffer(1,Math.ceil(this.context.sampleRate*length),this.context.sampleRate);const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
    const source=this.context.createBufferSource(),filter=this.context.createBiquadFilter(),gain=this.context.createGain();source.buffer=buffer;filter.type='highpass';filter.frequency.value=frequency;gain.gain.setValueAtTime(volume,time);gain.gain.exponentialRampToValueAtTime(.0001,time+length);source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start(time);this.nodes.add(source);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();this.nodes.delete(source);};
  }
  start(bpm,style,totalBeats,startBeat=-4){
    this.stop();this.bpm=bpm;this.totalBeats=totalBeats;this.startBeat=startBeat;this.audioStart=this.context.currentTime+.13-startBeat*60/bpm;this.nextHalf=Math.ceil(startBeat*2);this.style=style;
    const stamp=this.context.getOutputTimestamp?.();
    this.startMs=stamp&&stamp.performanceTime>0?stamp.performanceTime+(this.audioStart-stamp.contextTime)*1000:performance.now()+(this.audioStart-this.context.currentTime+(this.context.outputLatency||0))*1000;
    const schedule=()=>{while(this.nextHalf/2<totalBeats){const beat=this.nextHalf/2,time=this.audioStart+beat*60/bpm;if(time>this.context.currentTime+.14)break;if(time>=this.context.currentTime){if(beat<0){if(Number.isInteger(beat))this.tone(beat===-1?1000:700,time,.07,'sine',.15);}else this.playStep(this.nextHalf,time);}this.nextHalf++;}};
    schedule();this.timer=setInterval(schedule,25);return this.startMs;
  }
  playStep(half,time){
    const beat=half/2,bar=Math.floor(beat/4);this.noise(time,.035,half%2?.09:.055,7000);
    if(half%2===0){
      if(this.style==='house'||beat%2===0)this.tone(135,time,.18,'sine',.85,42);
      if(beat%2===1)this.noise(time,.14,.25,1300);
      const bass=[65.41,65.41,77.78,58.27][bar%4];if(beat%2===0)this.tone(bass,time,.22,'triangle',.2);
      if(beat%4===0){for(const f of [261.63,311.13,392])this.tone(f*(bar%4===3?.89:1),time,.42,'sine',.025);}
    }
    if((this.style==='salsa'||this.style==='merengue')&&[1,4,7,10,12].includes(half%16))this.tone(440,time,.06,'triangle',.12,180);
    if(this.style==='disco'&&half%4===3)this.tone([523.25,622.25,783.99,698.46][Math.floor(half/4)%4],time,.13,'triangle',.045);
  }
  currentBeat(){return (performance.now()-this.startMs)/(60000/this.bpm);}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;for(const node of this.nodes){try{node.stop();}catch{}}this.nodes.clear();}
  async close(){this.stop();if(this.context){await this.context.close().catch(()=>{});this.context=null;this.master=null;}}
}
