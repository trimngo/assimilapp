import {localDay,markCompleted,unmarkCompleted,weekCount,monthDays} from './completions.js';
const $=id=>document.getElementById(id);
const dateOf=day=>new Date(`${day}T12:00:00`);
const fullDate=new Intl.DateTimeFormat(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
const monthName=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'long'});

export function connectProgressView(api){
  const today=new Date();let year=today.getFullYear(),month=today.getMonth(),selected=localDay(today),saving=false;
  const lessons=()=>api.getIndex()?.lessons||Array.from({length:100},(_,index)=>({number:index+1,title:''}));
  const lessonLabel=number=>{const title=lessons().find(lesson=>lesson.number===number)?.title;return title?`${number} ${title}`:`Lesson ${number}`;};
  const suggestEarlier=()=>{$('earlier-through').value=String(Math.max(1,Math.min(Number($('earlier-through').max)||100,api.getProgress().lesson-1)));};
  function renderDay(){
    $('completion-date').textContent=fullDate.format(dateOf(selected));
    const completed=api.getHistory().days[selected]||[];
    $('completion-empty').hidden=completed.length>0;
    $('completion-day-list').replaceChildren(...completed.map(number=>{const item=document.createElement('li');item.textContent=lessonLabel(number);return item;}));
  }
  function renderCalendar(){
    const history=api.getHistory(),today=localDay();
    $('calendar-month').textContent=monthName.format(new Date(year,month,1,12));
    $('calendar-days').replaceChildren(...monthDays(year,month).map(day=>{
      if(!day){const blank=document.createElement('span');blank.className='calendar-blank';blank.setAttribute('aria-hidden','true');return blank;}
      const button=document.createElement('button'),count=history.days[day]?.length||0;
      button.type='button';button.className=`calendar-day${count?' studied':''}${day===selected?' selected':''}`;button.dataset.date=day;
      button.setAttribute('aria-label',`${fullDate.format(dateOf(day))}, ${count} ${count===1?'lesson':'lessons'} completed`);
      button.setAttribute('aria-pressed',String(day===selected));if(day===today)button.setAttribute('aria-current','date');
      const number=document.createElement('span');number.className='calendar-number';number.textContent=String(Number(day.slice(-2)));button.append(number);
      if(count){const badge=document.createElement('span');badge.className='calendar-count';badge.textContent=String(count);button.append(badge);}
      button.addEventListener('click',()=>{selected=day;renderCalendar();renderDay();});return button;
    }));
    renderDay();
  }
  function renderLessonList(){
    const completed=new Set(api.getHistory().completed);
    $('completion-lesson-list').replaceChildren(...lessons().map(lesson=>{
      const row=document.createElement('label');row.className='completion-lesson';
      const input=document.createElement('input');input.type='checkbox';input.checked=completed.has(lesson.number);input.dataset.lesson=lesson.number;input.disabled=saving;
      input.setAttribute('aria-label',`Mark ${lessonLabel(lesson.number)} completed`);
      const title=document.createElement('span');title.className='completion-lesson-title';title.textContent=lessonLabel(lesson.number);
      const tag=document.createElement('span');tag.className='completed-tag';tag.textContent='✓ Completed';tag.hidden=!input.checked;
      input.addEventListener('change',()=>saveHistory(()=>input.checked?markCompleted(api.getHistory(),[lesson.number]):unmarkCompleted(api.getHistory(),lesson.number),`Lesson ${lesson.number} ${input.checked?'marked completed':'unmarked'}.`));
      row.append(input,title,tag);return row;
    }));
  }
  function update(){
    const history=api.getHistory(),progress=api.getProgress(),numbers=new Set(lessons().map(lesson=>lesson.number));
    const total=history.completed.filter(number=>numbers.has(number)).length,available=numbers.size;
    $('lesson-completed').hidden=!history.completed.includes(progress.lesson);
    $('completed-total').textContent=`${total} of ${available}`;
    $('completion-meter').max=available;$('completion-meter').value=total;
    $('completion-meter').setAttribute('aria-label',`${total} of ${available} lessons completed`);
    $('completion-week').textContent=String(weekCount(history));
    $('resume-lesson').textContent=`Resume lesson ${progress.lesson}`;
    $('resume-lesson').setAttribute('aria-label',`Resume ${lessonLabel(progress.lesson)}, ${api.steps[progress.step][0]}`);
    $('earlier-through').max=Math.max(...numbers);
    renderCalendar();renderLessonList();
  }
  async function saveHistory(makeHistory,message){
    if(saving)return;saving=true;
    $('progress').querySelectorAll('input,button[type="submit"]').forEach(control=>control.disabled=true);
    try{await api.setHistory(makeHistory());$('completion-manage-status').textContent=message;}
    catch(error){$('completion-manage-status').textContent='Could not save these completions. Try again.';}
    finally{saving=false;$('earlier-through').disabled=false;$('mark-earlier').disabled=false;update();}
  }
  $('mark-earlier-form').addEventListener('submit',event=>{
    event.preventDefault();const through=Number($('earlier-through').value);
    if(!Number.isInteger(through)||through<1||through>Number($('earlier-through').max))return;
    saveHistory(()=>markCompleted(api.getHistory(),lessons().filter(lesson=>lesson.number<=through).map(lesson=>lesson.number)),`Lessons 1–${through} marked completed without calendar dates.`);
  });
  function moveMonth(delta){const next=new Date(year,month+delta,1,12);year=next.getFullYear();month=next.getMonth();selected=localDay(new Date(year,month,1,12));renderCalendar();}
  $('calendar-previous').addEventListener('click',()=>moveMonth(-1));$('calendar-next').addEventListener('click',()=>moveMonth(1));
  $('calendar-today').addEventListener('click',()=>{const today=new Date();year=today.getFullYear();month=today.getMonth();selected=localDay(today);renderCalendar();});
  document.addEventListener('study-navigation',()=>{
    if(!$('progress').hidden){suggestEarlier();update();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  update();suggestEarlier();$('earlier-through').disabled=false;$('mark-earlier').disabled=false;
  return {update};
}
