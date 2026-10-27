import {it,expect} from "vitest";
import JSZip from "jszip";
import {createFixtureInput} from "../../companion/fixtures";
import {NEUTRAL_MODEL_PROFILE} from "../../src/domain/profiles";
import {prepareTextMember,freezeCollection,sourceContext} from "../../src/collections/prepare";
import {base64,canonical,unbase64,fromWire} from "../../src/collections/codec";
import {COLLECTION_LIMITS as L} from "../../src/collections/limits";
import {prepareCollectionStage,parseCollectionResponse} from "../../src/collections/stages";
import {renderPromptBundle} from "../../src/prompting";
import {loadCollection} from "./package";
import {textFixture,imageFixture} from "./fixtures";
import type {ExportSourceInput} from "../../src/export";
const input=(text="Owned literal 雪\r\n")=>createFixtureInput({text,profile:NEUTRAL_MODEL_PROFILE});
const bytes=(e:unknown)=>new TextEncoder().encode(canonical(e));
const opts=()=>({id:crypto.randomUUID(),revision:1,sharedInstruction:"",runtime:null});
it("accepts eight actual document packages with duplicate source bytes and rejects the ninth",async()=>{
 const members=[];for(let n=0;n<8;n++)members.push(await prepareTextMember(`d-${n}`,`folder-${n}/same.md`,input()));
 const e=await freezeCollection(members,opts()),loaded=await loadCollection(bytes(e));
 expect(loaded.envelope.expectedOutputs).toHaveLength(8);expect(new Set(e.members.map(m=>m.sourceSha256)).size).toBe(1);expect(new Set(e.expectedOutputs.map(o=>o.id)).size).toBe(8);
 await expect(freezeCollection([...members,await prepareTextMember("ninth","ninth.md",input())],opts())).rejects.toThrow(/members/);
});
it("checks real reviewed UTF-8 byte and combined context limits before transport",async()=>{
 const text="x".repeat(L.reviewedBytes-3)+"雪";
 const member=await prepareTextMember("one","one.txt",input(text));expect(member.reviewedBytes).toBe(L.reviewedBytes);
 await expect(prepareTextMember("over","over.txt",input(text+"x"))).rejects.toThrow(/Reviewed member text/);
 const second=await prepareTextMember("two","two.txt",input(text));
 const e=await freezeCollection([member,second],opts());expect(e.members.reduce((n,m)=>n+m.reviewedBytes,0)).toBe(L.totalReviewedBytes);
 await expect(freezeCollection([member,second,await prepareTextMember("three","three.txt",input("x"))],opts())).rejects.toThrow(/Combined reviewed/);
 const big=structuredClone(e);big.members[0].prompts!.manual.decompose="x".repeat(L.initialPromptBytes+1);
 await expect(freezeCollection(big.members,opts())).rejects.toThrow(/initial stage/);
 await expect(prepareCollectionStage(e,"rewrite",{decompose:{one:"x".repeat(L.memberResponseBytes+1),two:"x"}})).rejects.toThrow(/Prior member/);
});
it("retains four image identities even for duplicate PNG bytes, blocks fifth and wrong text jobs",async()=>{
 const {envelope:e}=await imageFixture();const members=[];
 for(let n=0;n<4;n++){const id=`same-${n}`,path=`folder-${n}/reference.png`;members.push({...e.members[0],id,path,expectedOutputs:[{...e.members[0].expectedOutputs[0],id:`${id}/rendition`,memberId:id,path}]});}
 const four=await loadCollection(bytes(await freezeCollection(members,opts())));expect(four.envelope.expectedOutputs).toHaveLength(4);
 await expect(freezeCollection([...members,{...members[0],id:"fifth",path:"fifth.png"}],opts())).rejects.toThrow(/members/);
 await expect(prepareCollectionStage(four.envelope,"decompose")).rejects.toThrow(/Wrong/);
});
it("rejects unsupported representations and preserves accepted OCR literally",async()=>{
 const latex={...input(),documentFormat:"latex" as const};await expect(prepareTextMember("x","x.tex",latex)).rejects.toThrow(/LaTeX/);
 const ocr={id:"ocr-1",source:{kind:"page" as const,pageNumber:1},text:"雪 OCR",reviewedText:"雪 OCR",confidence:0.9,status:"accepted" as const,engine:"tesseract.js" as const,engineVersion:"fixture",languageCode:"eng",languageHash:"0".repeat(64)};
 await expect(prepareTextMember("x","x.md",{...input(),ocrCandidates:[ocr]})).rejects.toThrow(/OCR/);
 await expect(prepareTextMember("x","x.md",{...input("雪 OCR"),ocrCandidates:[{...ocr,status:"pending"}]})).rejects.toThrow(/OCR/);
 const accepted={...input("\r\n雪 OCR\r\n"),ocrCandidates:[ocr]};const m=await prepareTextMember("x","x.md",accepted);expect(m.prompts!.manual.decompose).toContain("\r\n雪 OCR\r\n");
 const asset={id:"v",kind:"image" as const,filename:"owned.png",mimeType:"image/png",bytes:new Uint8Array([1]),byteCount:1,sha256:"0".repeat(64),order:0,included:true,decorative:false,warnings:[]};
 const withAsset={...input(),visualAssets:[asset]};await expect(prepareTextMember("x","x.md",withAsset)).rejects.toThrow(/visual assets/);
 const forged=fromWire(m.preparation) as ExportSourceInput;forged.promptBundle=renderPromptBundle("different",forged.resolvedSettings,forged.chosenProfile,sourceContext(forged));await expect(prepareTextMember("x","x.md",forged)).rejects.toThrow(/binding/);
});
it("rejects unsafe archives, symlinks, case aliases, extra entries and declared expansion before reconstruction",async()=>{
 const e=await textFixture();
 for(const path of ["../outside.txt","A.txt","extra.txt"]){const z=await JSZip.loadAsync(unbase64(e.members[0].packageBase64,L.packageBytes));z.file(path,"hostile data",{createFolders:false});if(path==="A.txt")z.file("a.txt","other",{createFolders:false});const bad=structuredClone(e);bad.members[0].packageBase64=base64(await z.generateAsync({type:"uint8array",compression:"DEFLATE"}));await expect(loadCollection(bytes(bad))).rejects.toThrow();}
 for(const alteration of ["symlink","expanded","entry"]){const archive=Buffer.from(unbase64(e.members[0].packageBase64,L.packageBytes));const offset=archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));if(alteration==="symlink")archive.writeUInt32LE((0o120777<<16)>>>0,offset+38);else archive.writeUInt32LE(alteration==="entry"?L.archiveEntryBytes+1:L.expandedBytes+1,offset+24);const bad=structuredClone(e);bad.members[0].packageBase64=base64(archive);await expect(loadCollection(bytes(bad))).rejects.toThrow();}
});
it("retains exact hostile literal responses but rejects mismatched hashes, empty, duplicate-key and oversized outputs",async()=>{
 const e=await textFixture(),{ticket}=await prepareCollectionStage(e,"decompose"),{members,...identity}=ticket;
 const value={...identity,results:members.map(m=>({...m,response:"<script>doNotExecute()</script>\r\n  <<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>> $&"}))};
 expect(parseCollectionResponse(canonical(value),ticket).valid).toBe(true);
 for(const change of [(v:typeof value)=>{v.collectionId=crypto.randomUUID();},(v:typeof value)=>{v.results[0].taskSha256="0".repeat(64);},(v:typeof value)=>{v.results[0].response=" ";},(v:typeof value)=>{v.results[0].response="x".repeat(L.memberResponseBytes+1);}]){const v=structuredClone(value);change(v);expect(parseCollectionResponse(canonical(v),ticket).valid).toBe(false);}
 expect(parseCollectionResponse(canonical(value).replace('"version":1','"version":1,"version":1'),ticket).valid).toBe(false);
 expect(parseCollectionResponse(" ".repeat(L.responseBytes+1),ticket).valid).toBe(false);
});
