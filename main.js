const {Plugin,ItemView,MarkdownView,Modal,FuzzySuggestModal,Notice,TFile,normalizePath,Platform}=require('obsidian');
const VIEW='shine-meeting-player';
function seconds(t){return t.split(':').reduce((a,v)=>a*60+Number(v.replace(',','.')),0);}
function parse(text){
 const rows=[];let fenced=false;
 text.split(/\r?\n/).forEach((line,i)=>{
  if(/^\s*```/.test(line)){fenced=!fenced;return;} if(fenced)return;
  const m=line.match(/^\s*(?:[-*>]\s*)?\[?(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*(?:[-–—]|-->)?\s*(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d+)?)?\]?\s+(.+)$/);
  if(m){const start=seconds(m[1]),end=m[2]?seconds(m[2]):null;if(end!==null&&end<start)return;rows.push({start,end,text:m[3],line:i});}
 });
 rows.sort((a,b)=>a.start-b.start);return rows;
}
function activeAt(rows,t){let lo=0,hi=rows.length-1,out=-1;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].start<=t){out=m;lo=m+1;}else hi=m-1;}return out>=0&&(rows[out].end===null||t<rows[out].end)?out:-1;}
function stamp(t){return [Math.floor(t/3600),Math.floor(t/60)%60,Math.floor(t)%60].map(x=>String(x).padStart(2,'0')).join(':');}
class Input extends Modal{
 constructor(app,title,value,done){super(app);this.title=title;this.value=value;this.done=done;}
 onOpen(){this.contentEl.createEl('h3',{text:this.title});const input=this.contentEl.createEl('input',{type:'text',value:this.value||''});input.style.width='100%';const submit=()=>{const value=input.value.trim();if(value){this.close();Promise.resolve(this.done(value)).catch(e=>new Notice(e.message));}};this.contentEl.createEl('button',{text:'确定'}).onclick=submit;input.onkeydown=e=>{if(e.key==='Enter')submit();};input.focus();}
 onClose(){this.contentEl.empty();}
}
class NotePicker extends FuzzySuggestModal{
 constructor(app,done){super(app);this.done=done;this.setPlaceholder('搜索库内笔记，选择摘录目标');}
 getItems(){return this.app.vault.getMarkdownFiles();}
 getItemText(file){return file.path;}
 onChooseItem(file){Promise.resolve(this.done(file)).catch(e=>new Notice(e.message));}
}
const AUDIO_EXTENSIONS=new Set(['mp3','wav','m4a','aac','ogg','flac','opus','mp4','webm']);
function cleanSource(source){return String(source||'').trim().replace(/^[\"'“]|[\"'”]$/g,'').replace(/^!?\[\[(.*?)\]\]$/,'$1').split('|')[0].replace(/\\/g,'/');}
function externalSource(source){return /^(?:[A-Za-z]:\/|\/|file:)/i.test(source);}
class AudioPicker extends FuzzySuggestModal{
 constructor(app,done){super(app);this.done=done;this.setPlaceholder('搜索库内音频（请先完成坚果云同步）');}
 getItems(){return this.app.vault.getFiles().filter(f=>AUDIO_EXTENSIONS.has(f.extension.toLowerCase()));}
 getItemText(file){return file.path;}
 onChooseItem(file){Promise.resolve(this.done(file)).catch(e=>new Notice(e.message));}
}
module.exports=class MeetingPlugin extends Plugin{
 async onload(){this.settings=Object.assign({sources:{}},await this.loadData());this.registerEvent(this.app.workspace.on('layout-change',()=>{if(this.dock&&!this.dock.isConnected)this.cleanup();}));
  this.addCommand({id:'excerpt-selection',name:'摘录选中文字到关联笔记',editorCallback:(editor,view)=>this.excerptSelection(view.file,editor)});
  this.addCommand({id:'play-from-cursor',name:'从光标所在句播放',editorCallback:(editor,view)=>{const row=parse(editor.getValue()).filter(r=>r.line<=editor.getCursor().line).pop();if(row&&view.file)this.open(view.file,Math.max(0,row.start+(Number(this.settings.offsets?.[view.file.path])||0)));}});
  this.addCommand({id:'open-player',name:'打开当前笔记的音文同步播放器',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!f||f.extension!=='md')return false;if(!checking)this.open(f);return true;}});
  this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{if(file instanceof TFile&&file.extension==='md')menu.addItem(i=>i.setTitle('会议：打开音文同步播放器').setIcon('play').onClick(()=>this.open(file)));}));
  this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{const file=view.file;if(!file)return;const rows=parse(editor.getValue());const line=editor.getCursor('from').line;const row=rows.filter(r=>r.line<=line).pop();menu.addItem(i=>i.setTitle('会议：打开音文同步播放器').onClick(()=>this.open(file)));if(row)menu.addItem(i=>i.setTitle('会议：从这里播放').onClick(()=>this.open(file,Math.max(0,row.start+(Number(this.settings.offsets?.[file.path])||0)))));const selected=editor.getSelection();if(selected&&row)menu.addItem(i=>i.setTitle('会议：摘录所选文字到笔记…').onClick(()=>this.excerpt(file,row,selected)));}));
  this.registerObsidianProtocolHandler('shine-meeting',async params=>{const f=this.app.vault.getAbstractFileByPath(params.note||'');if(f instanceof TFile)await this.open(f,Math.max(0,Number(params.t)||0));});
 }
 cleanup(){this.highlightObserver?.disconnect();this.highlightObserver=null;if(this.highlightFrame){cancelAnimationFrame(this.highlightFrame);this.highlightFrame=null;}this.loadToken=(this.loadToken||0)+1;if(this.audio){this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio=null;}if(this.objectURL){URL.revokeObjectURL(this.objectURL);this.objectURL=null;}this.dock?.remove();this.dock=null;this.clearHighlights();}
 onunload(){this.cleanup();}
 clearHighlights(){document.querySelectorAll('.shine-current-line').forEach(el=>el.classList.remove('shine-current-line'));}
 async open(file,time=0){try{
  this.cleanup();const token=this.loadToken;
  let leaf=this.app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===file.path);
  if(!leaf){leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source'}});}
  await this.app.workspace.revealLeaf(leaf);const view=leaf.view;if(view.getMode?.()==='preview')await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source'},active:true});
  this.settings=Object.assign({sources:{}},await this.loadData());const text=await this.app.vault.read(file);if(token!==this.loadToken)return;
  const rows=parse(text);const fm=this.app.metadataCache.getFileCache(file)?.frontmatter||{};
  const source=cleanSource(fm.audio)||this.settings.sources[file.path]||text.match(/^>\s*源文件[：:]\s*(.+)$/m)?.[1]?.trim();
  const dock=this.dock=document.createElement('div');dock.className='shine-meeting-dock';view.contentEl.prepend(dock);
  const title=dock.createDiv({text:'会议播放器 · '+file.basename});
  const noteButton=dock.createEl('button',{text:'摘录笔记路径'});noteButton.title=String(fm['audio notes']||fm.meeting_excerpt_target||'选择库内摘录目标笔记');noteButton.onclick=()=>this.chooseNotes(file,noteButton);
  dock.createEl('button',{text:Platform.isMobile?'选择库内音频':'更换音频'}).onclick=()=>this.choose(file);
  if(!Platform.isMobile)dock.createEl('button',{text:'选择库内音频'}).onclick=()=>this.chooseVaultAudio(file);
  const extract=dock.createEl('button',{text:'摘录选中文字'});let savedSelection=null;extract.addEventListener('pointerdown',()=>{savedSelection=this.captureSelection(file,view.editor);});extract.onclick=()=>{const capture=savedSelection||this.captureSelection(file,view.editor);savedSelection=null;if(capture)this.excerpt(capture.file,capture.row,capture.text);else new Notice('请在原笔记中选中要摘录的文字。');};
  dock.createEl('button',{text:'关闭'}).onclick=()=>this.cleanup();
  if(!source){dock.createEl('p',{text:'请点击更换音频关联源文件。'});return;}
  const audio=this.audio=dock.createEl('audio');audio.controls=true;audio.preload='metadata';
  audio.onerror=()=>new Notice('音频加载失败：'+source,10000);
  audio.onloadedmetadata=()=>{audio.currentTime=Math.min(time,Number.isFinite(audio.duration)?audio.duration:time);};
  const controls=dock.createDiv();for(const delta of [-3,3])controls.createEl('button',{text:delta<0?'后退 3 秒':'前进 3 秒'}).onclick=()=>audio.currentTime=Math.max(0,Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,audio.currentTime+delta));
  const rate=controls.createEl('select');for(const r of [0.75,1,1.25,1.5,2])rate.createEl('option',{text:r+'×',value:String(r)});rate.value='1';rate.onchange=()=>audio.playbackRate=Number(rate.value);
  this.settings.offsets ||= {};let offset=Number(this.settings.offsets[file.path])||0;
  controls.createEl('span',{text:' 字幕延后（秒）：'});const shift=controls.createEl('input',{type:'number',value:String(offset)});shift.step='0.5';shift.title='正数：字幕晚出现；负数：字幕早出现';shift.onchange=async()=>{offset=Number(shift.value)||0;this.settings.offsets[file.path]=offset;await this.saveData(this.settings);};
  controls.createEl('button',{text:'当前句对齐此刻'}).onclick=async()=>{const currentRows=parse(view.editor.getValue());const row=currentRows.filter(r=>r.line<=view.editor.getCursor().line).pop();if(!row){new Notice('请先把光标放到要对齐的时间戳段落。');return;}offset=audio.currentTime-row.start;shift.value=offset.toFixed(2);this.settings.offsets[file.path]=offset;await this.saveData(this.settings);new Notice('已将光标所在句对齐当前音频时间');};
  const follow=controls.createEl('label');const check=follow.createEl('input',{type:'checkbox'});check.checked=true;follow.appendText('跟随原笔记');
  dock.createEl('small',{text:'正数让字幕晚出现，负数让字幕早出现。选择文字时暂停自动滚动。摘录目标属性：audio notes'});
  let current=-2,lastText='',cachedRows=[];const getRows=()=>{const value=view.editor.getValue();if(value!==lastText){lastText=value;cachedRows=parse(value);}return cachedRows;};
  const paintHighlight=()=>{if(view.file?.path!==file.path)return;const latest=getRows();const n=activeAt(latest,audio.currentTime-offset);const row=n>=0?latest[n]:null;const lineText=row?view.editor.getLine(row.line):null;view.contentEl.querySelectorAll('.cm-line').forEach(el=>{const match=lineText!==null&&el.textContent===lineText;el.classList.toggle('shine-current-line',match);});};
  this.highlightObserver=new MutationObserver(()=>{if(this.highlightFrame)return;this.highlightFrame=requestAnimationFrame(()=>{this.highlightFrame=null;paintHighlight();});});
  const editorDOM=view.contentEl.querySelector('.cm-content');if(editorDOM)this.highlightObserver.observe(editorDOM,{childList:true,subtree:true,characterData:true});
  audio.ontimeupdate=()=>{if(view.file?.path!==file.path){this.cleanup();return;}const latest=getRows();const n=activeAt(latest,audio.currentTime-offset);if(n!==current){current=n;if(n>=0&&check.checked&&!view.editor.somethingSelected()){const row=latest[n];view.editor.scrollIntoView({from:{line:row.line,ch:0},to:{line:row.line,ch:0}},true);}}paintHighlight();};

  const media=await this.loadMedia(source,file);if(token!==this.loadToken){if(media.objectURL)URL.revokeObjectURL(media.url);return;}this.objectURL=media.objectURL?media.url:null;audio.src=media.url;
 }catch(e){new Notice(e.message);}}
 captureSelection(file,editor){if(!file||!editor)return null;const text=editor.getSelection();if(!text)return null;const line=editor.getCursor('from').line;const row=parse(editor.getValue()).filter(r=>r.line<=line).pop();if(!row){new Notice('所选文字前没有时间戳，请选择转录正文。');return null;}return {file,row,text};}
 excerptSelection(file,editor){const c=this.captureSelection(file,editor);if(c)this.excerpt(c.file,c.row,c.text);else new Notice('请先选中要摘录的文字。');}
 chooseVaultAudio(file){new AudioPicker(this.app,async target=>{await this.app.fileManager.processFrontMatter(file,fm=>{fm.audio=target.path;});this.settings.sources[file.path]=target.path;await this.saveData(this.settings);await this.open(file);}).open();}
 chooseNotes(file,button){new NotePicker(this.app,async target=>{if(target.path===file.path){new Notice('请选择另一篇笔记作为摘录目标。');return;}await this.app.fileManager.processFrontMatter(file,fm=>{fm['audio notes']=target.path;});if(button)button.title=target.path;new Notice('摘录目标：'+target.path);}).open();}
 choose(file){if(Platform.isMobile){this.chooseVaultAudio(file);return;}const input=document.createElement('input');input.type='file';input.accept='.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.mp4,.webm';input.style.display='none';document.body.appendChild(input);const remove=()=>input.remove();input.addEventListener('cancel',remove,{once:true});input.addEventListener('change',async()=>{try{const selected=input.files?.[0];if(!selected)return;const electron=require('electron');const value=electron.webUtils?.getPathForFile?electron.webUtils.getPathForFile(selected):selected.path;if(!value)throw new Error('无法获取本地文件路径，请确认 Obsidian 桌面版已更新。');this.mediaURL(value,file);await this.app.fileManager.processFrontMatter(file,fm=>{fm.audio=value;});this.settings.sources[file.path]=value;await this.saveData(this.settings);await this.open(file);}catch(e){new Notice(e.message,10000);}finally{remove();}},{once:true});input.click();}
 async loadMedia(source,file){const clean=cleanSource(source);if(externalSource(clean)){if(Platform.isMobile)throw new Error('这是电脑外部路径。请先把音频同步进手机库，再点“选择库内音频”。');const bytes=await require('fs').promises.readFile(clean);const ext=require('path').extname(clean).toLowerCase();const type={'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac'}[ext]||'application/octet-stream';return {url:URL.createObjectURL(new Blob([bytes],{type})),objectURL:true};}return {url:this.mediaURL(source,file),objectURL:false};}
 mediaURL(source,file){source=cleanSource(source);if(/^https?:/i.test(source))throw new Error('第一版仅支持本地音频。');if(externalSource(source)){if(Platform.isMobile)throw new Error('手机端请选择库内音频。');const {pathToFileURL}=require('url');if(!require('fs').existsSync(source))throw new Error('音频文件不存在：'+source);return pathToFileURL(source).href.replace(/^file:\/\/\//,'app://local/');}const f=this.app.metadataCache.getFirstLinkpathDest(source,file.path)||this.app.vault.getAbstractFileByPath(normalizePath(source));if(!(f instanceof TFile))throw new Error('找不到音频：'+source);return this.app.vault.getResourcePath(f);}
 excerpt(file,row,selected){const fm=this.app.metadataCache.getFileCache(file)?.frontmatter||{};let target=fm['audio notes']??fm.meeting_excerpt_target;if(Array.isArray(target))target=target[0];const write=async value=>{value=String(value).trim().replace(/^\[\[(.*?)\]\]$/,'$1');const path=normalizePath(value.replace(/\.md$/i,'')+'.md');if(path===file.path)throw new Error('摘录目标不能是源笔记本身。');if(path.split('/').some(p=>p==='..'||p.startsWith('.'))||path.includes(':'))throw new Error('请输入库内普通笔记路径。');const uri='obsidian://shine-meeting?vault='+encodeURIComponent(this.app.vault.getName())+'&note='+encodeURIComponent(file.path)+'&t='+Math.max(0,row.start+(Number(this.settings.offsets?.[file.path])||0));const block='\n\n> '+selected.replace(/\r?\n/g,'\n> ')+'\n\n来源：[['+file.path.replace(/\.md$/i,'')+']] · ['+stamp(row.start)+']('+uri+')\n';let target=this.app.vault.getAbstractFileByPath(path);if(target){if(!(target instanceof TFile)||target.extension!=='md')throw new Error('目标不是 Markdown 笔记。');await this.app.vault.process(target,text=>text+block);}else{const parts=path.split('/');parts.pop();let parent='';for(const p of parts){parent=parent?parent+'/'+p:p;if(!this.app.vault.getAbstractFileByPath(parent))await this.app.vault.createFolder(parent);}target=await this.app.vault.create(path,'# '+path.split('/').pop().replace(/\.md$/i,'')+block);}new Notice('摘录已保存：'+target.path);};if(target){write(target).catch(e=>new Notice(e.message));}else{new Input(this.app,'设置摘录目标（将保存到源笔记属性）','会议摘录',async value=>{await this.app.fileManager.processFrontMatter(file,fm=>{fm['audio notes']=value;});await write(value);}).open();}}
};
module.exports._test={parse,activeAt,seconds,cleanSource,externalSource};
