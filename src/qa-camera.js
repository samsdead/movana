const mode=new URLSearchParams(location.search).get('qa-camera');
if(mode==='denied')navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Test permission denial','NotAllowedError');};
if(mode==='fixture')navigator.mediaDevices.getUserMedia=async()=>{
  const image=new Image();image.src='/images/groove.webp';await image.decode();
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');
  let frame,active=true,start=null;
  const paint=()=>{if(!active)return;if(start===null&&document.querySelector('.beat-strip .current'))start=performance.now();const shift=start===null?0:Math.cos((performance.now()-start)/625*Math.PI/2)*28;context.fillStyle='#065bcc';context.fillRect(0,0,640,480);context.drawImage(image,shift,20,640,426);frame=requestAnimationFrame(paint);};paint();
  const stream=canvas.captureStream(24);const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{active=false;cancelAnimationFrame(frame);stop();};return stream;
};
