const validLesson=number=>Number.isInteger(number)&&number>=1&&number<=9999;
export function localDay(date=new Date()){
  return `${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDay(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  const date=new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===day;
}
const ordered=numbers=>[...new Set(numbers)].sort((a,b)=>a-b);
export function validateCompletions(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.completed)||
    value.completed.some(number=>!validLesson(number))||!value.days||typeof value.days!=='object'||Array.isArray(value.days))
    throw new Error('Invalid lesson completion history in backup.');
  const days={},completed=new Set(value.completed);
  for(const [day,numbers] of Object.entries(value.days)){
    if(!validDay(day)||!Array.isArray(numbers)||numbers.some(number=>!validLesson(number)))
      throw new Error('Invalid lesson completion date in backup.');
    if(numbers.length){days[day]=ordered(numbers);numbers.forEach(number=>completed.add(number));}
  }
  return {completed:ordered([...completed]),days};
}
export function emptyCompletions(){return {completed:[],days:{}};}
export function recordCompletion(history,lesson,day=localDay()){
  if(!validLesson(lesson)||!validDay(day))throw new Error('Choose a valid lesson and completion date.');
  const next=validateCompletions(history);
  next.completed=ordered([...next.completed,lesson]);next.days[day]=ordered([...(next.days[day]||[]),lesson]);return next;
}
export function markCompleted(history,lessons){
  if(!Array.isArray(lessons)||lessons.some(number=>!validLesson(number)))throw new Error('Choose valid lesson numbers.');
  const next=validateCompletions(history);next.completed=ordered([...next.completed,...lessons]);return next;
}
export function unmarkCompleted(history,lesson){
  const next=validateCompletions(history);next.completed=next.completed.filter(number=>number!==lesson);
  for(const day of Object.keys(next.days)){
    next.days[day]=next.days[day].filter(number=>number!==lesson);if(!next.days[day].length)delete next.days[day];
  }
  return next;
}
export function weekCount(history,today=new Date()){
  const start=new Date(today.getFullYear(),today.getMonth(),today.getDate(),12);
  start.setDate(start.getDate()-(start.getDay()+6)%7);
  const end=new Date(start);end.setDate(end.getDate()+6);
  const first=localDay(start),last=localDay(end);
  return Object.entries(history.days).reduce((total,[day,lessons])=>total+(day>=first&&day<=last?lessons.length:0),0);
}
export function monthDays(year,month){
  const first=new Date(year,month,1,12),offset=(first.getDay()+6)%7,count=new Date(year,month+1,0,12).getDate();
  return Array.from({length:Math.ceil((offset+count)/7)*7},(_,index)=>{
    const number=index-offset+1;return number>=1&&number<=count?localDay(new Date(year,month,number,12)):null;
  });
}
