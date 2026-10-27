import ZStream from 'pako/lib/zlib/zstream.js';
import {inflateInit2,inflate,inflateEnd} from 'pako/lib/zlib/inflate.js';
import {concat,encode,type ReviewRuntime} from './runtime';
import {createRetainedValidator} from './retained';
/** Pako is the existing JSZip dependency. Explicit zlib/raw windows reject gzip.
 * Capture at most limit + one 16 KiB chunk, aborting during inflation, not after.
 * total_in preserves the consumed-byte check used by the Node zlib adapter. */
export const browserRuntime:ReviewRuntime={
 async hash(value){const bytes=typeof value==='string'?encode(value):Uint8Array.from(value);const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');},
 inflate(bytes,limit,raw){
  const stream=new ZStream();
  if(inflateInit2(stream,raw?-15:15)!==0)throw new Error('Inflater initialization failed.');
  stream.input=bytes;stream.next_in=0;stream.avail_in=bytes.length;
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){
   const before=stream.total_in;
   stream.output=new Uint8Array(Math.min(16384,limit-length+1));stream.next_out=0;stream.avail_out=stream.output.length;
   const status=inflate(stream,0);length+=stream.next_out;
   if(length>limit)throw new Error('Inflated byte limit exceeded.');
   chunks.push(stream.output.subarray(0,stream.next_out));
   if(status===1)return {buffer:concat(chunks),consumed:stream.total_in};
   if(status!==0||(stream.total_in===before&&stream.next_out===0))throw new Error('Incomplete or corrupt deflate stream.');
  }}finally{inflateEnd(stream);}
 }
};
export const browserReviewValidator=createRetainedValidator(browserRuntime);
export type ImportedReview=Awaited<ReturnType<typeof browserReviewValidator.readRetainedBundle>>;
