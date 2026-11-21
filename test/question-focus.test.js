import {test} from "node:test";
import assert from "node:assert/strict";
import {focusQuestion} from "../question-focus.js";

function clientFor(data) {
  return {chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify(data)}}]})}}};
}
test("la question extraite doit citer un passage réellement entendu",async()=>{
  const transcript="Hier, pizza. Comment choisir un fournisseur ?";
  const client=clientFor({question:"Comment choisir un fournisseur ?",excerpt:"Comment choisir un fournisseur ?",needs_clarification:false});
  assert.equal((await focusQuestion(client,{transcript})).question,"Comment choisir un fournisseur ?");
  await assert.rejects(()=>focusQuestion(clientFor({question:"Quel budget ?",excerpt:"Quel budget ?",needs_clarification:false}),{transcript}));
});
test("une relance peut être contextualisée sans inventer la transcription",async()=>{
  const result=await focusQuestion(clientFor({question:"Développez vos expériences.",excerpt:"Plus en détail.",needs_clarification:false}),{transcript:"Plus en détail.",previousQuestion:"Quelles expériences ?"});
  assert.equal(result.question,"Développez vos expériences.");
});
test("une demande ambiguë reste à clarifier",async()=>{
  const result=await focusQuestion(clientFor({needs_clarification:true}),{transcript:"Et alors ce truc là"});
  assert.equal(result.needs_clarification,true);
  assert.equal(result.question,"");
});
