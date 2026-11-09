import { floorPlan } from './plan.js';

const width=590;
const height=670;
const font={
  '0':'75557','1':'26227','2':'71747','3':'71717','4':'55711','5':'74717','6':'74757','7':'71111','8':'75757','9':'75717',
  A:'25755',B:'65656',C:'74447',D:'65556',E:'74647',I:'72227',M:'57755',N:'57775',O:'75557',P:'75744',
  R:'75655',S:'74717',T:'72222',U:'55557',' ':'00000'
};
const ascii = new TextEncoder();
const crcTable = Uint32Array.from({length:256},(_,i)=>{
  for(let bit=0;bit<8;bit++) i=(i&1)?0xedb88320^(i>>>1):i>>>1;
  return i;
});

function join(...parts){
  const data=new Uint8Array(parts.reduce((size,part)=>size+part.length,0));
  let pos=0;
  for(const part of parts){data.set(part,pos);pos+=part.length;}
  return data;
}

function word(value){
  const data=new Uint8Array(4);
  new DataView(data.buffer).setUint32(0,value);
  return data;
}

function chunk(type,data){
  const payload=join(ascii.encode(type),data);
  let crc=0xffffffff;
  for(const byte of payload) crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return join(word(data.length),payload,word((crc^0xffffffff)>>>0));
}

export async function seatImage(night,selected){
  const stride=width*3+1;
  const image=new Uint8Array(stride*height);
  const white=[255,249,245],accent=[231,255,89],dark=[18,15,24],panel=[44,35,58], muted=[164,146,176];
  function rect(x,y,w,h,color){
    for(let row=y;row<y+h;row++){
      let pos=row*stride+x*3+1;
      for(let col=0;col<w;col++){image[pos++]=color[0];image[pos++]=color[1];image[pos++]=color[2];}
    }
  }
  function text(label,center,y,scale,color){
    let x=Math.round(center-(label.length*4-1)*scale/2);
    for(const char of label){
      const glyph=font[char]||font[' '];
      for(let row=0;row<5;row++) for(let col=0;col<3;col++){
        if(Number(glyph[row])&(4>>col)) rect(x+col*scale,y+row*scale,scale,scale,color);
      }
      x+=4*scale;
    }
  }
  rect(0,0,width,height,dark);
  rect(0,0,width,5,accent);
  text('TRIP  MESA '+selected,width/2,25,5,white);
  rect(170,78,253,62,panel);
  text('ESCENARIO',296,102,3,white);
  rect(486,361,65,81,panel);
  text('BARRA',518,396,2,muted);
  rect(170,611,265,38,panel);
  text('ENTRADA',302,623,3,muted);
  for(const table of floorPlan(night)){
    const x=8+table.x*36,y=95+table.y*29;
    const chosen=table.number===selected;
    rect(x,y,31,25,chosen?accent:panel);
    text(String(table.number),x+15,y+7,2,chosen?dark:white);
  }
  const compressed = await new Response(new Blob([image]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
  const header=join(word(width),word(height),Uint8Array.of(8,2,0,0,0));
  return join(Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',header),chunk('IDAT',new Uint8Array(compressed)),chunk('IEND',new Uint8Array()));
}
