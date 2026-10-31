import assert from 'node:assert/strict';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as mod from '../../src/serve/codex/transport.js';
function frame(payload='', {op=1,fin=true,mask=false,rsv=0,lengthBytes}={}) {
  payload=Buffer.from(payload);const n=payload.length;
  const size=lengthBytes??(n<126?0:n<=65535?2:8);
  const header=Buffer.alloc(2+size+(mask?4:0));header[0]=(fin?128:0)|rsv|op;
  header[1]=(mask?128:0)|(size===0?n:size===2?126:127);
  if(size===2)header.writeUInt16BE(n,2);if(size===8)header.writeBigUInt64BE(BigInt(n),2);
  return Buffer.concat([header,payload]);
}
async function peer(t,{headers=[],status='101 Switching Protocols',peerLimit='16777216',tail=Buffer.alloc(0),hang=false,badAccept=false}={}) {
  assert.equal(typeof mod.connectUnixWebSocket,'function','bounded Unix WebSocket implementation is required');
  const root=mkdtempSync(join(tmpdir(),'rq-wire-')),path=join(root,'s');let sock,request;
  const received=[];const sockets=new Set();
  const server=net.createServer(s=>{let buf=Buffer.alloc(0),upgraded=false;sock=s;sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));
    s.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);
      if(!upgraded){const end=buf.indexOf('\r\n\r\n');if(end<0)return;
        request=buf.subarray(0,end+4).toString();buf=buf.subarray(end+4);upgraded=true;
        if(hang)return;
        const key=request.match(/sec-websocket-key: ([^\r]+)/i)?.[1];
        const accept=badAccept?'bad':createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        const lines=[`HTTP/1.1 ${status}`,'Upgrade: websocket','Connection: Upgrade',`Sec-WebSocket-Accept: ${accept}`];
        if(peerLimit!==null)lines.push(`x-codex-websocket-max-unfragmented-message-bytes: ${peerLimit}`);
        s.write(Buffer.concat([Buffer.from([...lines,...headers,'',''].join('\r\n')),tail]));
      }
      while(buf.length>=2){const tag=buf[1]&127,extra=tag===126?2:tag===127?8:0,masked=!!(buf[1]&128);
        if(buf.length<2+extra+(masked?4:0))return;
        const n=extra===8?Number(buf.readBigUInt64BE(2)):extra===2?buf.readUInt16BE(2):tag,off=2+extra+(masked?4:0);
        if(buf.length<off+n)return;
        const payload=Buffer.from(buf.subarray(off,off+n));if(masked)for(let i=0;i<n;i++)payload[i]^=buf[2+extra+(i%4)];
        const item={op:buf[0]&15,fin:!!(buf[0]&128),masked,mask:masked?buf.subarray(2+extra,off).toString('hex'):null,payload};received.push(item);buf=buf.subarray(off+n);
        if(item.op===8)s.end(frame(payload,{op:8}));
      }
    });
  });
  await new Promise((r,j)=>server.once('error',j).listen(path,r));
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
  return {path,received,get socket(){return sock},get request(){return request}};
}
async function until(fn,ms=1000){const deadline=performance.now()+ms;while(performance.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('observation deadline');}
export {frame,peer,until};
