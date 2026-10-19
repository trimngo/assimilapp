export const STEP_ORDER=Object.freeze(['review','blind-listening','understand','read-along','exercises','write','shadowing','recall']);
export const LEGACY_STEP_ORDER=Object.freeze(['review','blind-listening','understand','read-along','shadowing','exercises','write','recall']);
export const STEP=Object.freeze(Object.fromEntries(STEP_ORDER.map((id,index)=>[id.replaceAll('-','_').toUpperCase(),index])));
const activities={
  review:{minutes:5,text:['Review','Listen to the previous two or three lessons. Tap Play review to listen to them in order.','']},
  'blind-listening':{minutes:3,text:['Blind listening','Listen to the new lesson twice without looking at the book.','Each listen includes both recorded readings when present. Playback stops after the second listen.']},
  understand:{minutes:7,text:['Understand','Open the book and read the German, English translation, and notes.','']},
  'read-along':{minutes:5,text:['Read along','Play the lesson while following the German text in your book.','']},
  exercises:{minutes:8,text:['Exercises','Do the lesson’s exercises.','The lesson pages and full recording, including exercises, are available below.']},
  write:{minutes:5,text:['Write','Copy 4–5 sentences by hand, or write them from the audio as dictation.','Use the lesson pages or the audio below.']},
  shadowing:{minutes:10,text:['Shadowing','Check the sentences you want to practise, then speak along with the audio. Check Repeat to loop your selection.','']},
  recall:{minutes:2,text:['Recall','Look at the English and try to say the German from memory.','']}
};
export const STUDY_STEPS=Object.freeze(STEP_ORDER.map(id=>Object.freeze(activities[id].text)));
export const DEFAULT_MINUTES=Object.freeze(STEP_ORDER.map(id=>activities[id].minutes));

function savedOrder(order=LEGACY_STEP_ORDER){
  if(!Array.isArray(order)||order.length!==STEP_ORDER.length||new Set(order).size!==STEP_ORDER.length||order.some(id=>!STEP_ORDER.includes(id)))throw new Error('Unsupported study step order.');
  return order;
}
export function remapStep(step,order){
  if(!Number.isInteger(step)||step<0||step>=STEP_ORDER.length)throw new Error('Invalid study step.');
  return STEP_ORDER.indexOf(savedOrder(order)[step]);
}
export function remapDurations(values,order){
  const previous=savedOrder(order);return STEP_ORDER.map(id=>values[previous.indexOf(id)]);
}
export function migrateProgress(stored){return {...stored,step:remapStep(stored.step,stored.stepOrder),stepOrder:[...STEP_ORDER]};}
export function migrateTimer(stored){
  if(!stored)return stored;
  return {...stored,stepOrder:[...STEP_ORDER],durations:stored.durations===undefined?undefined:remapDurations(stored.durations,stored.stepOrder),current:stored.current?{...stored.current,step:remapStep(stored.current.step,stored.stepOrder)}:null};
}
