import {browserReviewValidator} from '../../../../image-companion/portable/browser';
self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
 try{const review=await browserReviewValidator.readRetainedBundle(new Uint8Array(event.data));self.postMessage({ok:true,review});}
 catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Unsupported review bundle.'});}
};
