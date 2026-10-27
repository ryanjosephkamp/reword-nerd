export interface ReviewRuntime {
 hash(value: Uint8Array | string): Promise<string>;
 inflate(bytes: Uint8Array, limit: number, raw: boolean): {buffer: Uint8Array; consumed: number};
}
export const encode = (s:string)=>new TextEncoder().encode(s);
export const utf8 = (b:Uint8Array)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
export function equalBytes(a:Uint8Array,b:Uint8Array){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
export function equalData(a:unknown,b:unknown):boolean {
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const x=Object.keys(a),y=Object.keys(b);
 return x.length===y.length&&x.every(k=>Object.hasOwn(b,k)&&equalData((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
export function concat(parts:readonly Uint8Array[]){const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let i=0;for(const b of parts){out.set(b,i);i+=b.length;}return out;}
export function base64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function unbase64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export class ImageJobError extends Error {constructor(public code:string,message:string){super(message);this.name='ImageJobError';}}
export function fail(code:string,message:string):never{throw new ImageJobError(code,message);}
