window.SignaturePadLite = class {
  constructor(canvas){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.drawing=false;
    this.empty=true;
    this.pointerId=null;
    this.resizeTimer=null;
    canvas.style.touchAction='none';
    this.resize();

    const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
    const start=e=>{
      if(e.button!==undefined&&e.button!==0)return;
      e.preventDefault();
      this.drawing=true;
      this.pointerId=e.pointerId;
      try{canvas.setPointerCapture(e.pointerId)}catch{}
      const p=point(e);
      this.ctx.beginPath();
      this.ctx.moveTo(p.x,p.y);
      this.ctx.lineTo(p.x+.01,p.y+.01);
      this.ctx.stroke();
      this.empty=false;
    };
    const move=e=>{
      if(!this.drawing||(this.pointerId!==null&&e.pointerId!==this.pointerId))return;
      e.preventDefault();
      const p=point(e);
      this.ctx.lineTo(p.x,p.y);
      this.ctx.stroke();
    };
    const stop=e=>{
      if(this.pointerId!==null&&e?.pointerId!==undefined&&e.pointerId!==this.pointerId)return;
      this.drawing=false;
      try{if(e?.pointerId!==undefined&&canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)}catch{}
      this.pointerId=null;
    };

    canvas.addEventListener('pointerdown',start,{passive:false});
    canvas.addEventListener('pointermove',move,{passive:false});
    canvas.addEventListener('pointerup',stop,{passive:false});
    canvas.addEventListener('pointercancel',stop,{passive:false});
    canvas.addEventListener('lostpointercapture',()=>{this.drawing=false;this.pointerId=null});
    addEventListener('resize',()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.resize(true),120)});
  }

  configure(){
    const d=Math.max(1,window.devicePixelRatio||1);
    this.ctx=this.canvas.getContext('2d');
    this.ctx.setTransform(d,0,0,d,0,0);
    this.ctx.lineWidth=2.4;
    this.ctx.lineCap='round';
    this.ctx.lineJoin='round';
    this.ctx.strokeStyle='#17351b';
  }

  resize(preserve=false){
    const r=this.canvas.getBoundingClientRect();
    const cssW=Math.max(1,Math.round(r.width));
    const cssH=Math.max(1,Math.round(r.height));
    const d=Math.max(1,window.devicePixelRatio||1);
    let old=null;
    if(preserve&&!this.empty&&this.canvas.width&&this.canvas.height)old=this.canvas.toDataURL('image/png');
    this.canvas.width=Math.max(1,Math.round(cssW*d));
    this.canvas.height=Math.max(1,Math.round(cssH*d));
    this.configure();
    if(old){const i=new Image();i.onload=()=>{this.ctx.drawImage(i,0,0,cssW,cssH)};i.src=old}
  }

  clear(){
    const d=Math.max(1,window.devicePixelRatio||1);
    this.ctx.save();
    this.ctx.setTransform(1,0,0,1,0,0);
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.ctx.restore();
    this.configure();
    this.empty=true;
  }

  data(){return this.empty?'':this.canvas.toDataURL('image/png')}
};